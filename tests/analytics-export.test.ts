import { describe, expect, it } from "vitest";
import { buildAnalyticsCsv } from "../src/lib/analytics/export";
import { summarizeQuestion } from "../src/lib/analytics/summary";
import { questionSchema } from "../src/lib/format/schema";

describe("analytics CSV export", () => {
  it("exports aggregate counts without respondent text and protects formula-like labels", () => {
    const choice = questionSchema.parse({
      id: "contact_method",
      type: "single",
      label: "Preferred contact method",
      options: [
        { value: "email", label: '=HYPERLINK("https://example.test")' },
        { value: "phone", label: "Phone" },
      ],
    });
    const paragraph = questionSchema.parse({ id: "reason", type: "longtext", label: "Why?" });
    const people = [
      { answers: { contact_method: { value: "email", updatedAt: "2026-11-15T00:00:00.000Z" }, reason: { value: "Private response text", updatedAt: "2026-11-15T00:00:00.000Z" } } },
      { answers: { contact_method: { value: "phone", updatedAt: "2026-11-15T00:00:00.000Z" }, reason: { note: "Private note", updatedAt: "2026-11-15T00:00:00.000Z" } } },
    ];
    const csv = buildAnalyticsCsv([
      { question: choice, summary: summarizeQuestion(choice, people) },
      { question: paragraph, summary: summarizeQuestion(paragraph, people) },
    ], "Everyone", { interviewId: "interview-123", surveyVersion: 2, asOf: "2026-11-15T00:00:00.000Z" });

    expect(csv).toContain("\"distribution\"");
    expect(csv.split("\r\n")[0]).toContain('"cohort","interview_id","survey_version","as_of","measure"');
    expect(csv).toContain('"Everyone","interview-123","2","2026-11-15T00:00:00.000Z"');
    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).toContain("\"response_count\"");
    expect(csv.split("\r\n")[0]).toContain('"cohort_count","answered","no_answer","no_answer_note"');
    expect(csv.split("\r\n")[0]).toContain('"note_only","unmapped"');
    expect(csv).toContain("KQA does not track conditional or routed item display");
    expect(csv).toContain('"2","2","2","0","KQA does not track conditional or routed item display');
    expect(csv).toContain('"1","2","1","1","KQA does not track conditional or routed item display');
    expect(csv).not.toContain("Private response text");
    expect(csv).not.toContain("Private note");
  });

  it("keeps answered and valid counts separate for an unmapped legacy value", () => {
    const option = questionSchema.parse({ id: "choice", type: "single", label: "Choice", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] });
    const summary = summarizeQuestion(option, [
      { answers: { choice: { value: "yes", updatedAt: "2026-11-15T00:00:00.000Z" } } },
      { answers: { choice: { value: "old-option", updatedAt: "2026-11-15T00:00:00.000Z" } } },
    ]);
    expect(summary.answeredCount).toBe(2);
    expect(summary.unmappedResponseCount).toBe(1);
    expect(summary.distributionDenominator).toBe(1);
    const csv = buildAnalyticsCsv([{ question: option, summary }], "Everyone");
    expect(csv).toContain('"1","2","2","0","KQA does not track conditional or routed item display');
    expect(csv).toContain('"0","1",,,,,,');
  });

  it("keeps per-status cohort labels in comparison exports", () => {
    const choice = questionSchema.parse({ id: "choice", type: "single", label: "Choice", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] });
    const summary = summarizeQuestion(choice, [{ answers: { choice: { value: "yes", updatedAt: "2026-11-15T00:00:00.000Z" } } }]);
    const csv = buildAnalyticsCsv([{ question: choice, summary, cohort: "Submitted" }], "Everyone", {
      interviewId: "interview-123", surveyVersion: 3, asOf: "2026-11-15T00:00:00.000Z",
    });
    expect(csv.split("\r\n")[1]).toContain('"Submitted","interview-123","3","2026-11-15T00:00:00.000Z"');
  });

  it("carries singleton disclosure signals with grouped CSV rows", () => {
    const number = questionSchema.parse({ id: "score", type: "number", label: "Score" });
    const summary = summarizeQuestion(number, [{ answers: { score: { value: 3, updatedAt: "2026-11-15T00:00:00.000Z" } } }]);
    const csv = buildAnalyticsCsv([{
      question: number,
      summary,
      cohort: "Region = North · Submitted",
      disclosureRisk: { singletonSegment: true, singletonStatusGroups: ["submitted"] },
    }], "Everyone");

    expect(csv.split("\r\n")[0]).toContain('"disclosure_risk_singleton_segment","disclosure_risk_singleton_status_groups","disclosure_risk_note"');
    expect(csv).toContain('"true","submitted","Singleton signals only; no minimum group threshold or anonymity guarantee."');
  });

  it("exports type-7 quartiles with the numeric summary", () => {
    const number = questionSchema.parse({ id: "score", type: "number", label: "Score" });
    const summary = summarizeQuestion(number, [
      { answers: { score: { value: 1, updatedAt: "2026-11-15T00:00:00.000Z" } } },
      { answers: { score: { value: 2, updatedAt: "2026-11-15T00:00:00.000Z" } } },
      { answers: { score: { value: 3, updatedAt: "2026-11-15T00:00:00.000Z" } } },
      { answers: { score: { value: 4, updatedAt: "2026-11-15T00:00:00.000Z" } } },
    ]);
    const csv = buildAnalyticsCsv([{ question: number, summary }], "Everyone");
    expect(csv.split("\r\n")[0]).toContain('"min","q1","median","q3","mean","max"');
    expect(csv.split("\r\n")[1]).toContain('"1","1.75","2.5","3.25","2.5","4"');
  });
});
