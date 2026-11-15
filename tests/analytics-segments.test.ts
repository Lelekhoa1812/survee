import { describe, expect, it } from "vitest";
import { summarizeAnswerSegments } from "../src/lib/analytics/segments";
import type { CohortAnalyticsRespondent } from "../src/lib/analytics/summary";
import type { Question } from "../src/lib/format/schema";

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
    expect(beta).toMatchObject({ participantCount: 1, summaries: { outcome: { cohortCount: 1 } } });
    expect(gamma).toMatchObject({ participantCount: 0, summaries: { outcome: { cohortCount: 0, distributionDenominator: 0 } } });
    expect(noAnswer).toMatchObject({ label: "No stored answer", participantCount: 2, statusCounts: { in_progress: 1, submitted: 1 } });
    expect(unmapped).toMatchObject({ label: "Unmapped answer", participantCount: 1, summaries: { outcome: { cohortCount: 1 } } });
    expect(alpha?.statusSummaries?.submitted?.outcome.distributionDenominator).toBe(1);
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
});
