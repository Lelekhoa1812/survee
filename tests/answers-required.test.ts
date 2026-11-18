import { describe, expect, it } from "vitest";
import { isAnswered, validateAnswer } from "../src/lib/format/answers";
import type { Question } from "../src/lib/format/schema";

const checkbox: Question = {
  id: "channels",
  type: "multi",
  label: "Which channels do you use?",
  required: true,
  options: [
    { value: "email", label: "Email" },
    { value: "phone", label: "Phone" },
  ],
};

const line: Question = { id: "company", type: "text", label: "Company", required: true, maxLength: 500 };
const paragraph: Question = { id: "goal", type: "longtext", label: "Goal", required: true };

describe("answered, without scores", () => {
  it("counts a required checkbox when one option is ticked", () => {
    expect(isAnswered(checkbox, { channels: { value: ["email"], updatedAt: "2026-11-13T00:00:00.000Z" } })).toBe(true);
    expect(isAnswered(checkbox, { channels: { value: [], updatedAt: "2026-11-13T00:00:00.000Z" } })).toBe(false);
    expect(isAnswered(checkbox, {})).toBe(false);
  });

  it("treats whitespace-only text as empty", () => {
    expect(validateAnswer(line, "   ")).toEqual({ ok: true, value: null });
    expect(validateAnswer(paragraph, "\n\t  ")).toEqual({ ok: true, value: null });
    expect(isAnswered(line, { company: { value: "   ", updatedAt: "2026-11-13T00:00:00.000Z" } })).toBe(false);
    expect(isAnswered(line, { company: { value: "Acme", updatedAt: "2026-11-13T00:00:00.000Z" } })).toBe(true);
  });

  it("accepts real calendar dates and rejects impossible dates", () => {
    const date: Question = { id: "date", type: "date", label: "Date" };
    for (const value of ["0001-01-01", "2000-02-29", "2024-02-29", "9999-12-31"]) {
      expect(validateAnswer(date, value)).toEqual({ ok: true, value });
    }
    for (const value of ["0000-01-01", "1900-02-29", "2023-02-29", "2024-02-30", "2024-04-31", "2024-00-01", "2024-13-01", "2024-01-00", "2024-1-01"]) {
      expect(validateAnswer(date, value).ok).toBe(false);
    }
    expect(validateAnswer(date, "")).toEqual({ ok: true, value: null });
  });
});
