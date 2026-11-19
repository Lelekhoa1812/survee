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

function start(value?: string[]) {
  const dom = new JSDOM(`<!doctype html><html><body><fieldset><legend>Order these</legend>
    <ol data-kqa="priority"><li data-value="cost">Cost</li><li data-value="speed">Speed</li><li data-value="quality">Quality</li></ol>
  </fieldset></body></html>`, { runScripts: "dangerously" });
  const { window } = dom;
  const post = vi.spyOn(window, "postMessage");
  window.eval(BRIDGE_SOURCE);
  window.dispatchEvent(new window.MessageEvent("message", { data: { kqa: 1, type: "init", questions, answers: value ? { priority: { value } } : {} }, source: window }));
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

  it("lets a respondent confirm the starting order without moving anything", () => {
    const page = start();
    const confirm = page.window.document.querySelector<HTMLButtonElement>('[data-kqa-rank-confirm="priority"]')!;
    confirm.click();
    expect(page.window.KQA.get("priority")).toEqual(["cost", "speed", "quality"]);
    expect(confirm.hidden).toBe(true);
    expect(page.window.document.activeElement).toBe(page.window.document.querySelector('li:first-child button[data-kqa-rank-move="down"]'));
    page.window.close();
  });
});
