import { describe, expect, it } from "vitest";
import { checkHtml } from "../src/lib/diagnostics/static";
import { manifestSchema } from "../src/lib/format/schema";

const manifest = {
  format: "kqa/1",
  title: "Question steps",
  presentation: "guided-question",
  questions: [
    { id: "first", type: "text", label: "First question" },
    { id: "follow-up", type: "longtext", label: "A routed follow-up", when: { all: [{ question: "first", operator: "answered" }] } },
  ],
};

const page = (value: Record<string, unknown>, body: string) => `<!doctype html><html lang="en"><head><title>Question steps</title><script type="application/json" id="kqa-manifest">${JSON.stringify(value)}</script></head><body>${body}</body></html>`;
const question = (id: string, type: "text" | "longtext" = "text") => `<article data-kqa-question-id="${id}"><label>${id}${type === "longtext" ? `<textarea data-kqa="${id}"></textarea>` : `<input type="text" data-kqa="${id}">`}</label></article>`;
const lists = `<main><div data-kqa-question-list="">${question("first")}${question("follow-up", "longtext")}</div></main>`;

describe("guided-question presentation contract", () => {
  it("accepts the schema value without requiring sections and keeps guided sections intact", () => {
    expect(manifestSchema.parse(manifest).presentation).toBe("guided-question");
    expect(manifestSchema.parse({ ...manifest, presentation: "guided", sections: [{ id: "part-a", title: "Part A" }], questions: [{ id: "first", type: "text", label: "First", section: "part-a" }] }).presentation).toBe("guided");
  });

  it("accepts one direct, marked root per question, including an unsectioned routed item", () => {
    const result = checkHtml(page(manifest, lists));
    expect(result.ok).toBe(true);
    expect(result.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("requires exactly one whole-question wrapper and the matching direct question list", () => {
    const missing = checkHtml(page(manifest, `<main><div data-kqa-question-list="">${question("first")}</div></main>`));
    expect(missing.diagnostics.filter((item) => item.code === "KQA321")).toHaveLength(1);

    const duplicate = checkHtml(page(manifest, `<main><div data-kqa-question-list="">${question("first")}${question("first")}${question("follow-up", "longtext")}</div></main>`));
    expect(duplicate.diagnostics.some((item) => item.code === "KQA321" && item.message.includes("found 2"))).toBe(true);

    const mismatch = checkHtml(page(manifest, `<main><div data-kqa-question-list="wrong">${question("first")}${question("follow-up", "longtext")}</div></main>`));
    expect(mismatch.diagnostics.some((item) => item.code === "KQA321")).toBe(true);

    const nested = checkHtml(page(manifest, `<main><div data-kqa-question-list=""><section>${question("first")}</section>${question("follow-up", "longtext")}</div></main>`));
    expect(nested.diagnostics.some((item) => item.code === "KQA321" && item.message.includes("direct child"))).toBe(true);
  });

  it("does not allow an unsectioned question to be assigned to an undeclared list", () => {
    const result = checkHtml(page(manifest, `<main><div data-kqa-question-list="unknown">${question("first")}${question("follow-up", "longtext")}</div></main>`));
    expect(result.diagnostics.filter((item) => item.code === "KQA321").length).toBeGreaterThan(0);
  });
});
