import { describe, expect, it } from "vitest";
import type { Question } from "../src/lib/format/schema";
import { FIELD_LABELS, fieldsForQuestion, formatQuestionFieldValue, summarizeQuestionChanges } from "../src/lib/survey-changes";

function question(id: string, extra: Partial<Question> = {}): Question {
  return { id, type: "text", label: `Question ${id}`, ...extra };
}

describe("survey candidate question changes", () => {
  it("retains the actual before and candidate values for every changed field", () => {
    const before = [question("q1", {
      label: "Old wording",
      type: "single",
      required: false,
      section: "intro",
      options: [{ label: "Keep", value: "keep" }, { label: "Leave", value: "leave" }],
      min: 1,
      max: 5,
      help: "Choose one",
    })];
    const after = [question("q1", {
      label: "New wording",
      type: "scale",
      required: true,
      section: "closing",
      min: 0,
      max: 10,
      step: 2,
      help: "Rate your experience",
      note: { label: "Why?", placeholder: "Optional reason", maxLength: 300 },
    })];

    const changes = summarizeQuestionChanges(before, after);
    expect(changes.updated).toHaveLength(1);
    expect(changes.updated[0]).toEqual({
      previous: before[0],
      question: after[0],
      fields: ["label", "type", "required", "section", "options", "min", "max", "step", "help", "note"],
    });
    expect(formatQuestionFieldValue("label", changes.updated[0].previous, [])).toBe("Old wording");
    expect(formatQuestionFieldValue("label", changes.updated[0].question, [])).toBe("New wording");
    expect(formatQuestionFieldValue("options", changes.updated[0].previous, [])).toBe("Keep (value: keep); Leave (value: leave)");
    expect(formatQuestionFieldValue("options", changes.updated[0].question, [])).toBe("Not applicable");
    expect(formatQuestionFieldValue("section", changes.updated[0].previous, [{ id: "intro", title: "Introduction" }])).toBe("Introduction (intro)");
    expect(formatQuestionFieldValue("section", changes.updated[0].question, [])).toBe("closing");
    expect(formatQuestionFieldValue("note", changes.updated[0].question, [])).toContain("Why? · placeholder: Optional reason · 300 characters maximum");
    expect(changes.moved).toEqual([]);
  });

  it("provides relevant settings for added and removed questions", () => {
    const oldQuestion = question("old", { type: "longtext", required: true, maxLength: 1200, help: "Old help" });
    const newQuestion = question("new", {
      type: "single",
      options: [{ label: "A", value: "a" }, { label: "B", value: "b" }],
      custom: true,
    });

    const changes = summarizeQuestionChanges([oldQuestion], [newQuestion]);
    expect(changes.removed).toEqual([oldQuestion]);
    expect(changes.added).toEqual([newQuestion]);
    expect(fieldsForQuestion(newQuestion)).toEqual(["label", "type", "required", "options", "custom"]);
    expect(formatQuestionFieldValue("required", newQuestion, [])).toBe("No");
    expect(formatQuestionFieldValue("maxLength", oldQuestion, [])).toBe("1200 characters");
    expect(formatQuestionFieldValue("custom", newQuestion, [])).toBe("Custom response set with KQA.set()");
    expect(FIELD_LABELS.options).toBe("Response options");
  });

  it("identifies changed order among existing questions", () => {
    const before = [question("q1"), question("q2"), question("q3")];
    const after = [question("q2"), question("q1"), question("q3")];

    expect(summarizeQuestionChanges(before, after).moved).toEqual([
      { id: "q1", beforePosition: 1, afterPosition: 2 },
    ]);
  });

  it("does not call questions reordered when only an item was inserted or removed", () => {
    const before = [question("q1"), question("q2"), question("q3")];
    const inserted = [question("new"), ...before];
    const removed = [before[0], before[2]];

    expect(summarizeQuestionChanges(before, inserted).moved).toEqual([]);
    expect(summarizeQuestionChanges(before, removed).moved).toEqual([]);
  });
});
