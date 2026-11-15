import { describe, expect, it } from "vitest";
import { summarizeQuestion, type AnalyticsRespondent } from "../src/lib/analytics/summary";
import { formatPercentage } from "../src/lib/analytics/format";
import type { Question } from "../src/lib/format/schema";

const at = "2026-11-15T00:00:00.000Z";
const respondent = (value?: string | number | string[], note?: string): AnalyticsRespondent => ({
  answers: value === undefined && note === undefined ? {} : { q: { ...(value === undefined ? {} : { value }), ...(note === undefined ? {} : { note }), updatedAt: at } },
});

describe("descriptive question summaries", () => {
  it("keeps eligible, missing, note-only, valid, and unmapped counts distinct", () => {
    const q: Question = { id: "q", type: "single", label: "Choice", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] };
    const summary = summarizeQuestion(q, [respondent("yes"), respondent("no"), respondent("retired"), respondent(undefined, "More context"), respondent()]);
    expect(summary).toMatchObject({ eligibleCount: 5, answeredCount: 3, missingCount: 2, noteOnlyCount: 1, unmappedResponseCount: 1, distributionDenominator: 2 });
    expect(summary.distribution).toEqual([
      { value: "yes", label: "Yes", count: 1, percent: 50 },
      { value: "no", label: "No", count: 1, percent: 50 },
    ]);
  });

  it("uses respondent shares for multi-select options", () => {
    const q: Question = { id: "q", type: "multi", label: "Channels", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] };
    const summary = summarizeQuestion(q, [respondent(["a", "b"]), respondent(["a"]), respondent("b"), respondent([])]);
    expect(summary.distributionDenominator).toBe(2);
    expect(summary.unmappedResponseCount).toBe(1);
    expect(summary.answeredCount).toBe(3);
    expect(summary.distribution.map(({ count, percent }) => ({ count, percent }))).toEqual([
      { count: 2, percent: 100 },
      { count: 1, percent: 50 },
    ]);
  });

  it("reports number summaries while retaining non-numeric legacy values as unmapped", () => {
    const q: Question = { id: "q", type: "number", label: "Budget" };
    const summary = summarizeQuestion(q, [respondent(1), respondent(2), respondent(3), respondent("unknown"), respondent()]);
    expect(summary.numeric).toEqual({ n: 3, min: 1, max: 3, mean: 2, median: 2 });
    expect(summary.unmappedResponseCount).toBe(1);
    expect(summary.answeredCount).toBe(4);
  });

  it("excludes out-of-range number values from descriptive statistics", () => {
    const q: Question = { id: "q", type: "number", label: "Budget", min: 0, max: 10 };
    const summary = summarizeQuestion(q, [respondent(2), respondent(99), respondent("bad")]);
    expect(summary.numeric).toEqual({ n: 1, min: 2, max: 2, mean: 2, median: 2 });
    expect(summary).toMatchObject({ answeredCount: 3, unmappedResponseCount: 2 });
  });

  it("keeps finite means and medians for large finite numeric values", () => {
    const q: Question = { id: "q", type: "number", label: "Large value" };
    const summary = summarizeQuestion(q, [respondent(Number.MAX_VALUE), respondent(Number.MAX_VALUE)]);
    expect(summary.numeric?.mean).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(summary.numeric?.median)).toBe(true);
  });

  it("shows scale distributions and a median without calculating a mean", () => {
    const q: Question = { id: "q", type: "scale", label: "Agreement", min: 1, max: 5 };
    const summary = summarizeQuestion(q, [respondent(1), respondent("2"), respondent(5), respondent(6)]);
    expect(summary.scaleMedian).toBe(2);
    expect(summary.numeric).toBeNull();
    expect(summary.unmappedResponseCount).toBe(1);
    expect(summary.distributionDenominator).toBe(3);
  });

  it("does not round a nonzero option share down to zero percent", () => {
    expect(formatPercentage((1 / 201) * 100)).toBe("0.5%");
    expect(formatPercentage((1 / 2001) * 100)).toBe("<0.1%");
  });
});
