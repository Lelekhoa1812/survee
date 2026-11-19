import { describe, expect, it } from "vitest";
import { applyRecordOperation, repeatAttentionReasons, retryableScalarPatch } from "../src/components/RespondentShell";
import type { Question, RepeatRecordMap } from "../src/lib/format/schema";

const question: Question = {
  id: "experiences",
  type: "repeat",
  label: "Experiences",
  required: true,
  minRows: 2,
  maxRows: 4,
  itemLabel: "experience",
  fields: [
    { id: "role", label: "Role", type: "text", required: true },
    { id: "years", label: "Years", type: "number" },
  ],
};

describe("respondent repeat records", () => {
  it("optimistically applies add, set, clear, and remove without mutating the prior snapshot", () => {
    const original: RepeatRecordMap = {};
    const added = applyRecordOperation(original, { op: "add", questionId: question.id, rowId: "r1" });
    const set = applyRecordOperation(added, { op: "set", questionId: question.id, rowId: "r1", fieldId: "role", expectedFieldRevision: 0, value: "Designer" });
    const cleared = applyRecordOperation(set, { op: "clear", questionId: question.id, rowId: "r1", fieldId: "role", expectedFieldRevision: 0 });
    const removed = applyRecordOperation(cleared, { op: "remove", questionId: question.id, rowId: "r1", expectedRowRevision: 0 });

    expect(original).toEqual({});
    expect(set.experiences[0].values.role).toBe("Designer");
    expect(cleared.experiences[0].values).toEqual({});
    expect(removed.experiences).toEqual([]);
  });

  it("counts the required row minimum and required fields only for active rows", () => {
    const incomplete = [{ id: "r1", values: {}, revision: 0, fieldRevisions: {} }];
    expect(repeatAttentionReasons(question, incomplete, "Required", (count, item) => `At least ${count} ${item}`)).toEqual([
      "At least 2 experience",
      "Role: Required",
    ]);
    expect(repeatAttentionReasons(question, [
      { ...incomplete[0], deletedAt: "2026-11-19T00:00:00.000Z" },
      { id: "r2", values: { role: "Analyst" }, revision: 0, fieldRevisions: {} },
      { id: "r3", values: { role: "Researcher" }, revision: 0, fieldRevisions: {} },
    ], "Required", (count, item) => `At least ${count} ${item}`)).toEqual([]);
  });

  it("retries scalar changes from an atomic record rejection except ids explicitly rejected by scalar validation", () => {
    const batch = { name: { value: "Ada" }, age: { value: "not-a-number" } };
    expect(retryableScalarPatch(batch, [{ id: "age" }])).toEqual({ name: { value: "Ada" } });
    expect(retryableScalarPatch(batch, [])).toEqual(batch);
  });
});
