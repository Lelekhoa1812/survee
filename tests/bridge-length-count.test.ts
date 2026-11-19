import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

type BridgeWindow = Window & { eval: (source: string) => void; Event: typeof Event; InputEvent: typeof InputEvent; MessageEvent: typeof MessageEvent; CompositionEvent: typeof CompositionEvent; KQA: any; close: () => void };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously" }) => { window: BridgeWindow; close: () => void };
};

const questions = [
  { id: "summary", type: "text", label: "Summary", maxLength: 10, note: { maxLength: 10 } },
  { id: "details", type: "longtext", label: "Details", maxLength: 10 },
  { id: "custom", type: "text", label: "Custom question", custom: true, maxLength: 10 },
];

function start(answers: Record<string, { value?: unknown; note?: string }> = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>
    <label for="summary">Summary</label><input id="summary" type="text" data-kqa="summary" aria-describedby="summary-help">
    <p id="summary-help">Keep it brief.</p>
    <textarea data-kqa-note="summary" aria-describedby="note-help"></textarea><p id="note-help">Optional context.</p>
    <textarea data-kqa="details"></textarea>
    <section data-kqa-question-id="custom"></section>
  </body></html>`, { runScripts: "dangerously" });
  const { window } = dom;
  const post = vi.spyOn(window, "postMessage");
  window.eval(BRIDGE_SOURCE);
  window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, type: "init", questions, answers }, source: window }));
  return { dom, window, post };
}

describe("native text length feedback", () => {
  it("appears at 80%, retains authored descriptions, and announces only threshold transitions", () => {
    const page = start();
    const input = page.window.document.querySelector<HTMLInputElement>("#summary")!;
    const count = () => page.window.document.querySelector<HTMLElement>('[data-kqa-length-counter="kqa-length-summary-answer"]');
    const status = () => page.window.document.querySelector<HTMLElement>('[data-kqa-length-status="kqa-length-summary-answer"]');
    expect(count()?.hidden).toBe(true);
    input.value = "1234567";
    input.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(count()?.hidden).toBe(true);
    input.value = "12345678";
    input.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(count()?.textContent).toBe("8 of 10 characters used");
    expect(input.getAttribute("aria-describedby")).toBe("summary-help kqa-length-summary-answer");
    expect(status()?.textContent).toBe("Character limit approaching.");
    input.value = "123456789";
    input.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(status()?.textContent).toBe("Character limit approaching.");
    input.value = "1234567890";
    input.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(count()?.textContent).toBe("10 of 10 characters used");
    expect(status()?.textContent).toBe("Character limit reached.");
    expect(count()?.getAttribute("aria-live")).toBe("off");
    input.value = "123";
    input.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(count()?.hidden).toBe(true);
    expect(input.getAttribute("aria-describedby")).toBe("summary-help");
    page.window.close();
  });

  it("counts UTF-16 units for pasted and composed values and updates note and long-text controls", () => {
    const page = start();
    const input = page.window.document.querySelector<HTMLInputElement>("#summary")!;
    input.value = "1234567😀"; // seven BMP units plus a surrogate pair, as after paste
    input.dispatchEvent(new page.window.InputEvent("input", { bubbles: true, inputType: "insertFromPaste" }));
    expect(page.window.document.querySelector('[data-kqa-length-counter="kqa-length-summary-answer"]')?.textContent).toBe("9 of 10 characters used");
    input.dispatchEvent(new page.window.CompositionEvent("compositionstart", { bubbles: true }));
    input.value = "1234567890";
    input.dispatchEvent(new page.window.InputEvent("input", { bubbles: true, isComposing: true, inputType: "insertCompositionText" }));
    expect(page.window.document.querySelector('[data-kqa-length-counter="kqa-length-summary-answer"]')?.textContent).toBe("10 of 10 characters used");
    input.dispatchEvent(new page.window.CompositionEvent("compositionend", { bubbles: true }));

    const note = page.window.document.querySelector<HTMLTextAreaElement>("[data-kqa-note='summary']")!;
    note.value = "abcdefgh";
    note.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(page.window.document.querySelector('[data-kqa-length-counter="kqa-length-summary-note"]')?.textContent).toBe("8 of 10 characters used");
    expect(note.getAttribute("aria-describedby")).toBe("note-help kqa-length-summary-note");

    const details = page.window.document.querySelector<HTMLTextAreaElement>("[data-kqa='details']")!;
    details.value = "x".repeat(16000);
    details.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(page.window.document.querySelector('[data-kqa-length-counter="kqa-length-details-answer"]')?.textContent).toBe("16000 of 10 characters used — over the limit");
    page.window.close();
  });

  it("shows a restored over-limit answer without truncating it or announcing on initialization", () => {
    const page = start({ summary: { value: "12345678901", note: "12345678901" } });
    const input = page.window.document.querySelector<HTMLInputElement>("#summary")!;
    expect(input.value).toBe("12345678901");
    expect(page.window.document.querySelector('[data-kqa-length-counter="kqa-length-summary-answer"]')?.textContent).toBe("11 of 10 characters used — over the limit");
    expect(page.window.document.querySelector('[data-kqa-length-status="kqa-length-summary-answer"]')?.textContent).toBe("");
    expect(page.window.document.querySelector('[data-kqa-length-counter="kqa-length-summary-note"]')?.textContent).toBe("11 of 10 characters used — over the limit");
    expect(page.window.document.querySelector('[data-kqa-length-counter="kqa-length-custom-answer"]')).toBeNull();
    page.window.close();
  });

  it("uses default bounds for text, long text, and notes", () => {
    const defaultQuestions = [
      { id: "short", type: "text", label: "Short" },
      { id: "paragraph", type: "longtext", label: "Paragraph" },
      { id: "comment", type: "single", label: "Choice", note: true },
    ];
    const dom = new JSDOM(`<!doctype html><html><body><input data-kqa="short"><textarea data-kqa="paragraph"></textarea><textarea data-kqa-note="comment"></textarea></body></html>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, type: "init", questions: defaultQuestions, answers: {
      short: { value: "s".repeat(400) }, paragraph: { value: "p".repeat(16000) }, comment: { note: "n".repeat(4000) },
    } }, source: window }));
    expect(window.document.querySelector('[data-kqa-length-counter="kqa-length-short-answer"]')?.textContent).toBe("400 of 500 characters used");
    expect(window.document.querySelector('[data-kqa-length-counter="kqa-length-paragraph-answer"]')?.textContent).toBe("16000 of 20000 characters used");
    expect(window.document.querySelector('[data-kqa-length-counter="kqa-length-comment-note"]')?.textContent).toBe("4000 of 5000 characters used");
    window.close();
  });
});
