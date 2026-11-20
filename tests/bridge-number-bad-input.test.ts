import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

type BridgeWindow = Window & { eval: (source: string) => void; MessageEvent: typeof MessageEvent; Event: typeof Event; KQA: any; close: () => void };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously"; pretendToBeVisual?: boolean }) => { window: BridgeWindow; close: () => void };
};

// jsdom does not expose validity.badInput for number inputs, so the browser state is simulated.
function markBadInput(input: HTMLInputElement, bad: boolean) {
  Object.defineProperty(input, "validity", { configurable: true, value: { badInput: bad, valid: !bad } });
}

describe("browser-invalid number input", () => {
  it("keeps a saved scalar number when the field holds an unparseable draft such as a lone minus sign", () => {
    const html = '<section><input type="number" data-kqa="amount"></section>';
    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    const { window } = dom;
    const post = vi.spyOn(window, "postMessage");
    const send = (data: object) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    window.eval(BRIDGE_SOURCE);
    send({ type: "init", questions: [{ id: "amount", type: "number", label: "Amount" }], answers: { amount: { value: 5 } }, recordGroups: {} });
    const input = window.document.querySelector<HTMLInputElement>('[data-kqa="amount"]')!;
    const drafts = () => post.mock.calls.map(([message]) => message as any).filter((message) => message.type === "number-draft");

    input.value = "";
    markBadInput(input, true);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));

    expect(window.KQA.get("amount")).toBe(5);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(drafts().at(-1)).toEqual({ kqa: 1, type: "number-draft", id: "amount", valid: false });

    send({ type: "locale", locale: "es", messages: {} });
    expect(input.value).toBe("");
    expect(window.KQA.get("amount")).toBe(5);

    input.value = "7";
    markBadInput(input, false);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(window.KQA.get("amount")).toBe(7);
    expect(input.getAttribute("aria-invalid")).toBeNull();
    expect(drafts().at(-1)).toEqual({ kqa: 1, type: "number-draft", id: "amount", valid: true });
    window.close();
  });

  it("treats a deliberately cleared number as a clear, not as an invalid draft", () => {
    const html = '<section><input type="number" data-kqa="amount"></section>';
    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    const { window } = dom;
    const post = vi.spyOn(window, "postMessage");
    const send = (data: object) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    window.eval(BRIDGE_SOURCE);
    send({ type: "init", questions: [{ id: "amount", type: "number", label: "Amount" }], answers: { amount: { value: 5 } }, recordGroups: {} });
    const input = window.document.querySelector<HTMLInputElement>('[data-kqa="amount"]')!;
    input.value = "";
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    expect(window.KQA.get("amount")).toBeUndefined();
    expect(post.mock.calls.map(([message]) => message as any).some((message) => message.type === "number-draft" && message.valid === false)).toBe(false);
    window.close();
  });

  it("does not treat a browser-invalid repeat number as an explicit clear of the saved value", () => {
    const html = '<section><template data-kqa-repeat-template="assets"><fieldset><legend>Asset</legend><input type="number" data-kqa-repeat-field="amount"></fieldset></template></section>';
    const dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true });
    const { window } = dom;
    const post = vi.spyOn(window, "postMessage");
    const send = (data: object) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    window.eval(BRIDGE_SOURCE);
    send({ type: "init", questions: [{ id: "assets", type: "repeat", label: "Assets", maxRows: 2, fields: [{ id: "amount", type: "number", label: "Amount" }] }], answers: {}, recordGroups: { assets: [{ id: "row1", values: { amount: 2 }, revision: 1, fieldRevisions: { amount: 1 } }] } });
    const input = window.document.querySelector<HTMLInputElement>('[data-kqa-repeat-field="amount"]')!;
    input.value = "";
    markBadInput(input, true);
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    const operations = post.mock.calls.map(([message]) => message as any).filter((message) => message.type === "record-operation");
    expect(operations).toEqual([]);
    const drafts = post.mock.calls.map(([message]) => message as any).filter((message) => message.type === "record-drafts").at(-1)!.drafts;
    expect(drafts).toEqual([{ questionId: "assets", rowId: "row1", fieldId: "amount" }]);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    window.close();
  });
});
