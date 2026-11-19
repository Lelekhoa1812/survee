import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options: { runScripts: "dangerously" }) => any };

function init(html: string, questions: unknown[]) {
  const dom = new JSDOM(html, { runScripts: "dangerously" });
  dom.window.eval(BRIDGE_SOURCE);
  dom.window.dispatchEvent(new dom.window.MessageEvent("message", { data: { kqa: 1, type: "init", questions, answers: {} }, source: dom.window }));
  return dom;
}

describe("native option presentation order", () => {
  it("orders wrapped choice controls while retaining an explicitly fixed choice slot", () => {
    const dom = init(`<fieldset><label><input type="radio" name="purpose" data-kqa="purpose" value="a">A</label><label><input type="radio" name="purpose" data-kqa="purpose" value="other">Other</label><label><input type="radio" name="purpose" data-kqa="purpose" value="b">B</label></fieldset>`, [{ id: "purpose", type: "single", randomizeOptions: true, options: [{ value: "b" }, { value: "other" }, { value: "a" }] }]);
    expect([...dom.window.document.querySelectorAll('input[name="purpose"]')].map((control: HTMLInputElement) => control.value)).toEqual(["b", "other", "a"]);
    dom.window.close();
  });

  it("moves select options without moving its empty placeholder", () => {
    const dom = init(`<select name="region" data-kqa="region"><option value="">Choose</option><option value="a">A</option><option value="b">B</option></select>`, [{ id: "region", type: "select", randomizeOptions: true, options: [{ value: "b" }, { value: "a" }] }]);
    expect([...dom.window.document.querySelector("select")!.options].map((option: HTMLOptionElement) => option.value)).toEqual(["", "b", "a"]);
    dom.window.close();
  });
});
