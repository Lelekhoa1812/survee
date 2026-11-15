import { describe, expect, it } from "vitest";
import { ANALYTICS_COHORTS, analyticsCohortForStatuses } from "../src/lib/analytics/cohorts";
import { summarizeQuestionCohorts, summarizeSelectedQuestionCohort, type CohortAnalyticsRespondent } from "../src/lib/analytics/summary";
import type { Question } from "../src/lib/format/schema";
import type { ParticipantStatus } from "../src/lib/repo/types";

const at = "2026-11-15T00:00:00.000Z";

async function* stream(rows: CohortAnalyticsRespondent[]) {
  for (const row of rows) yield row;
}

describe("analytics status cohorts", () => {
  it("maps every non-empty status selection to one named cohort", () => {
    expect(ANALYTICS_COHORTS).toHaveLength(7);
    for (const cohort of ANALYTICS_COHORTS) {
      expect(analyticsCohortForStatuses([...cohort.statuses].reverse())?.key).toBe(cohort.key);
    }
    expect(analyticsCohortForStatuses([])).toBeNull();
  });

  it("combines distributions and exact numeric summaries for every selected status", async () => {
    const choice: Question = {
      id: "choice",
      type: "single",
      label: "Choice",
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    };
    const number: Question = { id: "score", type: "number", label: "Score" };
    const rows: CohortAnalyticsRespondent[] = [
      { status: "invited", answers: { choice: { value: "yes", updatedAt: at }, score: { value: 10, updatedAt: at } } },
      { status: "in_progress", answers: { choice: { value: "no", updatedAt: at }, score: { value: 20, updatedAt: at } } },
      { status: "submitted", answers: { choice: { value: "yes", updatedAt: at }, score: { value: 30, updatedAt: at } } },
    ];

    const result = await summarizeQuestionCohorts([choice, number], stream(rows));

    expect(Number.isNaN(Date.parse(result.asOf))).toBe(false);
    expect(result.statusCounts).toEqual({ invited: 1, in_progress: 1, submitted: 1 });
    expect(result.summaries.everyone.choice.distribution.map(({ value, count }) => ({ value, count }))).toEqual([
      { value: "yes", count: 2 },
      { value: "no", count: 1 },
    ]);
    expect(result.summaries.everyone.choice.distribution[0].percent).toBeCloseTo(200 / 3);
    expect(result.summaries.everyone.choice.distribution[1].percent).toBeCloseTo(100 / 3);
    expect(result.summaries["invited,submitted"].score.numeric).toEqual({ n: 2, min: 10, q1: 15, median: 20, q3: 25, max: 30, mean: 20 });
    expect(result.summaries.invited.score.numeric).toEqual({ n: 1, min: 10, q1: 10, median: 10, q3: 10, max: 10, mean: 10 });
    expect(result.summaries.invited.score.eligibleCount).toBe(1);
    expect(result.summaries.submitted.choice.eligibleCount).toBe(1);
    for (const cohort of ANALYTICS_COHORTS) {
      expect(result.summaries[cohort.key].score.eligibleCount).toBe(cohort.statuses.length);
    }
  });

  it("matches the exact all-cohort results while building only the requested MCP cohort", async () => {
    const choice: Question = {
      id: "choice",
      type: "single",
      label: "Choice",
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    };
    const number: Question = { id: "score", type: "number", label: "Score" };
    const rows: CohortAnalyticsRespondent[] = [
      { status: "invited", answers: { choice: { value: "yes", updatedAt: at }, score: { value: 10, updatedAt: at } } },
      { status: "in_progress", answers: { choice: { value: "no", updatedAt: at }, score: { value: 20, updatedAt: at } } },
      { status: "submitted", answers: { choice: { value: "yes", updatedAt: at }, score: { value: 30, updatedAt: at } } },
      { status: "submitted", answers: { choice: { value: "no", updatedAt: at }, score: { value: 40, updatedAt: at } } },
    ];

    const complete = await summarizeQuestionCohorts([choice, number], stream(rows));
    for (const cohort of ANALYTICS_COHORTS) {
      const statuses: ParticipantStatus[] = [...cohort.statuses];
      const selected = await summarizeSelectedQuestionCohort([choice, number], stream(rows), statuses);
      expect(selected.combined).toEqual(complete.summaries[cohort.key]);
      for (const status of statuses) expect(selected.statusSummaries[status]).toEqual(complete.summaries[status]);
      expect(selected.statusCounts).toEqual({
        invited: statuses.includes("invited") ? complete.statusCounts.invited : 0,
        in_progress: statuses.includes("in_progress") ? complete.statusCounts.in_progress : 0,
        submitted: statuses.includes("submitted") ? complete.statusCounts.submitted : 0,
      });
    }
  });
});
