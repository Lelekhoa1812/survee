import { describe, expect, it } from "vitest";
import { displayValue, eligibilityQuestionIds, evaluateEligibility, isAnswered, progress, validateAnswer } from "../src/lib/format/answers";
import type { Manifest, Question, RepeatRecordMap } from "../src/lib/format/schema";

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

  it("allows blank optional multi answers but requires a minimum once choices are selected", () => {
    const minimum = { ...checkbox, required: false, minSelections: 2 };
    expect(validateAnswer(minimum, [])).toEqual({ ok: true, value: null });
    expect(validateAnswer(minimum, ["email", "email"])).toEqual({ ok: false, reason: "choose at least 2 options or leave this question blank" });
    expect(validateAnswer(minimum, ["email", "phone"])).toEqual({ ok: true, value: ["email", "phone"] });
    expect(validateAnswer(minimum, ["email"], { allowUnderMinSelections: true })).toEqual({ ok: true, value: ["email"] });
    expect(progress({ format: "kqa/1", title: "Minimum", questions: [minimum] }, {
      channels: { value: ["email"], updatedAt: "now" },
    }).invalidMinimumSelections).toEqual([{ id: "channels", selected: 1, minimum: 2 }]);
    expect(progress({ format: "kqa/1", title: "Minimum", questions: [minimum] }, {}).invalidMinimumSelections).toEqual([]);
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
    expect(isAnswered(rank, { priorities: { value: ["quality", "cost"], updatedAt: "" } })).toBe(false);
    expect(isAnswered(rank, { priorities: { value: ["quality", "cost", "retired"], updatedAt: "" } })).toBe(false);
    expect(displayValue(rank, ["quality", "cost", "speed"])).toBe("1. Quality; 2. Cost; 3. Speed");
  });

  it("flags a saved rank that no longer matches the current option set", () => {
    const current: Question = { id: "priorities", type: "rank", label: "Order these", options: [
      { value: "cost", label: "Cost" }, { value: "quality", label: "Quality" }, { value: "speed", label: "Speed" }, { value: "access", label: "Access" },
    ] };
    const manifest: Manifest = { format: "kqa/1", title: "Updated ranking", questions: [current] };
    expect(progress(manifest, { priorities: { value: ["quality", "cost", "speed"], updatedAt: "now" } })).toMatchObject({
      answered: 0, invalidRankSelections: [{ id: "priorities" }],
    });
    const removed: Question = { ...current, options: current.options!.slice(0, 3) };
    expect(progress({ ...manifest, questions: [removed] }, { priorities: { value: ["quality", "cost", "speed", "access"], updatedAt: "now" } })).toMatchObject({
      answered: 0, invalidRankSelections: [{ id: "priorities" }],
    });
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

  it("compares numeric and scale values at explicit inclusive and exclusive boundaries", () => {
    const operators = ["lt", "lte", "gt", "gte", "eq", "ne"] as const;
    const manifest: Manifest = { format: "kqa/1", title: "Typed routing", questions: [
      { id: "amount", type: "number", label: "Amount", min: -10, max: 10 },
      ...operators.map((operator) => ({ id: operator, type: "text" as const, label: operator, when: { all: [{ question: "amount", operator, value: 5 }] } })),
      { id: "rating", type: "scale", label: "Rating", min: 1, max: 5 },
      { id: "high-rating", type: "text", label: "High rating", when: { all: [{ question: "rating", operator: "gte" as const, value: 4 }] } },
    ] };
    const answers = { amount: { value: 5, updatedAt: "now" }, rating: { value: 4, updatedAt: "now" } };
    expect(evaluateEligibility(manifest, answers)).toMatchObject({ lt: false, lte: true, gt: false, gte: true, eq: true, ne: false, "high-rating": true });
    expect(evaluateEligibility(manifest, { amount: { value: 0, updatedAt: "now" }, rating: { value: 1, updatedAt: "now" } })).toMatchObject({ lt: true, lte: true, gt: false, gte: false, eq: false, ne: true, "high-rating": false });
    expect(evaluateEligibility(manifest, { amount: { value: -3.25, updatedAt: "now" }, rating: { value: 5, updatedAt: "now" } })).toMatchObject({ lt: true, lte: true, gt: false, gte: false, eq: false, ne: true, "high-rating": true });
  });

  it("fails closed for missing, malformed, out-of-range or ineligible numeric sources, including ne", () => {
    const manifest: Manifest = { format: "kqa/1", title: "Typed routing", questions: [
      { id: "branch", type: "single", label: "Branch", options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] },
      { id: "amount", type: "number", label: "Amount", min: 0, max: 10, when: { all: [{ question: "branch", operator: "equals", value: "open" }] } },
      { id: "follow-up", type: "text", label: "Follow-up", when: { all: [{ question: "amount", operator: "ne", value: 0 }] } },
    ] };
    expect(evaluateEligibility(manifest, {})).toEqual({ branch: true, amount: false, "follow-up": false });
    expect(evaluateEligibility(manifest, { branch: { value: "open", updatedAt: "now" } })).toMatchObject({ amount: true, "follow-up": false });
    expect(evaluateEligibility(manifest, { branch: { value: "closed", updatedAt: "now" }, amount: { value: 5, updatedAt: "now" } })).toMatchObject({ amount: false, "follow-up": false });
    expect(evaluateEligibility(manifest, { branch: { value: "open", updatedAt: "now" }, amount: { value: "5" as unknown as number, updatedAt: "now" } })).toMatchObject({ amount: true, "follow-up": false });
    expect(evaluateEligibility(manifest, { branch: { value: "open", updatedAt: "now" }, amount: { value: -1, updatedAt: "now" } })).toMatchObject({ amount: true, "follow-up": false });
    expect(evaluateEligibility(manifest, { branch: { value: "open", updatedAt: "now" }, amount: { value: 0, updatedAt: "now" } })).toMatchObject({ amount: true, "follow-up": false });
  });

  it("compares dates as strict calendar values without timezone conversion", () => {
    const manifest: Manifest = { format: "kqa/1", title: "Date routing", questions: [
      { id: "start", type: "date", label: "Start date" },
      { id: "before", type: "text", label: "Before", when: { all: [{ question: "start", operator: "lt", value: "2000-03-01" }] } },
      { id: "on-or-after", type: "text", label: "On or after", when: { all: [{ question: "start", operator: "gte", value: "2000-03-01" }] } },
      { id: "not-equal", type: "text", label: "Not equal", when: { all: [{ question: "start", operator: "ne", value: "2000-02-29" }] } },
    ] };
    expect(evaluateEligibility(manifest, { start: { value: "2000-02-29", updatedAt: "now" } })).toEqual({ start: true, before: true, "on-or-after": false, "not-equal": false });
    expect(evaluateEligibility(manifest, { start: { value: "2000-03-01", updatedAt: "now" } })).toEqual({ start: true, before: false, "on-or-after": true, "not-equal": true });
    expect(evaluateEligibility(manifest, { start: { value: "2000-02-30" as unknown as string, updatedAt: "now" } })).toEqual({ start: true, before: false, "on-or-after": false, "not-equal": false });
    expect(evaluateEligibility(manifest, {})).toEqual({ start: true, before: false, "on-or-after": false, "not-equal": false });
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

  it("allows only answer-state routing from repeated groups and fails closed on comparisons", () => {
    const manifest: Manifest = { format: "kqa/1", title: "Repeat routing", questions: [
      { id: "assets", type: "repeat", label: "Assets", maxRows: 3, fields: [{ id: "name", type: "text", label: "Name" }] },
      { id: "present", type: "text", label: "Has records", when: { all: [{ question: "assets", operator: "answered" }] } },
      { id: "absent", type: "text", label: "No records", when: { all: [{ question: "assets", operator: "notAnswered" }] } },
      { id: "invalid-negative", type: "text", label: "Invalid comparison", when: { all: [{ question: "assets", operator: "notEquals", value: "x" }] } },
      { id: "invalid-typed", type: "text", label: "Invalid typed comparison", when: { all: [{ question: "assets", operator: "gte", value: 1 }] } },
    ] };
    const groups = { assets: [{ id: "r1", values: { name: "A" }, revision: 0, fieldRevisions: {} }] };
    expect(evaluateEligibility(manifest, {}, groups)).toEqual({ assets: true, present: true, absent: false, "invalid-negative": false, "invalid-typed": false });
    expect(evaluateEligibility(manifest, {}, {})).toEqual({ assets: true, present: false, absent: true, "invalid-negative": false, "invalid-typed": false });
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

  it("counts a repeat group once and validates required rows and fields", () => {
    const manifest: Manifest = { format: "kqa/1", title: "Records", questions: [
      { id: "jobs", type: "repeat", label: "Jobs", required: true, maxRows: 3, fields: [
        { id: "title", type: "text", label: "Title", required: true },
        { id: "start", type: "date", label: "Start" },
      ] },
      { id: "follow", type: "text", label: "Follow up", when: { all: [{ question: "jobs", operator: "answered" }] } },
    ] };
    const empty = progress(manifest, {});
    expect(empty).toMatchObject({ total: 1, answered: 0, missingRequired: ["jobs"], repeatErrors: [{ questionId: "jobs", reason: "add at least 1 record" }] });
    const groups: RepeatRecordMap = { jobs: [
      { id: "job-1", values: {}, revision: 0, fieldRevisions: {} },
      { id: "job-2", values: { title: "Research", start: "2024-02-30" }, revision: 1, fieldRevisions: { title: 1, start: 1 } },
    ] };
    const current = progress(manifest, {}, groups);
    expect(current).toMatchObject({ total: 2, answered: 1, requiredAnswered: 1, repeatErrors: [
      { questionId: "jobs", rowId: "job-1", fieldId: "title" },
      { questionId: "jobs", rowId: "job-2", fieldId: "start" },
    ] });
  });

  it("does not accept repeat data in scalar AnswerValue validation", () => {
    const repeat: Question = { id: "items", type: "repeat", label: "Items", maxRows: 2, fields: [{ id: "name", type: "text", label: "Name" }] };
    expect(validateAnswer(repeat, "value")).toMatchObject({ ok: false, reason: expect.stringContaining("record groups") });
  });

  it("retains but does not validate repeat rows while their route is inactive", () => {
    const manifest: Manifest = { format: "kqa/1", title: "Routed records", questions: [
      { id: "kind", type: "single", label: "Kind", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
      { id: "details", type: "repeat", label: "Details", required: true, maxRows: 2, fields: [{ id: "name", type: "text", label: "Name", required: true }], when: { all: [{ question: "kind", operator: "equals", value: "yes" }] } },
    ] };
    const result = progress(manifest, { kind: { value: "no", updatedAt: "now" } }, { details: [{ id: "draft", values: {}, revision: 0, fieldRevisions: {} }] });
    expect(result).toMatchObject({ inactive: 1, missingRequired: [], repeatErrors: [] });
  });
});
