import { describe, expect, it } from "vitest";
import {
  DEFAULT_ANALYTICS_MIN_CELL_SIZE,
  isValidAnalyticsMinCellSize,
  suppressSmallCohortAnalytics,
} from "../src/lib/analytics/disclosure";

const sampleSummary = {
  cohortCount: 12,
  eligibleCount: 12,
  inactiveCount: 0,
  answeredCount: 10,
  noAnswerCount: 5,
  missingCount: 5,
  noteOnlyCount: 0,
  unmappedResponseCount: 0,
  distributionDenominator: 10,
  distribution: [
    { value: "a", label: "Option A", count: 5, percent: 50 },
    { value: "b", label: "Option B", count: 5, percent: 50 },
  ],
  numeric: { n: 10, min: 1, q1: 2, q3: 4, max: 5, mean: 3, median: 3, quantiles: {} },
  scaleMedian: null,
  scaleMedianRange: null,
  disclosureRisk: {
    singletonCohort: false,
    singletonAnsweredCount: false,
    singletonNoAnswerCount: false,
    singletonNoteOnlyCount: false,
    singletonUnmappedResponseCount: false,
    singletonDistributionDenominator: false,
    singletonDistributionValues: [],
    singletonNumericSummary: false,
  },
};

describe("minimum-cell aggregate analytics suppression", () => {
  it("uses five by default and validates workspace thresholds", () => {
    expect(DEFAULT_ANALYTICS_MIN_CELL_SIZE).toBe(5);
    expect(isValidAnalyticsMinCellSize(2)).toBe(true);
    expect(isValidAnalyticsMinCellSize(100)).toBe(true);
    expect(isValidAnalyticsMinCellSize(1)).toBe(false);
    expect(isValidAnalyticsMinCellSize(101)).toBe(false);
    expect(isValidAnalyticsMinCellSize(5.5)).toBe(false);
    expect(isValidAnalyticsMinCellSize("5")).toBe(false);
  });

  it("returns an aggregate unchanged when every positive count meets the threshold", () => {
    const result = suppressSmallCohortAnalytics(sampleSummary);
    expect(result).toEqual({ suppressed: false, minimumCellSize: 5, value: sampleSummary });
  });

  it("suppresses an entire summary when a distribution cell is small, hiding its derived percentages", () => {
    const source = {
      ...sampleSummary,
      distribution: [
        { value: "sensitive-answer", label: "Sensitive", count: 4, percent: 40 },
        { value: "other", label: "Other", count: 6, percent: 60 },
      ],
    };

    const result = suppressSmallCohortAnalytics(source);
    expect(result).toEqual({ suppressed: true, minimumCellSize: 5, reason: "minimum_cell_size" });
    expect(JSON.stringify(result)).not.toContain("sensitive-answer");
    expect(JSON.stringify(result)).not.toContain("40");
  });

  it("suppresses segment payloads when a status subgroup or nested outcome statistic is small", () => {
    const segments = {
      participantCount: 12,
      statusCounts: { invited: 6, in_progress: 6, submitted: 0 },
      segments: [{
        participantCount: 8,
        statusCounts: { invited: 4, in_progress: 4, submitted: 0 },
        summaries: { outcome: { ...sampleSummary, cohortCount: 8 } },
        statusSummaries: { invited: { outcome: { ...sampleSummary, numeric: { n: 3, mean: 2 } } } },
      }],
    };
    const result = suppressSmallCohortAnalytics(segments);
    expect(result).toEqual({ suppressed: true, minimumCellSize: 5, reason: "minimum_cell_size" });
    expect(JSON.stringify(result)).not.toContain('"n":3');
  });

  it("suppresses crosstabs when a cell or a status cell is small, covering margins and row percentages", () => {
    const crosstab = {
      participantCount: 12,
      statusCounts: { invited: 6, in_progress: 6, submitted: 0 },
      rows: [{ participantCount: 6 }],
      columns: [{ participantCount: 6 }],
      cells: [{ participantCount: 5, rowDenominator: 6, rowPercent: 83.33, statusCounts: { invited: 4, in_progress: 1, submitted: 0 } }],
    };
    const result = suppressSmallCohortAnalytics(crosstab);
    expect(result).toEqual({ suppressed: true, minimumCellSize: 5, reason: "minimum_cell_size" });
    expect(JSON.stringify(result)).not.toContain("83.33");
  });

  it("suppresses undersized selected cohorts and singleton risk signals", () => {
    expect(suppressSmallCohortAnalytics({ participantCount: 4, statusCounts: { invited: 0 } })).toMatchObject({ suppressed: true });
    expect(suppressSmallCohortAnalytics({ participantCount: 8, disclosureRisk: { singletonSegment: true } })).toMatchObject({ suppressed: true });
    expect(suppressSmallCohortAnalytics({ participantCount: 8, disclosureRisk: { singletonStatusGroups: ["submitted"] } })).toMatchObject({ suppressed: true });
  });

  it("keeps true zero counts and empty cohort output visible", () => {
    const zero = { participantCount: 0, statusCounts: { invited: 0, in_progress: 0, submitted: 0 }, cells: [{ participantCount: 0, rowDenominator: 0, rowPercent: null }] };
    expect(suppressSmallCohortAnalytics(zero)).toEqual({ suppressed: false, minimumCellSize: 5, value: zero });
  });

  it("rejects invalid thresholds at the enforcement boundary", () => {
    expect(() => suppressSmallCohortAnalytics({}, 1)).toThrow(RangeError);
    expect(() => suppressSmallCohortAnalytics({}, 5.1)).toThrow(RangeError);
  });
});
