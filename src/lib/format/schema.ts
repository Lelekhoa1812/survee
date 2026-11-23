/**
 * KQA format v1: the manifest schema.
 *
 * This file is the single source of truth for the shape of `<script type="application/json" id="kqa-manifest">`.
 * `docs/kqa-manifest.schema.json` is generated from it (`npm run docs`), and the checker, the answer
 * validator and the exports all read the same types.
 *
 * A basic in-app composer generates common native question types; advanced authoring still uses HTML.
 * There is no score. A required checkbox is answered when at least one option is stored. Text that is
 * only spaces is empty. The HTML file does not send email.
 */
import { z } from "zod";

export const FORMAT_ID = "kqa/1" as const;

export const QUESTION_TYPES = ["single", "multi", "select", "rank", "text", "longtext", "number", "scale", "date", "repeat"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];
export const REPEAT_FIELD_TYPES = ["single", "select", "text", "longtext", "number", "scale", "date"] as const;
export type RepeatFieldType = (typeof REPEAT_FIELD_TYPES)[number];

/** Question and section ids. Lowercase, so they are safe in URLs, CSV headers and JSON keys. */
export const ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
/** Option values may keep capitals (for example "P1"), but stay punctuation-light. */
export const OPTION_VALUE_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export const LIMITS = {
  maxFileBytes: 3 * 1024 * 1024,
  maxQuestions: 500,
  maxSections: 50,
  maxOptions: 50,
  maxRankOptions: 8,
  maxRepeatRows: 20,
  maxRepeatFields: 12,
  maxLabel: 300,
  maxHelp: 1000,
  maxTitle: 120,
  maxDescription: 500,
  textMax: 500,
  longtextMax: 20000,
  noteMax: 5000,
  scaleSpanMax: 20,
} as const;

const idString = z.string().regex(ID_RE, "must be lowercase letters, digits, hyphen or underscore, starting with a letter or digit (max 64)");

export const optionSchema = z.object({
  value: z.string().regex(OPTION_VALUE_RE, "must start with a letter or digit and use only letters, digits . _ : - (max 64)"),
  label: z.string().min(1).max(LIMITS.maxLabel),
});

/** Bounded predicates over an earlier choice answer, typed value, or answer presence. */
export const conditionSchema = z.discriminatedUnion("operator", [
  z.object({
    question: idString,
    operator: z.enum(["equals", "notEquals", "contains", "notContains"]),
    value: z.string().regex(OPTION_VALUE_RE),
  }),
  z.object({
    question: idString,
    operator: z.enum(["answered", "notAnswered"]),
  }),
  z.object({
    question: idString,
    operator: z.enum(["lt", "lte", "gt", "gte", "eq", "ne"]),
    value: z.union([z.number().finite(), z.string().max(10)]),
  }),
]);

/** Strict calendar-date validation shared by stored dates and date-routing operands. */
export function isCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}

export const whenSchema = z.object({
  all: z.array(conditionSchema).max(20).optional(),
  any: z.array(conditionSchema).max(20).optional(),
});

export const noteSchema = z.union([
  z.boolean(),
  z.object({
    label: z.string().min(1).max(120).optional(),
    placeholder: z.string().max(200).optional(),
    maxLength: z.number().int().min(1).max(LIMITS.noteMax).optional(),
  }),
]);

export const sectionSchema = z.object({
  id: idString,
  title: z.string().min(1).max(LIMITS.maxLabel),
  description: z.string().max(LIMITS.maxHelp).optional(),
});

/** Explicitly selected, adjacent questions whose presentation order may vary by respondent. */
export const questionOrderGroupSchema = z.object({
  id: idString,
  questionIds: z.array(idString).min(2).max(LIMITS.maxQuestions),
});

