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
    ], "Everyone");

    expect(csv).toContain("\"distribution\"");
    expect(csv).toContain(`"'=HYPERLINK(""https://example.test"")"`);
    expect(csv).toContain("\"response_count\"");
    expect(csv).not.toContain("Private response text");
    expect(csv).not.toContain("Private note");
  });
});
