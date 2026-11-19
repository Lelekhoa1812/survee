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

function start(answers: Record<string, { value: unknown; note?: string }> = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <section data-kqa-question-id="mode"><input type="radio" data-kqa="mode" name="mode" value="other"></section>
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
  it("switches guided sections while preserving conditional visibility and stored answers", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div data-kqa-question-list="a"><section data-kqa-question-id="mode"><input type="radio" data-kqa="mode" name="mode" value="other"></section></div>
      <div data-kqa-question-list="b"><section data-kqa-question-id="details"><input data-kqa="details"></section></div>
    </body></html>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    const send = (data: Record<string, unknown>) => window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
    send({ type: "init", guided: true, guidedSection: "a", questions: [
      { id: "mode", type: "single", label: "Mode", section: "a", options: [{ value: "other", label: "Other" }, { value: "standard", label: "Standard" }] },
      { id: "details", type: "text", label: "Details", section: "b", when: { all: [{ question: "mode", operator: "equals", value: "other" }] } },
    ], answers: { mode: { value: "other" }, details: { value: "Saved" } } });

    const mode = window.document.querySelector<HTMLElement>('[data-kqa-question-id="mode"]')!;
    const details = window.document.querySelector<HTMLElement>('[data-kqa-question-id="details"]')!;
    expect(mode.hidden).toBe(false);
    expect(details.hidden).toBe(true);
    send({ type: "guided", enabled: true, section: "b" });
    expect(mode.hidden).toBe(true);
    expect(details.hidden).toBe(false);
    expect(window.KQA.get("details")).toBe("Saved");
    send({ type: "guided", enabled: false });
    expect(mode.hidden).toBe(false);
    expect(details.hidden).toBe(false);
    window.close();
  });

  it("routes any answer type by non-empty answer state and reacts immediately to edits", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <section data-kqa-question-id="details"><input type="text" data-kqa="details"></section>
      <section data-kqa-question-id="follow-up"><textarea data-kqa="follow-up"></textarea></section>
    </body></html>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, type: "init", questions: [
      { id: "details", type: "text", label: "Details" },
      { id: "follow-up", type: "longtext", label: "More detail", when: { all: [{ question: "details", operator: "answered" }] } },
    ], answers: { details: { note: "A note alone" } } }, source: window }));
    const followUp = window.document.querySelector<HTMLElement>('[data-kqa-question-id="follow-up"]')!;
    expect(followUp.hidden).toBe(true);
    window.KQA.set("details", "Some detail");
    expect(followUp.hidden).toBe(false);
    window.KQA.set("details", "   ");
    expect(followUp.hidden).toBe(true);
    expect(window.KQA.getNote("details")).toBe("A note alone");
    window.close();
  });

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

  it("announces routing changes politely after initialization without moving focus", () => {
    const page = start();
    const status = page.window.document.querySelector<HTMLElement>('[data-kqa-routing-status]')!;
    expect(status).not.toBeNull();
    expect(status.textContent).toBe("");
    const mode = page.window.document.querySelector<HTMLInputElement>('[data-kqa="mode"]')!;
    mode.focus();
    page.window.KQA.set("mode", "other");

    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.getAttribute("aria-atomic")).toBe("true");
    expect(status.textContent).toBe("1 question is now shown.");
    expect(page.window.document.activeElement).toBe(mode);

    page.window.KQA.set("mode", "standard");
    expect(status.textContent).toBe("1 question is now hidden. Answers to hidden questions are retained.");
    page.window.KQA.set("mode", "standard");
    expect(status.textContent).toBe("1 question is now hidden. Answers to hidden questions are retained.");
    page.dom.window.close();
  });

  it("clears a respondent answer while preserving its note and uses the normal save event", () => {
    const page = start({ mode: { value: "other", note: "Keep this note" } });
    const mode = page.window.document.querySelector<HTMLInputElement>('[data-kqa="mode"]')!;
    expect(mode.checked).toBe(true);
    page.send({ type: "clear-answer", id: "mode" });

    expect(page.window.KQA.get("mode")).toBeUndefined();
    expect(page.window.KQA.getNote("mode")).toBe("Keep this note");
    expect(mode.checked).toBe(false);
    expect(page.post.mock.calls.some(([message]) => message.type === "set" && message.id === "mode" && message.value === null)).toBe(true);
    page.window.close();
  });

  it("ignores respondent clear actions after submission has locked the answers", () => {
    const page = start({ mode: { value: "other" } });
    page.send({ type: "lock", locked: true });
    page.send({ type: "clear-answer", id: "mode" });

    expect(page.window.KQA.get("mode")).toBe("other");
    expect(page.window.document.querySelector<HTMLInputElement>('[data-kqa="mode"]')!.checked).toBe(true);
    page.window.close();
  });
});
