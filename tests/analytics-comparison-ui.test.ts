import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComparisonQuestion } from "../src/components/AnalyticsTab";
import { summarizeQuestion } from "../src/lib/analytics/summary";
import type { ParticipantStatus } from "../src/lib/repo/types";
import type { Question } from "../src/lib/format/schema";

const at = "2026-11-15T00:00:00.000Z";

describe("status comparison table", () => {
  it("shows an undefined percentage as a dash and exposes response-quality counts", () => {
    const question: Question = {
      id: "choice",
      type: "single",
      label: "Choice",
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    };
    const summaries = {
      invited: summarizeQuestion(question, [{ answers: {} }]),
      in_progress: summarizeQuestion(question, [
        { answers: { choice: { value: "yes", updatedAt: at } } },
        { answers: { choice: { value: "old-option", updatedAt: at } } },
        { answers: { choice: { note: "Context only", updatedAt: at } } },
        { answers: {} },
      ]),
      submitted: summarizeQuestion(question, [
        { answers: { choice: { value: "yes", updatedAt: at } } },
        { answers: { choice: { value: "no", updatedAt: at } } },
      ]),
    } satisfies Record<ParticipantStatus, ReturnType<typeof summarizeQuestion>>;

    const html = renderToStaticMarkup(createElement(ComparisonQuestion, { question, summaries }));

    expect(html).toContain("<th scope=\"row\">Yes</th><td>0 (—)</td>");
    expect(html).toContain("Valid responses (n)");
    expect(html).toContain("<th scope=\"row\">Answered</th><td>0</td><td>2</td><td>2</td>");
    expect(html).toContain("<th scope=\"row\">Missing</th><td>1</td><td>2</td><td>0</td>");
    expect(html).toContain("<th scope=\"row\">Note only</th><td>0</td><td>1</td><td>0</td>");
    expect(html).toContain("<th scope=\"row\">Unmapped</th><td>0</td><td>1</td><td>0</td>");
  });
});
