import { describe, expect, it } from "vitest";
import { displayValue, eligibilityQuestionIds, evaluateEligibility, isAnswered, progress, validateAnswer } from "../src/lib/format/answers";
import type { Manifest, Question } from "../src/lib/format/schema";

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

  it("enforces an optional multi-select cap on distinct values", () => {
    const capped = { ...checkbox, maxSelections: 2 };
    expect(validateAnswer(capped, ["email", "phone", "email"])).toEqual({ ok: true, value: ["email", "phone"] });
    expect(validateAnswer(capped, ["email", "phone", "other"]).ok).toBe(false);
    expect(validateAnswer(capped, [])).toEqual({ ok: true, value: null });
    expect(validateAnswer(checkbox, ["email", "phone"])).toEqual({ ok: true, value: ["email", "phone"] });
    expect(validateAnswer(capped, ["email", "phone", "email", "phone"], { allowOverLimit: true })).toEqual({ ok: true, value: ["email", "phone"] });
  });

  it("requires exclusive checkbox options to stand alone and blocks legacy conflicts from progress", () => {
    const exclusive = { ...checkbox, exclusiveOptions: ["email"] };
    expect(validateAnswer(exclusive, ["email"])).toEqual({ ok: true, value: ["email"] });
    expect(validateAnswer(exclusive, ["email", "phone"]).ok).toBe(false);
    expect(validateAnswer(exclusive, ["email", "phone"], { allowExclusiveConflict: true })).toEqual({ ok: true, value: ["email", "phone"] });
    expect(progress({ format: "kqa/1", title: "Exclusive", questions: [exclusive] }, {
      channels: { value: ["email", "phone"], updatedAt: "now" },
    }).invalidExclusiveSelections).toEqual([{ id: "channels" }]);
  });

  it("validates a complete rank permutation while preserving respondent order", () => {
    const rank: Question = { id: "priorities", type: "rank", label: "Order these", options: [
      { value: "cost", label: "Cost" }, { value: "speed", label: "Speed" }, { value: "quality", label: "Quality" },
    ] };
    expect(validateAnswer(rank, ["quality", "cost", "speed"])).toEqual({ ok: true, value: ["quality", "cost", "speed"] });
    expect(validateAnswer(rank, [])).toEqual({ ok: true, value: null });
    expect(validateAnswer(rank, ["quality", "cost"]).ok).toBe(false);
    expect(validateAnswer(rank, ["quality", "quality", "speed"]).ok).toBe(false);
    expect(validateAnswer(rank, ["quality", "cost", "other"]).ok).toBe(false);
    expect(isAnswered(rank, { priorities: { value: ["quality", "cost", "speed"], updatedAt: "" } })).toBe(true);
    expect(displayValue(rank, ["quality", "cost", "speed"])).toBe("1. Quality; 2. Cost; 3. Speed");
  });

  it("blocks progress for an eligible saved answer above a newly lowered cap", () => {
    const capped = { ...checkbox, required: false, maxSelections: 1 };
    expect(progress({ format: "kqa/1", title: "Capped", questions: [capped] }, {
      channels: { value: ["email", "phone"], updatedAt: "now" },
    }).invalidSelections).toEqual([{ id: "channels", selected: 2, maximum: 1 }]);
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

  it("evaluates earlier-question routing and excludes inactive questions from required progress", () => {
    const manifest: Manifest = {
      format: "kqa/1", title: "Routing", questions: [
        { id: "kind", type: "single", label: "Kind?", required: true, options: [{ value: "person", label: "Person" }, { value: "org", label: "Organisation" }] },
        { id: "contact", type: "text", label: "Contact", required: true, when: { all: [{ question: "kind", operator: "equals", value: "org" }] } },
        { id: "other", type: "text", label: "Other", when: { any: [{ question: "kind", operator: "equals", value: "person" }, { question: "kind", operator: "equals", value: "org" }] } },
      ],
    };
    const answers = { kind: { value: "person", updatedAt: "" }, contact: { value: "Old contact", updatedAt: "" } };
    expect(evaluateEligibility(manifest, answers)).toEqual({ kind: true, contact: false, other: true });
    expect(progress(manifest, answers)).toMatchObject({ answered: 1, total: 2, requiredTotal: 1, missingRequired: [], inactive: 1 });
    expect(evaluateEligibility(manifest, {})).toEqual({ kind: true, contact: false, other: false });
    expect(evaluateEligibility(manifest, { kind: { value: "org", updatedAt: "" } })).toEqual({ kind: true, contact: true, other: true });
  });

  it("combines all and any groups and handles multi-select membership", () => {
    const manifest: Manifest = {
      format: "kqa/1", title: "Routing", questions: [
        { ...checkbox, required: false },
        { id: "email-only", type: "text", label: "Email details", when: { all: [{ question: "channels", operator: "contains", value: "email" }], any: [{ question: "channels", operator: "contains", value: "email" }, { question: "channels", operator: "contains", value: "phone" }] } },
        { id: "no-email", type: "text", label: "No email", when: { all: [{ question: "channels", operator: "notContains", value: "email" }] } },
      ],
    };
    expect(evaluateEligibility(manifest, { channels: { value: ["email"], updatedAt: "" } })).toEqual({ channels: true, "email-only": true, "no-email": false });
    expect(evaluateEligibility(manifest, { channels: { value: ["phone"], updatedAt: "" } })).toEqual({ channels: true, "email-only": false, "no-email": true });
    // An unanswered parent makes even a negative predicate false.
    expect(evaluateEligibility(manifest, {})).toEqual({ channels: true, "email-only": false, "no-email": false });
  });

  it("routes text and other answer types by answered state, excluding blank values and notes", () => {
    const manifest: Manifest = {
      format: "kqa/1", title: "Answer-state routing", questions: [
        { id: "details", type: "text", label: "Optional details" },
        { id: "follow-up", type: "longtext", label: "More detail", when: { all: [{ question: "details", operator: "answered" }] } },
        { id: "skip", type: "text", label: "No details", when: { any: [{ question: "details", operator: "notAnswered" }] } },
      ],
    };
    expect(evaluateEligibility(manifest, {})).toEqual({ details: true, "follow-up": false, skip: true });
    expect(evaluateEligibility(manifest, { details: { value: "  ", note: "A note alone", updatedAt: "" } })).toEqual({ details: true, "follow-up": false, skip: true });
    expect(evaluateEligibility(manifest, { details: { value: "Some context", updatedAt: "" } })).toEqual({ details: true, "follow-up": true, skip: false });
  });

  it("projects transitive routing dependencies in manifest order for selected analysis questions", () => {
    const manifest: Manifest = {
      format: "kqa/1", title: "Routing", questions: [
        { id: "root", type: "single", label: "Root", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }] },
        { id: "branch", type: "single", label: "Branch", options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }], when: { all: [{ question: "root", operator: "equals", value: "a" }] } },
        { id: "outcome", type: "text", label: "Outcome", when: { any: [{ question: "branch", operator: "equals", value: "x" }] } },
      ],
    };
    expect(eligibilityQuestionIds(manifest, ["outcome"])).toEqual(["root", "branch", "outcome"]);
    expect(eligibilityQuestionIds(manifest, ["branch"])).toEqual(["root", "branch"]);
  });
});
