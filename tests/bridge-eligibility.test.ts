import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

type BridgeWindow = Window & { eval: (source: string) => void; MessageEvent: typeof MessageEvent; KQA: any; close: () => void };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously" }) => { window: BridgeWindow; close: () => void };
};

const questions = [
  { id: "mode", type: "single", label: "Mode" },
  { id: "details", type: "text", label: "Details", when: { all: [{ question: "mode", operator: "equals", value: "other" }] } },
  { id: "nested", type: "text", label: "Nested", when: { any: [{ question: "details", operator: "contains", value: "why" }] } },
];

function start(answers: Record<string, { value: unknown }> = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section data-kqa-question-id="mode"><input data-kqa="mode" value="other"></section>
    <section data-kqa-question-id="details" aria-hidden="false"><input data-kqa="details" tabindex="3"></section>
    <section data-kqa-question-id="nested" hidden><input data-kqa="nested"></section>
  </body></html>`, { runScripts: "dangerously" });
  const { window } = dom;
  const post = vi.spyOn(window, "postMessage");
  window.eval(BRIDGE_SOURCE);
  function send(data: Record<string, unknown>) {
    window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
  }
  send({ type: "init", questions, answers });
  return { dom, window, post, send };
}

describe("questionnaire bridge conditional eligibility", () => {
  it("restores answers before evaluating conditions, hides ineligible blocks and reports eligibility", () => {
    const page = start({ mode: { value: "other" }, details: { value: "why here" }, nested: { value: "saved" } });
    expect(page.window.KQA.eligibility()).toEqual({ mode: true, details: true, nested: true });
    expect(page.window.KQA.isEligible("details")).toBe(true);
    expect(page.window.document.querySelector<HTMLElement>('[data-kqa-question-id="details"]')!.hidden).toBe(false);
    expect(page.window.KQA.get("details")).toBe("why here");
    expect(page.post.mock.calls.some(([message]) => message.type === "eligibility" && message.eligible.details === true)).toBe(true);
  page.window.close();
  });

  it("updates on user changes and host answer replacement, preserving hidden answers and author state", () => {
    const page = start({ mode: { value: "other" }, details: { value: "saved" } });
    const detailsBlock = page.window.document.querySelector<HTMLElement>('[data-kqa-question-id="details"]')!;
    const details = page.window.document.querySelector<HTMLInputElement>('[data-kqa="details"]')!;
    expect(detailsBlock.hidden).toBe(false);
    page.window.KQA.set("mode", "standard");
    expect(detailsBlock.hidden).toBe(true);
    expect(detailsBlock.hidden).toBe(true);
    expect(page.window.KQA.get("details")).toBe("saved");
    page.send({ type: "answers", answers: { mode: { value: "other" }, details: { value: "why now" } } });
    expect(detailsBlock.hidden).toBe(false);
    expect(detailsBlock.getAttribute("aria-hidden")).toBe("false");
    expect(details.getAttribute("tabindex")).toBe("3");
    expect(details.disabled).toBe(false);
    const nested = page.window.document.querySelector<HTMLElement>('[data-kqa-question-id="nested"]')!;
    expect(nested.hidden).toBe(true); // author's initial hidden state is restored when eligible
    expect(page.window.KQA.get("nested")).toBeUndefined();
    page.window.close();
  });
});
