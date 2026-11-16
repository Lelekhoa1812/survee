import { describe, expect, it } from "vitest";
import { canSegmentByAnswer, summarizeAnswerSegments } from "../src/lib/analytics/segments";
import type { CohortAnalyticsRespondent } from "../src/lib/analytics/summary";
import type { Question } from "../src/lib/format/schema";

const exactQuantiles = { method: "hyndman_fan_type_7", approximate: false, relativeValueAccuracy: null, binLimitPerSign: null, binsCollapsed: false, mappingRangeExceeded: false, errorGuarantee: "exact" } as const;

const topics: Question = {
  id: "topics",
  type: "multi",
  label: "Topics",
  options: [
    { value: "alpha", label: "Alpha" },
    { value: "beta", label: "Beta" },
    { value: "gamma", label: "Gamma" },
  ],
};
const outcome: Question = {
  id: "outcome",
  type: "single",
  label: "Outcome",
  options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
};
const at = "2026-11-15T00:00:00.000Z";

function respondent(status: CohortAnalyticsRespondent["status"], answers: CohortAnalyticsRespondent["answers"]): CohortAnalyticsRespondent {
  return { status, answers };
}

describe("answer-segment analytics", () => {
  it("keeps checkbox overlap visible and reports no-answer, unmapped, singleton, and zero-count groups", async () => {
    const rows = [
      respondent("submitted", { topics: { value: ["alpha", "beta"], updatedAt: at }, outcome: { value: "yes", updatedAt: at } }),
      respondent("invited", { topics: { value: ["alpha"], updatedAt: at }, outcome: { value: "no", updatedAt: at } }),
      respondent("in_progress", { topics: { note: "private note", updatedAt: at }, outcome: { value: "yes", updatedAt: at } }),
      respondent("submitted", { topics: { value: ["retired"], updatedAt: at }, outcome: { value: "yes", updatedAt: at } }),
      respondent("submitted", { outcome: { value: "yes", updatedAt: at } }),
    ];
    let scans = 0;
    async function* participants() {
      for (const row of rows) {
        scans += 1;
        yield row;
      }
    }

    const result = await summarizeAnswerSegments(topics, [outcome], participants(), undefined, true);
    const alpha = result.segments.find((group) => group.value === "alpha");
    const beta = result.segments.find((group) => group.value === "beta");
    const gamma = result.segments.find((group) => group.value === "gamma");
    const noAnswer = result.segments.find((group) => group.kind === "no_answer");
    const unmapped = result.segments.find((group) => group.kind === "unmapped");

    expect(scans).toBe(rows.length);
    expect(result).toMatchObject({ participantCount: 5, statusCounts: { invited: 1, in_progress: 1, submitted: 3 } });
    expect(alpha).toMatchObject({ participantCount: 2, statusCounts: { invited: 1, in_progress: 0, submitted: 1 }, summaries: { outcome: { cohortCount: 2, distributionDenominator: 2 } } });
    expect(alpha?.summaries.outcome.distribution).toMatchObject([{ value: "yes", count: 1, percent: 50 }, { value: "no", count: 1, percent: 50 }]);
    expect(beta).toMatchObject({ participantCount: 1, disclosureRisk: { singletonSegment: true, singletonStatusGroups: ["submitted"] }, summaries: { outcome: { cohortCount: 1 } } });
    expect(gamma).toMatchObject({ participantCount: 0, summaries: { outcome: { cohortCount: 0, distributionDenominator: 0 } } });
    expect(noAnswer).toMatchObject({ label: "No stored answer", participantCount: 2, statusCounts: { in_progress: 1, submitted: 1 } });
    expect(unmapped).toMatchObject({ label: "Unmapped answer", participantCount: 1, summaries: { outcome: { cohortCount: 1 } } });
    expect(alpha?.statusSummaries?.submitted?.outcome.distributionDenominator).toBe(1);
    expect(alpha?.disclosureRisk).toEqual({ singletonSegment: false, singletonStatusGroups: ["invited", "submitted"] });
    expect(JSON.stringify(result)).not.toContain("private note");
    expect(JSON.stringify(result)).not.toContain("retired");
  });

  it("creates only whole-number groups within fractional scale bounds", async () => {
    const scale: Question = { id: "rating", type: "scale", label: "Rating", min: 1.2, max: 3.8 };
    const result = await summarizeAnswerSegments(scale, [outcome], (async function* () {
      yield respondent("submitted", { rating: { value: 2, updatedAt: at }, outcome: { value: "yes", updatedAt: at } });
      yield respondent("submitted", { rating: { value: 1, updatedAt: at }, outcome: { value: "no", updatedAt: at } });
    })());

    expect(result.segments.map((group) => group.label)).toEqual(["2", "3", "Unmapped answer"]);
    expect(result.segments[0]).toMatchObject({ participantCount: 1, summaries: { outcome: { cohortCount: 1 } } });
    expect(result.segments[2]).toMatchObject({ kind: "unmapped", participantCount: 1 });
  });

  it("retains every zero-count scale value at the 20-step limit", async () => {
    const scale: Question = { id: "rating", type: "scale", label: "Rating", min: 1, max: 21 };
    expect(canSegmentByAnswer(scale)).toBe(true);

    const result = await summarizeAnswerSegments(scale, [outcome], (async function* () {})());

    expect(result.segments).toHaveLength(21);
    expect(result.segments.map((group) => group.label)).toEqual(Array.from({ length: 21 }, (_, index) => String(index + 1)));
    expect(result.segments.every((group) => group.kind === "answer" && group.participantCount === 0)).toBe(true);
  });

  it("rejects over-limit scale segmentation before scanning respondents", async () => {
    const scale: Question = { id: "rating", type: "scale", label: "Rating", min: 1, max: 22 };
    let scans = 0;
    async function* participants() {
      scans += 1;
      yield respondent("submitted", { rating: { value: 1, updatedAt: at } });
    }

    expect(canSegmentByAnswer(scale)).toBe(false);
    await expect(summarizeAnswerSegments(scale, [outcome], participants())).rejects.toThrow("at most 21 integer answer groups");
    expect(scans).toBe(0);
  });

  it("rejects unsafe scale bounds before deriving answer groups", async () => {
    const scale: Question = { id: "rating", type: "scale", label: "Rating", min: 10_000_000_000_000_000, max: 10_000_000_000_000_002 };
    expect(canSegmentByAnswer(scale)).toBe(false);
    await expect(summarizeAnswerSegments(scale, [outcome], (async function* () {})())).rejects.toThrow("using safe integer bounds");
  });

  it("keeps exact numeric Type-7 summaries when status observations are combined", async () => {
    const numericOutcome: Question = { id: "amount", type: "number", label: "Amount" };
    const result = await summarizeAnswerSegments(topics, [numericOutcome], (async function* () {
      yield respondent("invited", { topics: { value: ["alpha"], updatedAt: at }, amount: { value: 1, updatedAt: at } });
      yield respondent("submitted", { topics: { value: ["alpha"], updatedAt: at }, amount: { value: 2, updatedAt: at } });
      yield respondent("submitted", { topics: { value: ["alpha"], updatedAt: at }, amount: { value: 3, updatedAt: at } });
      yield respondent("submitted", { topics: { value: ["alpha"], updatedAt: at }, amount: { value: 4, updatedAt: at } });
    })(), undefined, true);

    const alpha = result.segments.find((group) => group.value === "alpha");
    expect(alpha?.summaries.amount.numeric).toEqual({ n: 4, min: 1, q1: 1.75, median: 2.5, q3: 3.25, max: 4, mean: 2.5, quantiles: exactQuantiles });
    expect(alpha?.statusSummaries?.invited?.amount.numeric).toEqual({ n: 1, min: 1, q1: 1, median: 1, q3: 1, max: 1, mean: 1, quantiles: exactQuantiles });
    expect(alpha?.statusSummaries?.submitted?.amount.numeric).toEqual({ n: 3, min: 2, q1: 2.5, median: 3, q3: 3.5, max: 4, mean: 3, quantiles: exactQuantiles });
  });
});
