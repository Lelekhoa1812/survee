import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import { BRIDGE_SOURCE } from "../src/lib/format/bridge";

type BridgeWindow = Window & { eval: (source: string) => void; MessageEvent: typeof MessageEvent; KQA: any; close: () => void };
const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options: { runScripts: "dangerously" }) => { window: BridgeWindow; close: () => void };
};

const questions = [{ id: "priority", type: "rank", label: "Order these", options: [
  { value: "cost", label: "Cost" }, { value: "speed", label: "Speed" }, { value: "quality", label: "Quality" },
] }];

function start(value?: string[], probe = false) {
  const dom = new JSDOM(`<!doctype html><html><body><fieldset><legend>Order these</legend>
    <ol data-kqa="priority"><li data-value="cost">Cost</li><li data-value="speed">Speed</li><li data-value="quality">Quality</li></ol>
  </fieldset></body></html>`, { runScripts: "dangerously" });
  const { window } = dom;
  const post = vi.spyOn(window, "postMessage");
  window.eval(BRIDGE_SOURCE);
  window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, type: "init", probe, questions, answers: value ? { priority: { value } } : {} }, source: window }));
  return { dom, window, post };
}

describe("rank answer bridge", () => {
  it("restores ordered answers and adds accessible single-pointer reorder controls", () => {
    const page = start(["quality", "cost", "speed"]);
    const items = [...page.window.document.querySelectorAll("ol li")];
    expect(items.map((item) => item.getAttribute("data-value"))).toEqual(["quality", "cost", "speed"]);
    expect(page.window.document.querySelectorAll("button[data-kqa-rank-move]")).toHaveLength(6);
    expect(page.window.document.querySelector<HTMLButtonElement>('li:first-child button[data-kqa-rank-move="up"]')!.disabled).toBe(true);
    expect(page.window.document.querySelector<HTMLButtonElement>('li:last-child button[data-kqa-rank-move="down"]')!.disabled).toBe(true);
    expect(page.window.document.querySelector<HTMLButtonElement>('[data-kqa-rank-confirm="priority"]')!.hidden).toBe(true);
    expect(page.window.document.querySelector('[data-kqa-rank-status="priority"]')?.getAttribute("aria-live")).toBe("polite");
    page.window.close();
  });

  it("moves one option, persists the full order, announces the result, and preserves focus", () => {
    const page = start();
    const button = page.window.document.querySelector<HTMLButtonElement>('li[data-value="quality"] button[data-kqa-rank-move="up"]')!;
    button.click();
    expect([...page.window.document.querySelectorAll("ol li")].map((item) => item.getAttribute("data-value"))).toEqual(["cost", "quality", "speed"]);
    expect(page.window.KQA.get("priority")).toEqual(["cost", "quality", "speed"]);
    expect(page.window.document.querySelector<HTMLButtonElement>('[data-kqa-rank-confirm="priority"]')!.hidden).toBe(true);
    expect(page.window.document.querySelector('[data-kqa-rank-status="priority"]')?.textContent).toContain("Quality moved to position 2 of 3");
    expect(page.post.mock.calls.some(([message]) => message.type === "set" && message.id === "priority" && JSON.stringify(message.value) === '["cost","quality","speed"]')).toBe(true);
    expect(page.window.document.activeElement).toBe(button);
    page.window.close();
  });

  it("keeps focus on the moved option when moving it to the first position disables Move up", () => {
    const page = start();
    const item = page.window.document.querySelector<HTMLLIElement>('li[data-value="speed"]')!;
    const up = item.querySelector<HTMLButtonElement>('button[data-kqa-rank-move="up"]')!;
    up.click();
    const down = item.querySelector<HTMLButtonElement>('button[data-kqa-rank-move="down"]')!;
    expect(up.disabled).toBe(true);
    expect(down.disabled).toBe(false);
    expect(page.window.document.activeElement).toBe(down);
    expect(page.window.document.querySelector('[data-kqa-rank-status="priority"]')?.textContent).toContain("Speed moved to position 1 of 3");
    page.window.close();
  });

  it("keeps focus on the moved option when moving it to the last position disables Move down", () => {
    const page = start();
    const item = page.window.document.querySelector<HTMLLIElement>('li[data-value="speed"]')!;
    const down = item.querySelector<HTMLButtonElement>('button[data-kqa-rank-move="down"]')!;
    down.click();
    const up = item.querySelector<HTMLButtonElement>('button[data-kqa-rank-move="up"]')!;
    expect(down.disabled).toBe(true);
    expect(up.disabled).toBe(false);
    expect(page.window.document.activeElement).toBe(up);
    expect(page.window.document.querySelector('[data-kqa-rank-status="priority"]')?.textContent).toContain("Speed moved to position 3 of 3");
    page.window.close();
  });

  it("lets a respondent confirm the starting order without moving anything", () => {
    const page = start();
    const confirm = page.window.document.querySelector<HTMLButtonElement>('[data-kqa-rank-confirm="priority"]')!;
    confirm.click();
    expect(page.window.KQA.get("priority")).toEqual(["cost", "speed", "quality"]);
    expect(confirm.hidden).toBe(true);
    expect(page.window.document.activeElement).toBe(page.window.document.querySelector('li:first-child button[data-kqa-rank-move="down"]'));
    page.window.close();
  });

  it("asks respondents to confirm a complete order after the option set changes", () => {
    const changedQuestions = [{ id: "priority", type: "rank", label: "Order these", options: [
      { value: "cost", label: "Cost" }, { value: "speed", label: "Speed" },
    ] }];
    const dom = new JSDOM(`<!doctype html><html><body><fieldset><legend>Order these</legend>
      <ol data-kqa="priority"><li data-value="cost">Cost</li><li data-value="speed">Speed</li></ol>
    </fieldset></body></html>`, { runScripts: "dangerously" });
    const { window } = dom;
    window.eval(BRIDGE_SOURCE);
    window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, type: "init", questions: changedQuestions,
      answers: { priority: { value: ["quality", "cost", "speed"] } } }, source: window }));
    const confirm = window.document.querySelector<HTMLButtonElement>('[data-kqa-rank-confirm="priority"]')!;
    expect(window.KQA.isAnswered("priority")).toBe(false);
    expect(window.KQA.progress()).toMatchObject({ answered: 0, total: 1 });
    expect(confirm.hidden).toBe(false);
    expect(window.document.querySelector('[data-kqa-rank-status="priority"]')?.textContent).toContain("options changed");
    confirm.click();
    expect(window.KQA.get("priority")).toEqual(["cost", "speed"]);
    expect(window.KQA.isAnswered("priority")).toBe(true);
    window.close();
  });

  it("probes rank binding and restoration with a non-initial permutation", async () => {
    const page = start(["cost", "speed", "quality"], true);
    await new Promise((resolve) => setTimeout(resolve, 100));
    const probe = page.post.mock.calls.map(([message]) => message).find((message) => message.type === "probe-result");
    expect(probe).toMatchObject({ tested: 1, results: [] });
    expect(page.window.KQA.get("priority")).toEqual(["cost", "speed", "quality"]);
    page.window.close();
  });
});
