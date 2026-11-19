import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as { JSDOM: new (html: string, options: { runScripts: "dangerously" }) => any };

describe("questionnaire bridge question order", () => {
  it("moves complete question wrappers into the assigned DOM, reading, and tab order while retaining canonical logic", () => {
    const dom = new JSDOM(`<!doctype html><html><body><div data-kqa-question-list="work">
      <section data-kqa-question-id="first"><label>First<input data-kqa="first" value="alpha"></label></section>
      <section data-kqa-question-id="second"><label>Second<input data-kqa="second" value="beta"></label></section>
      <section data-kqa-question-id="anchor"><label>Anchor<input data-kqa="anchor"></label></section>
    </div></body></html>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    const questions = [
      { id: "first", type: "text", label: "First", section: "work" },
      { id: "second", type: "text", label: "Second", section: "work" },
      { id: "anchor", type: "text", label: "Anchor", section: "work" },
    ];
    window.dispatchEvent(new window.MessageEvent("message", { data: {
      kqa: 1,
      type: "init",
      questions,
      answers: { first: { value: "alpha" }, second: { value: "beta" } },
      questionOrderGroups: [{ id: "context", questionIds: ["first", "second"] }],
      questionOrderAssignment: { algorithmVersion: "kqa-question-order-v1", groups: { context: ["second", "first"] } },
    }, source: window }));

    expect([...window.document.querySelectorAll("[data-kqa-question-id]")].map((element: HTMLElement) => element.getAttribute("data-kqa-question-id"))).toEqual(["second", "first", "anchor"]);
    expect([...window.document.querySelectorAll("[data-kqa-question-list] input")].map((element: HTMLInputElement) => element.value)).toEqual(["beta", "alpha", ""]);
    expect(window.KQA.get("first")).toBe("alpha");
    expect(window.KQA.get("second")).toBe("beta");
    window.close();
  });

  it("fails closed to authored DOM order when the stored permutation is incomplete", () => {
    const dom = new JSDOM(`<div data-kqa-question-list=""><section data-kqa-question-id="first"><input data-kqa="first"></section><section data-kqa-question-id="second"><input data-kqa="second"></section></div>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    window.dispatchEvent(new window.MessageEvent("message", { data: {
      kqa: 1, type: "init", questions: [
        { id: "first", type: "text", label: "First" },
        { id: "second", type: "text", label: "Second" },
      ], answers: {}, questionOrderGroups: [{ id: "pair", questionIds: ["first", "second"] }],
      questionOrderAssignment: { algorithmVersion: "old", groups: { pair: ["second", "second"] } },
    }, source: window }));
    expect([...window.document.querySelectorAll("[data-kqa-question-id]")].map((element: HTMLElement) => element.getAttribute("data-kqa-question-id"))).toEqual(["first", "second"]);
    window.close();
  });

  it("fails closed when non-question content separates group members", () => {
    const dom = new JSDOM(`<div data-kqa-question-list=""><section data-kqa-question-id="first"><input data-kqa="first"></section><p>Context for the next question</p><section data-kqa-question-id="second"><input data-kqa="second"></section></div>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    window.dispatchEvent(new window.MessageEvent("message", { data: {
      kqa: 1, type: "init", questions: [
        { id: "first", type: "text", label: "First" },
        { id: "second", type: "text", label: "Second" },
      ], answers: {}, questionOrderGroups: [{ id: "pair", questionIds: ["first", "second"] }],
      questionOrderAssignment: { algorithmVersion: "v1", groups: { pair: ["second", "first"] } },
    }, source: window }));
    expect([...window.document.querySelectorAll("[data-kqa-question-list] > *")].map((element: HTMLElement) => element.getAttribute("data-kqa-question-id") ?? element.tagName.toLowerCase())).toEqual(["first", "p", "second"]);
    window.close();
  });
});
