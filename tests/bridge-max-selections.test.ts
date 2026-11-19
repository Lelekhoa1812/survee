import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

type BridgeWindow = Window & { eval: (source: string) => void; MessageEvent: typeof MessageEvent; Event: typeof Event; KQA: any; close: () => void };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously" }) => { window: BridgeWindow; close: () => void };
};

function start(value: string[] = []) {
  const dom = new JSDOM(`<!doctype html><html><body><section><fieldset><legend>Choices</legend>
    <label><input type="checkbox" data-kqa="q" value="a">A</label>
    <label><input type="checkbox" data-kqa="q" value="b">B</label>
    <label><input type="checkbox" data-kqa="q" value="c">C</label>
  </fieldset></section></body></html>`, { runScripts: "dangerously" });
  const { window } = dom;
  const post = vi.spyOn(window, "postMessage");
  window.eval(BRIDGE_SOURCE);
  window.dispatchEvent(new window.MessageEvent("message", { data: {
    kqa: 1, type: "init", questions: [{ id: "q", type: "multi", label: "Choices", maxSelections: 1, options: ["a", "b", "c"].map((v) => ({ value: v, label: v })) }],
    answers: { q: { value } },
  }, source: window }));
  return { dom, window, post };
}

describe("questionnaire bridge multi-select cap", () => {
  it("keeps legacy answers visible and allows incremental correction while rejecting additions", () => {
    const page = start(["a", "b", "c"]);
    const validations: any[] = [];
    page.window.KQA.on("validation", (event: any) => validations.push(event));
    const checkboxes = [...page.window.document.querySelectorAll<HTMLInputElement>("[data-kqa=q]")];
    expect(checkboxes.map((el) => el.checked)).toEqual([true, true, true]);
    expect(page.window.document.querySelector('[role="alert"]')?.textContent).toContain("Remove choices");

    checkboxes[0].checked = false;
    checkboxes[0].dispatchEvent(new page.window.Event("change", { bubbles: true }));
    expect(page.window.KQA.get("q")).toEqual(["b", "c"]);
    expect(page.window.document.querySelector('[role="alert"]')?.textContent).toContain("Remove 1 more choice");

    checkboxes[1].checked = false;
    checkboxes[1].dispatchEvent(new page.window.Event("change", { bubbles: true }));
    expect(page.window.KQA.get("q")).toEqual(["c"]);
    expect(page.window.document.querySelector('[role="alert"]')).toBeNull();

    checkboxes[0].checked = true;
    checkboxes[0].dispatchEvent(new page.window.Event("change", { bubbles: true }));
    expect(page.window.KQA.get("q")).toEqual(["c"]);
    expect(checkboxes[0].checked).toBe(false);
    expect(page.window.KQA.set("q", ["a", "b", "c"])).toBe(false);
    expect(validations.some((event) => event.valid === false)).toBe(true);
    page.window.close();
  });
});

describe("questionnaire bridge multi-select minimum guidance", () => {
  it("explains the minimum while still accepting partial autosaved choices", () => {
    const dom = new JSDOM(`<!doctype html><html><body><fieldset><legend>Choices</legend>
      <label><input type="checkbox" data-kqa="q" value="a">A</label>
      <label><input type="checkbox" data-kqa="q" value="b">B</label>
      <label><input type="checkbox" data-kqa="q" value="c">C</label>
    </fieldset></body></html>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    window.dispatchEvent(new window.MessageEvent("message", { data: {
      kqa: 1, type: "init", questions: [{ id: "q", type: "multi", label: "Choices", minSelections: 2, options: ["a", "b", "c"].map((v) => ({ value: v, label: v })) }], answers: {},
    }, source: window }));
    expect(window.document.querySelector("[data-kqa-selection-limit=q]")?.textContent).toContain("Choose at least 2 options");
    expect(window.document.querySelector("[data-kqa-selection-limit=q]")?.textContent).toContain("leave this question blank");
    const checkbox = window.document.querySelector<HTMLInputElement>('[data-kqa="q"][value="a"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new window.Event("change", { bubbles: true }));
    expect(window.KQA.get("q")).toEqual(["a"]);
    expect(window.KQA.set("q", ["a"])).toBe(true);
    window.close();
  });
});
