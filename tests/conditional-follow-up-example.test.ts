import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { injectBridge } from "../src/lib/format/bridge";

type ExampleWindow = Window & typeof globalThis;
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options?: { runScripts: "dangerously" }) => { window: ExampleWindow };
};
const example = readFileSync(new URL("../docs/examples/conditional-follow-up.kqa.html", import.meta.url), "utf8");

type AnswerMap = Record<string, { value: string }>;

function openExample(answers: AnswerMap = {}, locked = false) {
  const dom = new JSDOM(injectBridge(example), { runScripts: "dangerously" });
  const { window } = dom;
  const document = window.document;
  const post = vi.spyOn(window, "postMessage");
  const manifest = JSON.parse(document.getElementById("kqa-manifest")!.textContent!);
  function send(data: Record<string, unknown>) {
    window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, ...data }, source: window }));
  }
  function init() { send({ type: "init", questions: manifest.questions, answers, locked }); }
  return {
    dom, window, post, send, init,
    followUp: document.getElementById("follow-up") as HTMLElement,
    details: document.getElementById("support-details") as HTMLTextAreaElement,
    yes: document.querySelector<HTMLInputElement>('[data-kqa="needs-support"][value="yes"]')!,
    no: document.querySelector<HTMLInputElement>('[data-kqa="needs-support"][value="no"]')!,
  };
}

describe("conditional follow-up example with the KQA bridge", () => {
  it("keeps the follow-up available without JavaScript and until saved answers are restored", () => {
    const noScripts = new JSDOM(example);
    expect(noScripts.window.document.getElementById("follow-up")!.hidden).toBe(false);
    noScripts.window.close();

    const page = openExample();
    expect(page.followUp.hidden).toBe(false);
    page.init();
    expect(page.followUp.hidden).toBe(true);
    page.dom.window.close();
  });

  it.each([
    ["yes", false],
    ["no", true],
  ])("restores a saved %s choice and follow-up before setting visibility", (choice, hidden) => {
    const page = openExample({ "needs-support": { value: choice }, "support-details": { value: "Saved detail" } });
    page.init();
    expect(page.followUp.hidden).toBe(hidden);
    expect(choice === "yes" ? page.yes.checked : page.no.checked).toBe(true);
    expect(page.details.value).toBe("Saved detail");
    expect(page.post.mock.calls.filter(([message]) => message.type === "set")).toHaveLength(0);
    page.dom.window.close();
  });

  it("retains a written answer when hidden and lets the respondent erase it after reopening", () => {
    const page = openExample();
    page.init();
    page.yes.click();
    expect(page.followUp.hidden).toBe(false);
    page.details.value = "Please contact me";
    page.details.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    page.no.click();
    expect(page.followUp.hidden).toBe(true);
    expect(page.details.value).toBe("Please contact me");
    page.yes.click();
    expect(page.followUp.hidden).toBe(false);
    expect(page.details.value).toBe("Please contact me");
    page.details.value = "";
    page.details.dispatchEvent(new page.window.Event("input", { bubbles: true }));
    expect(page.post.mock.calls.map(([message]) => message).filter((message) => message.type === "set"))
      .toEqual([
        { kqa: 1, type: "set", id: "needs-support", value: "yes" },
        { kqa: 1, type: "set", id: "support-details", value: "Please contact me" },
        { kqa: 1, type: "set", id: "needs-support", value: "no" },
        { kqa: 1, type: "set", id: "needs-support", value: "yes" },
        { kqa: 1, type: "set", id: "support-details", value: null },
      ]);
    page.dom.window.close();
  });

  it("repaints when the host replaces answers and respects lock and unlock", () => {
    const page = openExample({ "needs-support": { value: "yes" }, "support-details": { value: "Stored" } }, true);
    page.init();
    expect(page.followUp.hidden).toBe(false);
    expect(page.yes.disabled).toBe(true);
    expect(page.details.disabled).toBe(true);
    page.no.click();
    expect(page.yes.checked).toBe(true);
    expect(page.post.mock.calls.filter(([message]) => message.type === "set")).toHaveLength(0);
    page.send({ type: "answers", answers: { "needs-support": { value: "no" }, "support-details": { value: "Stored" } } });
    expect(page.followUp.hidden).toBe(true);
    expect(page.details.value).toBe("Stored");
    page.send({ type: "lock", locked: false });
    expect(page.no.disabled).toBe(false);
    expect(page.details.disabled).toBe(false);
    page.yes.click();
    expect(page.followUp.hidden).toBe(false);
    expect(page.details.value).toBe("Stored");
    page.dom.window.close();
  });
});
