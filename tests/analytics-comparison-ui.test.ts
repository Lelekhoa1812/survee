import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ComparisonQuestion } from "../src/components/AnalyticsTab";
import { summarizeQuestion } from "../src/lib/analytics/summary";
import type { ParticipantStatus } from "../src/lib/repo/types";
import type { Question } from "../src/lib/format/schema";

const at = "2026-11-15T00:00:00.000Z";

describe("status comparison", () => {
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
    expect(html).toContain("<th scope=\"row\">No answer</th><td>1</td><td>2</td><td>0</td>");
    expect(html).toContain("Cohort n=4");
    expect(html).toContain("<th scope=\"row\">Note only</th><td>0</td><td>1</td><td>0</td>");
    expect(html).toContain("<th scope=\"row\">Unmapped</th><td>0</td><td>1</td><td>0</td>");
  });

  it("compares categorical shares on each status group's valid-response denominator and keeps the table available", () => {
    const question: Question = {
      id: "choice",
      type: "single",
      label: "Strategic fit",
      options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }],
    };
    const summaries = {
      invited: summarizeQuestion(question, [
        { answers: { choice: { value: "yes", updatedAt: at } } },
        { answers: { choice: { value: "yes", updatedAt: at } } },
        { answers: {} },
      ]),
      in_progress: summarizeQuestion(question, [
        { answers: { choice: { value: "yes", updatedAt: at } } },
        { answers: { choice: { value: "no", updatedAt: at } } },
      ]),
      submitted: summarizeQuestion(question, [{ answers: {} }]),
    } satisfies Record<ParticipantStatus, ReturnType<typeof summarizeQuestion>>;

    const html = renderToStaticMarkup(createElement(ComparisonQuestion, { question, summaries, display: "chart" }));

    expect(html).toContain("Answer shares by status for Strategic fit");
    expect(html).toContain("Invited · not started · valid n=2");
    expect(html).toContain('aria-label="In progress: 1 of 2 valid responses, 50%"');
    expect(html).toContain('aria-label="Submitted: 0 of 0 valid responses"');
    expect(html).toContain("Show data table");
    expect(html).toContain('<th scope="row">Yes</th><td>2 (100%)</td><td>1 (50%)</td><td>0 (—)</td>');
  });

  it("aligns numeric ranges to one shared scale and labels each quartile summary", () => {
    const question: Question = { id: "budget", type: "number", label: "Budget" };
    const answer = (value: number) => ({ answers: { budget: { value, updatedAt: at } } });
    const summaries = {
      invited: summarizeQuestion(question, [answer(0), answer(10)]),
      in_progress: summarizeQuestion(question, [answer(100)]),
      submitted: summarizeQuestion(question, [{ answers: {} }]),
    } satisfies Record<ParticipantStatus, ReturnType<typeof summarizeQuestion>>;

    const html = renderToStaticMarkup(createElement(ComparisonQuestion, { question, summaries, display: "chart" }));

    expect(html).toContain('aria-label="Invited · not started numeric range: minimum 0, first quartile 2.5, median 5, third quartile 7.5, maximum 10; valid n=2"');
    expect(html).toContain("Min 0");
    expect(html).toContain("Max 100");
    expect(html).toContain("No valid numeric responses.");
    expect(html).toContain("Mean");
    expect(html).toContain("Show data table");
  });

  it("explains that checkbox shares can total more than one hundred percent", () => {
    const question: Question = {
      id: "topics",
      type: "multi",
      label: "Topics",
      options: [{ value: "a", label: "A" }, { value: "b", label: "B" }],
    };
    const summaries = {
      invited: summarizeQuestion(question, [{ answers: { topics: { value: ["a", "b"], updatedAt: at } } }]),
      in_progress: summarizeQuestion(question, []),
      submitted: summarizeQuestion(question, []),
    } satisfies Record<ParticipantStatus, ReturnType<typeof summarizeQuestion>>;

    const html = renderToStaticMarkup(createElement(ComparisonQuestion, { question, summaries, display: "chart" }));

    expect(html).toContain("Checkbox percentages are respondent shares and can total more than 100%");
    expect(html).toContain("Invited · not started · valid n=1");
    expect(html).toContain('aria-label="Submitted: 0 of 0 valid responses"');
  });

  it("keeps extreme numeric ranges out of invalid chart coordinates", () => {
    const question: Question = { id: "budget", type: "number", label: "Budget" };
    const answer = (value: number) => ({ answers: { budget: { value, updatedAt: at } } });
    const summaries = {
      invited: summarizeQuestion(question, [answer(-1e308), answer(1e308)]),
      in_progress: summarizeQuestion(question, []),
      submitted: summarizeQuestion(question, []),
    } satisfies Record<ParticipantStatus, ReturnType<typeof summarizeQuestion>>;

    const html = renderToStaticMarkup(createElement(ComparisonQuestion, { question, summaries, display: "chart" }));

    expect(html).toContain("too wide to draw on a finite linear axis");
    expect(html).toContain("Show data table");
    expect(html).not.toContain("Infinity%");
    expect(html).not.toContain("NaN%");
  });
});
