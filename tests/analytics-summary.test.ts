import { describe, expect, it } from "vitest";
import { createQuestionSummaryAccumulator, summarizeQuestion, withCurrentEligibility, type AnalyticsRespondent } from "../src/lib/analytics/summary";
import { eligibilityQuestionIds } from "../src/lib/format/answers";
import { formatPercentage } from "../src/lib/analytics/format";
import type { Question } from "../src/lib/format/schema";

const exactQuantiles = {
  method: "hyndman_fan_type_7",
  approximate: false,
  relativeValueAccuracy: null,
  binLimitPerSign: null,
  binsCollapsed: false,
  mappingRangeExceeded: false,
  errorGuarantee: "exact",
} as const;

const at = "2026-11-15T00:00:00.000Z";
const respondent = (value?: string | number | string[], note?: string): AnalyticsRespondent => ({
  answers: value === undefined && note === undefined ? {} : { q: { ...(value === undefined ? {} : { value }), ...(note === undefined ? {} : { note }), updatedAt: at } },
});

describe("descriptive question summaries", () => {
  it("returns exact summaries for a one-person cohort without suppression", () => {
    const choice: Question = { id: "q", type: "single", label: "Choice", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] };
    const number: Question = { id: "q", type: "number", label: "Budget" };

    expect(summarizeQuestion(choice, [respondent("yes")])).toMatchObject({
      cohortCount: 1,
      eligibleCount: 1,
      answeredCount: 1,
      noAnswerCount: 0,
      missingCount: 0,
      distributionDenominator: 1,
      distribution: [
        { value: "yes", label: "Yes", count: 1, percent: 100 },
        { value: "no", label: "No", count: 0, percent: 0 },
      ],
      disclosureRisk: {
        singletonCohort: true,
        singletonAnsweredCount: true,
        singletonNoAnswerCount: false,
        singletonNoteOnlyCount: false,
        singletonUnmappedResponseCount: false,
        singletonDistributionDenominator: true,
        singletonDistributionValues: ["yes"],
        singletonNumericSummary: false,
      },
    });
    const numberSummary = summarizeQuestion(number, [respondent(7)]);
    expect(numberSummary.numeric).toEqual({ n: 1, min: 7, q1: 7, median: 7, q3: 7, max: 7, mean: 7, quantiles: exactQuantiles });
    expect(numberSummary.disclosureRisk.singletonNumericSummary).toBe(true);
  });

  it("keeps cohort, no-answer, note-only, valid, and unmapped counts distinct", () => {
    const q: Question = { id: "q", type: "single", label: "Choice", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] };
    const summary = summarizeQuestion(q, [respondent("yes"), respondent("no"), respondent("retired"), respondent(undefined, "More context"), respondent()]);
    expect(summary).toMatchObject({ cohortCount: 5, eligibleCount: 5, answeredCount: 3, noAnswerCount: 2, missingCount: 2, noteOnlyCount: 1, unmappedResponseCount: 1, distributionDenominator: 2 });
    expect(summary.distribution).toEqual([
      { value: "yes", label: "Yes", count: 1, percent: 50 },
      { value: "no", label: "No", count: 1, percent: 50 },
    ]);
  });

  it("separates current-rule inactive people from eligible nonresponse", () => {
    const q: Question = { id: "details", type: "longtext", label: "Details" };
    const summary = summarizeQuestion(q, [
      { answers: {}, eligibility: { details: true } },
      { answers: {}, eligibility: { details: false } },
      { answers: { details: { value: "old stored answer", updatedAt: at } }, eligibility: { details: false } },
    ]);
    expect(summary).toMatchObject({ cohortCount: 3, eligibleCount: 1, inactiveCount: 2, answeredCount: 0, noAnswerCount: 1 });
  });

  it("projects transitive routing prerequisites and infers eligibility from them", async () => {
    const manifest = {
      format: "kqa/1" as const,
      title: "Routing",
      questions: [
        { id: "start", type: "single" as const, label: "Start?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
        { id: "middle", type: "single" as const, label: "Middle?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }], when: { all: [{ question: "start", operator: "equals" as const, value: "yes" }] } },
        { id: "target", type: "longtext" as const, label: "Target", when: { all: [{ question: "middle", operator: "equals" as const, value: "yes" }] } },
      ],
    };
    expect(eligibilityQuestionIds(manifest, ["target"])).toEqual(["start", "middle", "target"]);
    async function* respondents() {
      yield { answers: { start: { value: "no", updatedAt: at }, middle: { value: "yes", updatedAt: at } } };
    }
    const inferred: Array<{ eligibility: Record<string, boolean> }> = [];
    for await (const item of withCurrentEligibility(manifest, respondents())) inferred.push(item);
    const [respondentWithEligibility] = inferred;
    expect(respondentWithEligibility.eligibility).toMatchObject({ start: true, middle: false, target: false });
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
    expect(summary.disclosureRisk).toMatchObject({ singletonDistributionDenominator: false, singletonDistributionValues: ["b"] });
  });

  it("excludes legacy answers that violate exclusive checkbox options", () => {
    const q: Question = { id: "q", type: "multi", label: "Choices", exclusiveOptions: ["none"], options: [
      { value: "none", label: "None" }, { value: "a", label: "A" }, { value: "b", label: "B" },
    ] };
    const summary = summarizeQuestion(q, [respondent(["none", "a"]), respondent(["a"])]);
    expect(summary).toMatchObject({ answeredCount: 2, unmappedResponseCount: 1, distributionDenominator: 1 });
    expect(summary.distribution.map((item) => item.count)).toEqual([0, 1, 0]);
  });

  it("reports number summaries while retaining non-numeric legacy values as unmapped", () => {
    const q: Question = { id: "q", type: "number", label: "Budget" };
    const summary = summarizeQuestion(q, [respondent(1), respondent(2), respondent(3), respondent("unknown"), respondent()]);
    expect(summary.numeric).toEqual({ n: 3, min: 1, q1: 1.5, median: 2, q3: 2.5, max: 3, mean: 2, quantiles: exactQuantiles });
    expect(summary.unmappedResponseCount).toBe(1);
    expect(summary.answeredCount).toBe(4);
  });

  it("excludes out-of-range number values from descriptive statistics", () => {
    const q: Question = { id: "q", type: "number", label: "Budget", min: 0, max: 10 };
    const summary = summarizeQuestion(q, [respondent(2), respondent(99), respondent("bad")]);
    expect(summary.numeric).toEqual({ n: 1, min: 2, q1: 2, median: 2, q3: 2, max: 2, mean: 2, quantiles: exactQuantiles });
    expect(summary).toMatchObject({ answeredCount: 3, unmappedResponseCount: 2 });
  });

  it("keeps finite means and medians for large finite numeric values", () => {
    const q: Question = { id: "q", type: "number", label: "Large value" };
    const summary = summarizeQuestion(q, [respondent(Number.MAX_VALUE), respondent(Number.MAX_VALUE)]);
    expect(summary.numeric?.mean).toBe(Number.MAX_VALUE);
    expect(summary.numeric?.q1).toBe(Number.MAX_VALUE);
    expect(summary.numeric?.q3).toBe(Number.MAX_VALUE);
    expect(Number.isFinite(summary.numeric?.median)).toBe(true);
  });

  it("uses the documented type-7 interpolation for quartiles", () => {
    const q: Question = { id: "q", type: "number", label: "Score" };
    const summary = summarizeQuestion(q, [respondent(1), respondent(2), respondent(3), respondent(4)]);
    expect(summary.numeric).toMatchObject({ q1: 1.75, median: 2.5, q3: 3.25 });
  });

  it("switches large numeric cohorts to bounded DDSketch quantiles and drops exact observations", () => {
    const q: Question = { id: "q", type: "number", label: "Score" };
    const accumulator = createQuestionSummaryAccumulator(q);
    for (let value = 0; value <= 256; value += 1) accumulator.add(respondent(value));

    const snapshot = accumulator.snapshot();
    const summary = accumulator.finish().numeric!;

    expect(snapshot.numericValues).toEqual([]);
    expect(snapshot.numericSketch).toEqual({ method: "datadog_ddsketch", relativeValueAccuracy: 0.02, binLimitPerSign: 512, binsCollapsed: false, mappingRangeExceeded: false });
    expect(summary).toMatchObject({
      n: 257,
      min: 0,
      max: 256,
      quantiles: {
        method: "datadog_ddsketch",
        approximate: true,
        relativeValueAccuracy: 0.02,
        binLimitPerSign: 512,
        binsCollapsed: false,
        mappingRangeExceeded: false,
        errorGuarantee: "relative_value_error",
      },
    });
    expect(summary.mean).toBeCloseTo(128, 10);
    expect(Math.abs(summary.q1 - 64) / 64).toBeLessThanOrEqual(0.02);
    expect(Math.abs(summary.median - 128) / 128).toBeLessThanOrEqual(0.02);
    expect(Math.abs(summary.q3 - 192) / 192).toBeLessThanOrEqual(0.02);
  });

  it("merges bounded quantile sketches and preserves exact extrema and mean", () => {
    const q: Question = { id: "q", type: "number", label: "Score" };
    const combined = createQuestionSummaryAccumulator(q);
    const source = createQuestionSummaryAccumulator(q);
    for (let value = -128; value <= 128; value += 1) {
      (value < 0 ? combined : source).add(respondent(value));
    }

    combined.merge(source);
    const snapshot = combined.snapshot();
    const summary = combined.finish().numeric!;

    expect(snapshot.numericValues).toEqual([]);
    expect(summary).toMatchObject({
      n: 257,
      min: -128,
      max: 128,
      quantiles: { method: "datadog_ddsketch", approximate: true, binsCollapsed: false },
    });
    expect(summary.mean).toBeCloseTo(0, 10);
  });

  it("merges negative bins from two already-promoted sketches", () => {
    const q: Question = { id: "q", type: "number", label: "Score" };
    const target = createQuestionSummaryAccumulator(q);
    const source = createQuestionSummaryAccumulator(q);
    for (let value = -257; value <= -1; value += 1) target.add(respondent(value));
    for (let value = -514; value <= -258; value += 1) source.add(respondent(value));

    target.merge(source);
    const summary = target.finish().numeric!;

    expect(summary).toMatchObject({
      n: 514,
      min: -514,
      max: -1,
      quantiles: { method: "datadog_ddsketch", approximate: true, binsCollapsed: false, mappingRangeExceeded: false, errorGuarantee: "relative_value_error" },
    });
    expect(summary.median).toBeLessThan(-250);
    expect(summary.median).toBeGreaterThan(-270);
  });

  it("keeps approximate quartiles finite at floating-point extremes", () => {
    const q: Question = { id: "q", type: "number", label: "Large value" };
    const summary = summarizeQuestion(q, Array.from({ length: 257 }, () => respondent(Number.MAX_VALUE))).numeric!;

    expect(summary).toMatchObject({
      n: 257,
      min: Number.MAX_VALUE,
      max: Number.MAX_VALUE,
      q1: Number.MAX_VALUE,
      median: Number.MAX_VALUE,
      q3: Number.MAX_VALUE,
      quantiles: { approximate: true, binsCollapsed: false, mappingRangeExceeded: true, errorGuarantee: "not_guaranteed" },
    });
    expect(Number.isFinite(summary.median)).toBe(true);
    expect(summary.mean / Number.MAX_VALUE).toBeCloseTo(1, 14);
  });

  it("marks collapsed DDSketch bins when extreme ranges remove the relative-error guarantee", () => {
    const q: Question = { id: "q", type: "number", label: "Score" };
    const respondents = Array.from({ length: 255 }, (_, value) => respondent(value));
    respondents.push(respondent(1e-300), respondent(1e300));
    const summary = summarizeQuestion(q, respondents).numeric!;

    expect(summary).toMatchObject({
      n: 257,
      min: 0,
      max: 1e300,
      quantiles: { approximate: true, binsCollapsed: true, mappingRangeExceeded: false, errorGuarantee: "not_guaranteed" },
    });
  });

  it("merges exact numeric values without exposing mutable snapshots to the merge", () => {
    const q: Question = { id: "q", type: "number", label: "Score" };
    const combined = createQuestionSummaryAccumulator(q);
    const source = createQuestionSummaryAccumulator(q);
    combined.add(respondent(1));
    source.add(respondent(3));
    source.add(respondent(8));

    const snapshot = source.snapshot();
    snapshot.numericValues.push(1000);
    combined.merge(source);

    expect(combined.finish().numeric).toEqual({ n: 3, min: 1, q1: 2, median: 3, q3: 5.5, max: 8, mean: 4, quantiles: exactQuantiles });
    expect(source.finish().numeric).toEqual({ n: 2, min: 3, q1: 4.25, median: 5.5, q3: 6.75, max: 8, mean: 5.5, quantiles: exactQuantiles });
  });

  it("can consume an accumulator after a one-shot merge without retaining source observations", () => {
    const q: Question = { id: "q", type: "number", label: "Score" };
    const combined = createQuestionSummaryAccumulator(q);
    const source = createQuestionSummaryAccumulator(q);
    for (const value of [1, 3, 8]) source.add(respondent(value));

    combined.merge(source, { consumeSource: true });

    expect(combined.finish().numeric).toEqual({ n: 3, min: 1, q1: 2, median: 3, q3: 5.5, max: 8, mean: 4, quantiles: exactQuantiles });
    expect(source.snapshot()).toMatchObject({ cohortCount: 0, answeredCount: 0, distributionDenominator: 0, numericValues: [] });
  });

  it("shows scale distributions and the observed middle category without calculating a mean", () => {
    const q: Question = { id: "q", type: "scale", label: "Agreement", min: 1, max: 5 };
    const summary = summarizeQuestion(q, [respondent(1), respondent("2"), respondent(5), respondent(6)]);
    expect(summary.scaleMedian).toBe(2);
    expect(summary.scaleMedianRange).toEqual({ lower: 2, upper: 2 });
    expect(summary.numeric).toBeNull();
    expect(summary.unmappedResponseCount).toBe(1);
    expect(summary.distributionDenominator).toBe(3);
  });

  it("bounds scale category allocation and rejects unsafe integer bounds", () => {
    const maximum = createQuestionSummaryAccumulator({ id: "q", type: "scale", label: "Scale", min: 1, max: 21 });
    expect(maximum.finish().distribution).toHaveLength(21);
    expect(() => createQuestionSummaryAccumulator({ id: "q", type: "scale", label: "Large scale", min: 1, max: 1_000_000_000 }))
      .toThrow("at most 21 safely representable integer categories");
    expect(() => createQuestionSummaryAccumulator({ id: "q", type: "scale", label: "Unsafe scale", min: 10_000_000_000_000_000, max: 10_000_000_000_000_002 }))
      .toThrow("safely representable integer categories");
    expect(() => createQuestionSummaryAccumulator({ id: "q", type: "scale", label: "Empty scale", min: 5, max: 5 }))
      .toThrow("non-empty range");
  });

  it("preserves both observed central categories for an even ordinal scale cohort", () => {
    const q: Question = { id: "q", type: "scale", label: "Agreement", min: 1, max: 5 };
    const summary = summarizeQuestion(q, [respondent(1), respondent(2)]);

    expect(summary.scaleMedian).toBe(1);
    expect(summary.scaleMedianRange).toEqual({ lower: 1, upper: 2 });
    expect(summary.scaleMedianRange).not.toEqual({ lower: 1.5, upper: 1.5 });
    expect(summary.numeric).toBeNull();
  });

  it("derives exact scale medians from merged bounded category counts", () => {
    const q: Question = { id: "q", type: "scale", label: "Agreement", min: 1, max: 5 };
    const first = createQuestionSummaryAccumulator(q);
    const second = createQuestionSummaryAccumulator(q);
    for (const value of [1, 2, 5]) first.add(respondent(value));
    for (const value of [2, 3, 5]) second.add(respondent(value));

    const combined = createQuestionSummaryAccumulator(q);
    combined.merge(first);
    combined.merge(second);

    expect(combined.snapshot().numericValues).toEqual([]);
    expect(combined.finish()).toMatchObject({
      distributionDenominator: 6,
      scaleMedian: 2,
      scaleMedianRange: { lower: 2, upper: 3 },
      numeric: null,
    });
  });

  it("does not round a nonzero option share down to zero percent", () => {
    expect(formatPercentage((1 / 201) * 100)).toBe("0.5%");
    expect(formatPercentage((1 / 2001) * 100)).toBe("<0.1%");
  });
});
