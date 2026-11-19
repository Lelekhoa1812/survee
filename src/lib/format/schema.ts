/**
 * KQA format v1: the manifest schema.
 *
 * This file is the single source of truth for the shape of `<script type="application/json" id="kqa-manifest">`.
 * `docs/kqa-manifest.schema.json` is generated from it (`npm run docs`), and the checker, the answer
 * validator and the exports all read the same types.
 *
 * There is no in-app question builder and no score. A required checkbox is answered when at least
 * one option is stored. Text that is only spaces is empty. The HTML file does not send email.
 */
import { z } from "zod";

export const FORMAT_ID = "kqa/1" as const;

export const QUESTION_TYPES = ["single", "multi", "select", "rank", "text", "longtext", "number", "scale", "date"] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

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
  /** Option values that cannot be selected with any other option in this multi question. */
  exclusiveOptions: z.array(z.string().regex(OPTION_VALUE_RE)).min(1).optional(),
  note: noteSchema.optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  step: z.number().finite().positive().optional(),
  maxLength: z.number().int().min(1).max(LIMITS.longtextMax).optional(),
  /** True when the page sets this answer from script with KQA.set() instead of a bound control. */
  custom: z.boolean().optional(),
  /** Show this question only when its bounded conditions match earlier answers. */
  when: whenSchema.optional(),
}).superRefine((question, ctx) => {
  if (question.type === "rank") {
    if ((question.options?.length ?? 0) < 2) ctx.addIssue({ code: "custom", path: ["options"], message: "rank questions need at least two options" });
    if ((question.options?.length ?? 0) > LIMITS.maxRankOptions) ctx.addIssue({ code: "custom", path: ["options"], message: `rank questions support at most ${LIMITS.maxRankOptions} options` });
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
  presentation: z.enum(["all", "guided"]).optional(),
  sections: z.array(sectionSchema).max(LIMITS.maxSections).optional(),
  questions: z.array(questionSchema).min(1).max(LIMITS.maxQuestions),
});

export type Manifest = z.infer<typeof manifestSchema>;
export type Question = z.infer<typeof questionSchema>;
export type Section = z.infer<typeof sectionSchema>;
export type Option = z.infer<typeof optionSchema>;
export type Condition = z.infer<typeof conditionSchema>;

/** Types that must carry an `options` list. */
export const OPTION_TYPES: readonly QuestionType[] = ["single", "multi", "select", "rank"];
/** Types whose `min` / `max` apply. */
export const RANGE_TYPES: readonly QuestionType[] = ["number", "scale"];

export type AnswerValue = string | number | string[];

/** One stored answer. `value` is absent when only a note was written. */
export interface StoredAnswer {
  value?: AnswerValue;
  note?: string;
  updatedAt: string;
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
    ];
  }
  return schema;
}