/** A bounded scalar field repeated inside one respondent's record group. */
export const repeatFieldSchema = z.object({
  id: idString,
  label: z.string().min(1).max(LIMITS.maxLabel),
  help: z.string().max(LIMITS.maxHelp).optional(),
  type: z.enum(REPEAT_FIELD_TYPES),
  required: z.boolean().optional(),
  options: z.array(optionSchema).min(2).max(LIMITS.maxOptions).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  maxLength: z.number().int().min(1).max(LIMITS.longtextMax).optional(),
}).superRefine((field, ctx) => {
  if (["single", "select"].includes(field.type) && !field.options) {
    ctx.addIssue({ code: "custom", path: ["options"], message: `${field.type} repeat fields need at least two options` });
  }
  if (!["single", "select"].includes(field.type) && field.options !== undefined) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "options only apply to single or select repeat fields" });
  }
  if (!["number", "scale"].includes(field.type) && (field.min !== undefined || field.max !== undefined || field.step !== undefined)) {
    ctx.addIssue({ code: "custom", path: ["min"], message: "min, max and step only apply to number or scale repeat fields" });
  }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
    ctx.addIssue({ code: "custom", path: ["min"], message: "min cannot exceed max" });
  }
  if (field.options && new Set(field.options.map((option) => option.value)).size !== field.options.length) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "repeat field option values must be unique" });
  }
  if (field.type === "scale") {
    const min = field.min ?? 1;
    const max = field.max ?? 5;
    if (!Number.isInteger(min) || !Number.isInteger(max)) ctx.addIssue({ code: "custom", path: ["min"], message: "scale repeat field bounds must be whole numbers" });
    if (max - min > LIMITS.scaleSpanMax) ctx.addIssue({ code: "custom", path: ["max"], message: `scale repeat fields support a span of at most ${LIMITS.scaleSpanMax}` });
  }
  if (field.maxLength !== undefined && !["text", "longtext"].includes(field.type)) {
    ctx.addIssue({ code: "custom", path: ["maxLength"], message: "maxLength only applies to text repeat fields" });
  }
  if (field.maxLength !== undefined && field.type === "text" && field.maxLength > LIMITS.textMax) {
    ctx.addIssue({ code: "custom", path: ["maxLength"], message: `text repeat fields cannot exceed ${LIMITS.textMax} characters` });
  }
});

