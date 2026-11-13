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
});
