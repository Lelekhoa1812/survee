import { describe, expect, it } from "vitest";
import { checkHtml } from "../src/lib/diagnostics/static";

const html = (manifest: Record<string, unknown>, wrappers = "<section data-kqa-question-id=\"first\"><label>First<input data-kqa=\"first\"></label></section><section data-kqa-question-id=\"second\"><label>Second<input data-kqa=\"second\"></label></section>") => `<!doctype html><html lang="en"><head><title>Order</title><script type="application/json" id="kqa-manifest">${JSON.stringify(manifest)}</script></head><body><main><div data-kqa-question-list="work">${wrappers}<section><label>Anchor<input data-kqa="anchor"></label></section></div></main></body></html>`;

const base = {
  format: "kqa/1",
  title: "Order",
  sections: [{ id: "work", title: "Work" }],
  questionOrderGroups: [{ id: "context", questionIds: ["first", "second"] }],
  questions: [
    { id: "first", type: "text", label: "First", section: "work" },
    { id: "second", type: "text", label: "Second", section: "work" },
    { id: "anchor", type: "text", label: "Anchor", section: "work" },
  ],
};

describe("question-order group checker", () => {
  it("accepts explicit adjacent independent questions with matching sibling wrappers", () => {
    const report = checkHtml(html(base));
    expect(report.ok).toBe(true);
    expect(report.diagnostics.filter((item) => item.severity === "error")).toEqual([]);
  });

  it("rejects either guided presentation and non-contiguous groups", () => {
    expect(checkHtml(html({ ...base, presentation: "guided" })).diagnostics.map((item) => item.code)).toContain("KQA224");
    expect(checkHtml(html({ ...base, presentation: "guided-question" })).diagnostics.map((item) => item.code)).toContain("KQA224");
    const nonContiguous = { ...base, questionOrderGroups: [{ id: "context", questionIds: ["first", "anchor"] }] };
    expect(checkHtml(html(nonContiguous)).diagnostics.map((item) => item.code)).toContain("KQA224");
  });

  it("rejects routed, custom, cross-section and duplicate members", () => {
    const routed = { ...base, questions: [base.questions[0], { ...base.questions[1], when: { all: [{ question: "first", operator: "answered" }] } }, base.questions[2]] };
    expect(checkHtml(html(routed)).diagnostics.map((item) => item.code)).toContain("KQA224");
    const custom = { ...base, questions: [{ ...base.questions[0], custom: true }, base.questions[1], base.questions[2]] };
    expect(checkHtml(html(custom)).diagnostics.map((item) => item.code)).toContain("KQA224");
    const crossSection = { ...base, questions: [base.questions[0], { ...base.questions[1], section: undefined }, base.questions[2]] };
    expect(checkHtml(html(crossSection)).diagnostics.map((item) => item.code)).toContain("KQA224");
    const duplicate = { ...base, questionOrderGroups: [{ id: "context", questionIds: ["first", "second"] }, { id: "also-context", questionIds: ["second", "anchor"] }] };
    expect(checkHtml(html(duplicate)).diagnostics.map((item) => item.code)).toContain("KQA224");
  });

  it("rejects missing, non-sibling, or incorrectly ordered wrapper markup", () => {
    const missing = html(base, "<section data-kqa-question-id=\"first\"><label>First<input data-kqa=\"first\"></label></section>");
    expect(checkHtml(missing).diagnostics.map((item) => item.code)).toContain("KQA322");
    const reversed = html(base, "<section data-kqa-question-id=\"second\"><label>Second<input data-kqa=\"second\"></label></section><section data-kqa-question-id=\"first\"><label>First<input data-kqa=\"first\"></label></section>");
    expect(checkHtml(reversed).diagnostics.map((item) => item.code)).toContain("KQA322");
    const unmarked = html(base).replace('data-kqa-question-list="work"', 'data-kqa-question-list="other"');
    expect(checkHtml(unmarked).diagnostics.map((item) => item.code)).toContain("KQA322");
    const separated = html(base, "<section data-kqa-question-id=\"first\"><label>First<input data-kqa=\"first\"></label></section><p>Context for the next question</p><section data-kqa-question-id=\"second\"><label>Second<input data-kqa=\"second\"></label></section>");
    expect(checkHtml(separated).diagnostics.map((item) => item.code)).toContain("KQA322");
  });
});
