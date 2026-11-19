import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

type BridgeWindow = Window & { eval: (source: string) => void; MessageEvent: typeof MessageEvent; Event: typeof Event; KQA: any; close: () => void };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously" }) => { window: BridgeWindow; close: () => void };
};

function start(value: string[] = []) {
  const dom = new JSDOM(`<!doctype html><html><body><fieldset><legend>Choices</legend>
    <label><input type="checkbox" data-kqa="q" value="none">None</label>
    <label><input type="checkbox" data-kqa="q" value="a">A</label>
    <label><input type="checkbox" data-kqa="q" value="b">B</label>
  </fieldset></body></html>`, { runScripts: "dangerously" });
  const { window } = dom;
  window.eval(BRIDGE_SOURCE);
  window.dispatchEvent(new window.MessageEvent("message", { data: {
    kqa: 1, type: "init", questions: [{ id: "q", type: "multi", label: "Choices", exclusiveOptions: ["none"], options: ["none", "a", "b"].map((v) => ({ value: v, label: v })) }],
    answers: { q: { value } },
  }, source: window }));
  return { dom, window };
}

describe("questionnaire bridge exclusive options", () => {
  it("keeps conflicting saved values visible and requires correction", () => {
    const page = start(["none", "a"]);
    const boxes = [...page.window.document.querySelectorAll<HTMLInputElement>("[data-kqa=q]")];
    expect(boxes.map((box) => box.checked)).toEqual([true, true, false]);
    expect(page.window.KQA.get("q")).toEqual(["none", "a"]);
    expect(page.window.KQA.set("q", ["none", "a"])).toBe(false);
    boxes[1].checked = false;
    boxes[1].dispatchEvent(new page.window.Event("change", { bubbles: true }));
    expect(page.window.KQA.get("q")).toEqual(["none"]);
    page.window.close();
  });

  it("clears the other choices when selecting an exclusive option", () => {
    const page = start(["a"]);
    const boxes = [...page.window.document.querySelectorAll<HTMLInputElement>("[data-kqa=q]")];
    boxes[0].checked = true;
    boxes[0].dispatchEvent(new page.window.Event("change", { bubbles: true }));
    expect(boxes.map((box) => box.checked)).toEqual([true, false, false]);
    expect(page.window.KQA.get("q")).toEqual(["none"]);
    page.window.close();
  });
});