export const questionSchema = z.object({
  id: idString,
  type: z.enum(QUESTION_TYPES),
  label: z.string().min(1).max(LIMITS.maxLabel),
  help: z.string().max(LIMITS.maxHelp).optional(),
  section: idString.optional(),
  required: z.boolean().optional(),
  options: z.array(optionSchema).min(2).max(LIMITS.maxOptions).optional(),
  /** Optional maximum number of distinct options for a multi question. */
  maxSelections: z.number().int().min(1).max(LIMITS.maxOptions).optional(),
  /** Optional minimum for a non-empty multi answer; an optional empty answer remains a skip. */
  minSelections: z.number().int().min(1).max(LIMITS.maxOptions).optional(),
  /** Option values that cannot be selected with any other option in this multi question. */
  exclusiveOptions: z.array(z.string().regex(OPTION_VALUE_RE)).min(1).optional(),
  /** Opt in to a stable per-participant order for nominal response categories. */
  randomizeOptions: z.boolean().optional(),
  /** Option values that keep their authored positions while other options rotate. */
  fixedOptionValues: z.array(z.string().regex(OPTION_VALUE_RE)).optional(),
  note: noteSchema.optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  maxLength: z.number().int().min(1).max(LIMITS.longtextMax).optional(),
  /** Repeat-group fields are stored separately from AnswerValue and edited with row/field operations. */
  fields: z.array(repeatFieldSchema).min(1).max(LIMITS.maxRepeatFields).optional(),
  /** Required for repeat questions; bounds row creation for runtime, payload and review. */
  maxRows: z.number().int().min(1).max(LIMITS.maxRepeatRows).optional(),
  /** Minimum complete rows required at submit; `required: true` also means at least one. */
  minRows: z.number().int().min(0).max(LIMITS.maxRepeatRows).optional(),
  /** Singular, localized noun used for generated row controls, e.g. "goal". */
  itemLabel: z.string().min(1).max(80).optional(),
  /** True when the page sets this answer from script with KQA.set() instead of a bound control. */
  custom: z.boolean().optional(),
  /** Show this question only when its bounded conditions match earlier answers. */
  when: whenSchema.optional(),
}).superRefine((question, ctx) => {
  if (question.type === "repeat") {
    if (!question.fields) ctx.addIssue({ code: "custom", path: ["fields"], message: "repeat questions need at least one field" });
    if (question.maxRows === undefined) ctx.addIssue({ code: "custom", path: ["maxRows"], message: "repeat questions need a finite maxRows" });
    if (question.minRows !== undefined && question.maxRows !== undefined && question.minRows > question.maxRows) {
      ctx.addIssue({ code: "custom", path: ["minRows"], message: "minRows cannot exceed maxRows" });
    }
    if (new Set((question.fields ?? []).map((field) => field.id)).size !== (question.fields ?? []).length) {
      ctx.addIssue({ code: "custom", path: ["fields"], message: "repeat field ids must be unique within the group" });
    }
    if (question.options !== undefined || question.maxSelections !== undefined || question.minSelections !== undefined || question.exclusiveOptions !== undefined || question.randomizeOptions !== undefined || question.fixedOptionValues !== undefined || question.note !== undefined || question.min !== undefined || question.max !== undefined || question.step !== undefined || question.maxLength !== undefined || question.custom) {
      ctx.addIssue({ code: "custom", path: ["type"], message: "repeat questions use fields and row limits; scalar question options, notes and custom controls do not apply" });
    }
  } else if (question.fields !== undefined || question.maxRows !== undefined || question.minRows !== undefined || question.itemLabel !== undefined) {
    ctx.addIssue({ code: "custom", path: ["fields"], message: "fields, maxRows, minRows and itemLabel only apply to repeat questions" });
  }
  if (question.type === "rank") {
    if ((question.options?.length ?? 0) < 2) ctx.addIssue({ code: "custom", path: ["options"], message: "rank questions need at least two options" });
    if ((question.options?.length ?? 0) > LIMITS.maxRankOptions) ctx.addIssue({ code: "custom", path: ["options"], message: `rank questions support at most ${LIMITS.maxRankOptions} options` });
  }
  if (question.minSelections !== undefined) {
    if (question.type !== "multi") ctx.addIssue({ code: "custom", path: ["minSelections"], message: "minSelections only applies to multi questions" });
    if (question.options && question.minSelections > question.options.length) ctx.addIssue({ code: "custom", path: ["minSelections"], message: "minSelections cannot exceed the number of options" });
    if (question.maxSelections !== undefined && question.minSelections > question.maxSelections) ctx.addIssue({ code: "custom", path: ["minSelections"], message: "minSelections cannot exceed maxSelections" });
    if (question.minSelections > 1 && question.exclusiveOptions?.length) ctx.addIssue({ code: "custom", path: ["minSelections"], message: "minSelections cannot exceed 1 when exclusiveOptions are declared, because an exclusive choice must be valid alone" });
  }
  if (question.randomizeOptions && !["single", "multi", "select"].includes(question.type)) {
    ctx.addIssue({ code: "custom", path: ["randomizeOptions"], message: "randomizeOptions only applies to nominal single, multi, or select questions" });
  }
  if (question.randomizeOptions && question.custom) {
    ctx.addIssue({ code: "custom", path: ["randomizeOptions"], message: "randomizeOptions requires native choice controls so survee can apply and record the presented order" });
  }
  if (question.randomizeOptions && !question.options) {
    ctx.addIssue({ code: "custom", path: ["options"], message: "randomizeOptions requires at least two declared options" });
  }
  if (question.fixedOptionValues !== undefined) {
    if (!question.randomizeOptions) ctx.addIssue({ code: "custom", path: ["fixedOptionValues"], message: "fixedOptionValues requires randomizeOptions" });
    if (new Set(question.fixedOptionValues).size !== question.fixedOptionValues.length) ctx.addIssue({ code: "custom", path: ["fixedOptionValues"], message: "fixedOptionValues must not contain duplicates" });
    const optionValues = new Set(question.options?.map((option) => option.value) ?? []);
    question.fixedOptionValues.forEach((value, index) => {
      if (!optionValues.has(value)) ctx.addIssue({ code: "custom", path: ["fixedOptionValues", index], message: `fixed option value "${value}" must match a declared option` });
    });
  }
  if (question.randomizeOptions && question.options) {
    const movableCount = question.options.length - new Set(question.fixedOptionValues ?? []).size;
    if (movableCount < 2) ctx.addIssue({ code: "custom", path: ["randomizeOptions"], message: "randomizeOptions needs at least two options that are not fixed" });
  }
  if (question.exclusiveOptions !== undefined) {
    if (question.type !== "multi") ctx.addIssue({ code: "custom", path: ["exclusiveOptions"], message: "exclusiveOptions only applies to multi questions" });
    if (new Set(question.exclusiveOptions).size !== question.exclusiveOptions.length) ctx.addIssue({ code: "custom", path: ["exclusiveOptions"], message: "exclusiveOptions must not contain duplicates" });
    const optionValues = new Set(question.options?.map((option) => option.value) ?? []);
    question.exclusiveOptions.forEach((value, index) => {
      if (!optionValues.has(value)) ctx.addIssue({ code: "custom", path: ["exclusiveOptions", index], message: `exclusive option "${value}" must match a declared option value` });
    });
  }
});

