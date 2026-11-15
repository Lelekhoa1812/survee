import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AnalyticsTab } from "../src/components/AnalyticsTab";
import { ANALYTICS_COHORTS } from "../src/lib/analytics/cohorts";
import { summarizeQuestion } from "../src/lib/analytics/summary";
import type { InterviewData } from "../src/components/interview-types";
import type { Question } from "../src/lib/format/schema";

describe("analytics distribution chart", () => {
  it("keeps zero-count answer options visible when no responses are valid", () => {
    const question: Question = {
      id: "choice",
      type: "single",
      label: "Choice",
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    };
    const summary = summarizeQuestion(question, []);
    const summaries = Object.fromEntries(ANALYTICS_COHORTS.map((cohort) => [cohort.key, { choice: summary }])) as unknown as NonNullable<InterviewData["analysis"]>["summaries"];
    const data = {
      interview: { id: "interview-1", name: "Research interview", mode: "multi", status: "open", currentVersion: 1, createdAt: "2026-01-01T00:00:00.000Z" },
      people: [],
      versions: [],
      events: [],
      manifest: { format: "kqa/1", title: "Research interview", questions: [question], sections: [] },
      publicOrigin: null,
      analysis: {
        asOf: "2026-11-15T00:00:00.000Z",
        statusCounts: { invited: 0, in_progress: 0, submitted: 0 },
        summaries,
      },
    } as InterviewData;

    const html = renderToStaticMarkup(createElement(AnalyticsTab, { data }));

    expect(html).toContain("No valid responses to chart yet. Counts are zero and percentages are unavailable.");
    expect(html).toContain('aria-label="Answer distribution for Choice; 0 valid responses"');
    expect(html).toContain('<span class="analysis-bar-label" title="Yes">Yes</span>');
    expect(html).toContain('<span class="analysis-bar-label" title="No">No</span>');
    expect(html.match(/<span class="analysis-bar-value">0 <span class="muted">\(—\)<\/span><\/span>/g)).toHaveLength(2);
  });
});
