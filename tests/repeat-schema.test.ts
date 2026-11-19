import { describe, expect, it } from "vitest";
import { manifestSchema, questionSchema } from "../src/lib/format/schema";

const repeat = {
  id: "goals",
  type: "repeat",
  label: "Goals to discuss",
  help: "Add each distinct goal you want to discuss.",
  itemLabel: "goal",
  minRows: 0,
  maxRows: 5,
  fields: [
    { id: "goal", type: "text", label: "Goal", required: true, maxLength: 120 },
    { id: "period", type: "select", label: "Time frame", options: [{ value: "month", label: "This month" }, { value: "year", label: "This year" }] },
  ],
} as const;

describe("repeat question manifest contract", () => {
  it("accepts a bounded flat group with typed required and optional fields", () => {
    expect(questionSchema.parse(repeat)).toMatchObject({ type: "repeat", maxRows: 5, minRows: 0 });
    expect(manifestSchema.parse({ format: "kqa/1", title: "Planning", questions: [repeat] }).questions).toHaveLength(1);
  });

  it("requires a finite maximum and rejects invalid minimums and duplicate field ids", () => {
    expect(questionSchema.safeParse({ ...repeat, maxRows: undefined }).success).toBe(false);
    expect(questionSchema.safeParse({ ...repeat, minRows: 6 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...repeat, fields: [repeat.fields[0], repeat.fields[0]] }).success).toBe(false);
  });

  it("rejects unbounded or nested field patterns and incompatible scalar properties", () => {
    expect(questionSchema.safeParse({ ...repeat, maxRows: 21 }).success).toBe(false);
    expect(questionSchema.safeParse({ ...repeat, fields: [{ id: "child", type: "repeat", label: "Nested" }] }).success).toBe(false);
    expect(questionSchema.safeParse({ ...repeat, options: [{ value: "x", label: "X" }, { value: "y", label: "Y" }] }).success).toBe(false);
  });
});