export const manifestSchema = z.object({
  format: z.literal(FORMAT_ID),
  title: z.string().min(1).max(LIMITS.maxTitle),
  description: z.string().max(LIMITS.maxDescription).optional(),
  /** Opt-in step presentation. Omitted manifests retain the full-page experience. */
  presentation: z.enum(["all", "guided", "guided-question"]).optional(),
  sections: z.array(sectionSchema).max(LIMITS.maxSections).optional(),
  /** Off by default. The checker restricts groups to adjacent, independent root questions. */
  questionOrderGroups: z.array(questionOrderGroupSchema).max(Math.floor(LIMITS.maxQuestions / 2)).optional(),
  questions: z.array(questionSchema).min(1).max(LIMITS.maxQuestions),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type QuestionOrderGroup = z.infer<typeof questionOrderGroupSchema>;
export type Option = z.infer<typeof optionSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type RepeatField = z.infer<typeof repeatFieldSchema>;

/** Types that must carry an `options` list. */
export const OPTION_TYPES: readonly QuestionType[] = ["single", "multi", "select", "rank"];
/** Types whose `min` / `max` apply. */
export const RANGE_TYPES: readonly QuestionType[] = ["number", "scale"];

export type AnswerValue = string | number | string[];

/** A stable respondent-created row; array order is display order, never identity. */
export interface RepeatRecordRow {
  id: string;
  values: Record<string, string | number>;
  /** Server-side deletion tombstone prevents a stale add or field edit from resurrecting this row. */
  deletedAt?: string;
  /** Whole-row revision is used to prevent removing a row changed by another open page. */
  revision: number;
  /** Field revisions allow edits to different fields in the same row to merge safely. */
  fieldRevisions: Record<string, number>;
}
export type RepeatRecordMap = Record<string, RepeatRecordRow[]>;

export type RepeatRecordOperation =
  | { op: "add"; questionId: string; rowId: string }
  | { op: "set"; questionId: string; rowId: string; fieldId: string; expectedFieldRevision: number; value: string | number }
  | { op: "clear"; questionId: string; rowId: string; fieldId: string; expectedFieldRevision: number }
  | { op: "remove"; questionId: string; rowId: string; expectedRowRevision: number };

/** One stored answer. `value` is absent when only a note was written. */
export interface StoredAnswer {
  value?: AnswerValue;
  note?: string;
  updatedAt: string;
  /** Option order presented to this respondent when the answer was saved. */
  presentedOptionOrder?: string[];
  /** Questionnaire version whose presentation order was shown. */
  optionOrderVersion?: number;
}
export type AnswerMap = Record<string, StoredAnswer>;

export function scaleBounds(q: Question): { min: number; max: number } {
  return { min: q.min ?? 1, max: q.max ?? 5 };
}

export function noteConfig(q: Question): { enabled: boolean; label: string; placeholder: string; maxLength: number } {
  const n = q.note;
  if (!n) return { enabled: false, label: "Add a note", placeholder: "Optional", maxLength: LIMITS.noteMax };
  if (n === true) return { enabled: true, label: "Add a note", placeholder: "Optional", maxLength: LIMITS.noteMax };
  return { enabled: true, label: n.label ?? "Add a note", placeholder: n.placeholder ?? "Optional", maxLength: n.maxLength ?? LIMITS.noteMax };
}

/** JSON Schema for the manifest, derived from the zod schema so the two can never drift. */
export function manifestJsonSchema(): unknown {
  const schema = z.toJSONSchema(manifestSchema, { target: "draft-2020-12" }) as {
    properties?: { questions?: { items?: Record<string, unknown> } };
  };
  const item = schema.properties?.questions?.items;
  if (item) {
    const properties = item.properties as Record<string, Record<string, unknown> | undefined> | undefined;
    if (properties?.exclusiveOptions?.items) properties.exclusiveOptions.uniqueItems = true;
    item.allOf = [
      {
        if: { properties: { type: { const: "rank" } }, required: ["type"] },
        then: { properties: { options: { maxItems: LIMITS.maxRankOptions } }, required: ["options"] },
      },
      {
        if: { required: ["exclusiveOptions"] },
        then: { properties: { type: { const: "multi" } } },
      },
      {
        if: { required: ["exclusiveOptions", "minSelections"] },
        then: { properties: { minSelections: { maximum: 1 } } },
      },
      {
        if: { required: ["minSelections"] },
        then: { properties: { type: { const: "multi" } } },
      },
      {
        if: { properties: { randomizeOptions: { const: true } }, required: ["randomizeOptions"] },
        then: { properties: { type: { enum: ["single", "multi", "select"] }, custom: { const: false } }, required: ["options"] },
      },
      ...Array.from({ length: LIMITS.maxOptions }, (_, index) => {
        const minimum = index + 1;
        return {
          if: { properties: { minSelections: { const: minimum } }, required: ["minSelections"] },
          then: { properties: { options: { minItems: minimum }, maxSelections: { minimum } }, required: ["options"] },
        };
      }),
    ];
  }
  return schema;
}
