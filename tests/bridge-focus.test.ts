import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

type BridgeWindow = Window & { eval: (source: string) => void; MessageEvent: typeof MessageEvent };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously"; pretendToBeVisual?: boolean }) => { window: BridgeWindow };
};

function startBridge(dom: { window: BridgeWindow }) {
  dom.window.eval(BRIDGE_SOURCE);
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
    data: {
      kqa: 1,
      type: "init",
      questions: [{ id: "required", type: "text", label: "Required", required: true }],
      answers: {},
    },
    source: dom.window,
  }));
}

describe("questionnaire bridge focus requests", () => {
  it("focuses and scrolls the first visible enabled control for a question", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <div hidden><input data-kqa="required" aria-label="Hidden"></div>
      <input data-kqa="required" aria-label="Required answer">
    </body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
    const controls = dom.window.document.querySelectorAll<HTMLInputElement>("[data-kqa='required']");
    const target = controls[1];
    Object.defineProperty(target, "getClientRects", { value: () => [{ width: 100, height: 20 }] });
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "scrollIntoView", { value: scrollIntoView });

    startBridge(dom);
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { kqa: 1, type: "focus-question", id: "required" },
      source: dom.window,
    }));

    expect(dom.window.document.activeElement).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    dom.window.close();
  });

  it("focuses a script-backed custom question through its marked block", () => {
    const dom = new JSDOM(`<!doctype html><html><body>
      <section data-kqa-question-id="required"><h2>Custom question</h2><button type="button">One</button></section>
    </body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
    const target = dom.window.document.querySelector<HTMLButtonElement>("[data-kqa-question-id='required'] button")!;
    Object.defineProperty(target, "getClientRects", { value: () => [{ width: 100, height: 20 }] });
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "scrollIntoView", { value: scrollIntoView });

    startBridge(dom);
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { kqa: 1, type: "focus-question", id: "required" },
      source: dom.window,
    }));

    expect(dom.window.document.activeElement).toBe(target);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
    dom.window.close();
  });

  it("makes a custom block programmatically focusable when it has no controls", () => {
    const dom = new JSDOM(`<!doctype html><html><body><section data-kqa-question-id="required">Custom content</section></body></html>`, { runScripts: "dangerously", pretendToBeVisual: true });
    const block = dom.window.document.querySelector<HTMLElement>("[data-kqa-question-id='required']")!;
    Object.defineProperty(block, "getClientRects", { value: () => [{ width: 100, height: 20 }] });
    startBridge(dom);
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { kqa: 1, type: "focus-question", id: "required" },
      source: dom.window,
    }));

    expect(block.getAttribute("tabindex")).toBe("-1");
    expect(dom.window.document.activeElement).toBe(block);
    dom.window.close();
  });

  it("does nothing when the question has no visible enabled control", () => {
    const dom = new JSDOM(`<!doctype html><html><body><input data-kqa="required" disabled></body></html>`, { runScripts: "dangerously" });
    startBridge(dom);
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { kqa: 1, type: "focus-question", id: "required" },
      source: dom.window,
    }));

    expect(dom.window.document.activeElement).toBe(dom.window.document.body);
    dom.window.close();
  });

  it("uses an immediate scroll when reduced motion is preferred", () => {
    const dom = new JSDOM(`<!doctype html><html><body><input data-kqa="required"></body></html>`, { runScripts: "dangerously" });
    const target = dom.window.document.querySelector<HTMLInputElement>("[data-kqa='required']")!;
    Object.defineProperty(target, "getClientRects", { value: () => [{ width: 100, height: 20 }] });
    const scrollIntoView = vi.fn();
    Object.defineProperty(target, "scrollIntoView", { value: scrollIntoView });
    Object.defineProperty(dom.window, "matchMedia", { value: () => ({ matches: true }) });
    startBridge(dom);
    dom.window.dispatchEvent(new dom.window.MessageEvent("message", {
      data: { kqa: 1, type: "focus-question", id: "required" },
      source: dom.window,
    }));

    expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "auto" });
    dom.window.close();
  });
});
