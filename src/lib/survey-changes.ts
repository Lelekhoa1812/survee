import { LIMITS, noteConfig, type Question, type Section } from "./format/schema";

export const QUESTION_FIELDS = [
  "label", "type", "required", "section", "options", "min", "max", "step", "help", "note", "maxLength", "custom",
] as const satisfies readonly (keyof Question)[];

export type QuestionField = (typeof QUESTION_FIELDS)[number];

export const FIELD_LABELS: Record<QuestionField, string> = {
  label: "Wording",
  type: "Response type",
  required: "Required",
  section: "Section",
  options: "Response options",
  min: "Minimum",
  max: "Maximum",
  step: "Step",
  help: "Help text",
  note: "Note field",
  maxLength: "Text length",
  custom: "Custom response behavior",
};

export interface QuestionChanges {
  added: Question[];
  removed: Question[];
  updated: Array<{ previous: Question; question: Question; fields: QuestionField[] }>;
  moved: Array<{ id: string; beforePosition: number; afterPosition: number }>;
}

export const SECTION_FIELDS = ["title", "description"] as const satisfies readonly (keyof Section)[];
export type SectionField = (typeof SECTION_FIELDS)[number];

export interface SectionChanges {
  added: Section[];
  removed: Section[];
  updated: Array<{ previous: Section; section: Section; fields: SectionField[] }>;
  moved: Array<{ id: string; beforePosition: number; afterPosition: number }>;
}

function longestCommonSubsequence<T>(before: T[], after: T[]): T[] {
  const lengths = Array.from({ length: before.length + 1 }, () => Array<number>(after.length + 1).fill(0));
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      lengths[i][j] = before[i] === after[j]
        ? lengths[i + 1][j + 1] + 1
        : Math.max(lengths[i + 1][j], lengths[i][j + 1]);
    }
  }

  const sequence: T[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      sequence.push(before[i]);
      i += 1;
      j += 1;
    } else if (lengths[i + 1][j] >= lengths[i][j + 1]) {
      i += 1;
    } else {
      j += 1;
    }
  }
  return sequence;
}

function movedItems<T extends { id: string }>(before: T[], after: T[]): Array<{ id: string; beforePosition: number; afterPosition: number }> {
  const beforeById = new Map(before.map((item) => [item.id, item]));
  const afterById = new Map(after.map((item) => [item.id, item]));
  const beforeOrder = before.filter((item) => afterById.has(item.id)).map((item) => item.id);
  const afterOrder = after.filter((item) => beforeById.has(item.id)).map((item) => item.id);
  const stationary = new Set(longestCommonSubsequence(beforeOrder, afterOrder));
  const beforePositions = new Map(before.map((item, index) => [item.id, index + 1]));
  const afterPositions = new Map(after.map((item, index) => [item.id, index + 1]));
  return beforeOrder.length === afterOrder.length && beforeOrder.some((id, index) => id !== afterOrder[index])
    ? afterOrder.flatMap((id) => stationary.has(id) ? [] : [{ id, beforePosition: beforePositions.get(id)!, afterPosition: afterPositions.get(id)! }])
    : [];
}

export function summarizeQuestionChanges(before: Question[], after: Question[]): QuestionChanges {
  const beforeById = new Map(before.map((question) => [question.id, question]));
  const afterById = new Map(after.map((question) => [question.id, question]));
  const added = after.filter((question) => !beforeById.has(question.id));
  const removed = before.filter((question) => !afterById.has(question.id));
  const updated = after.flatMap((question) => {
    const previous = beforeById.get(question.id);
    if (!previous) return [];
    const fields = QUESTION_FIELDS.filter((field) => JSON.stringify(previous[field] ?? null) !== JSON.stringify(question[field] ?? null));
    return fields.length ? [{ previous, question, fields }] : [];
  });

  // Compare only ids present in both versions so additions/removals don't look like reorders.
  return { added, removed, updated, moved: movedItems(before, after) };
}

export function summarizeSectionChanges(before: Section[], after: Section[]): SectionChanges {
  const beforeById = new Map(before.map((section) => [section.id, section]));
  const afterById = new Map(after.map((section) => [section.id, section]));
  const added = after.filter((section) => !beforeById.has(section.id));
  const removed = before.filter((section) => !afterById.has(section.id));
  const updated = after.flatMap((section) => {
    const previous = beforeById.get(section.id);
    if (!previous) return [];
    const fields = SECTION_FIELDS.filter((field) => JSON.stringify(previous[field] ?? null) !== JSON.stringify(section[field] ?? null));
    return fields.length ? [{ previous, section, fields }] : [];
  });
  return { added, removed, updated, moved: movedItems(before, after) };
}

export function formatQuestionFieldValue(field: QuestionField, question: Question, sections: Section[]): string {
  const value = question[field];
  if (field === "label" || field === "help") return typeof value === "string" && value ? value : field === "help" ? "No help text" : "Not set";
  if (field === "type") return question.type;
  if (field === "required") return question.required ? "Yes" : "No";
  if (field === "section") {
    if (!question.section) return "No section";
    const section = sections.find((candidate) => candidate.id === question.section);
    return section ? `${section.title} (${section.id})` : question.section;
  }
  if (field === "options") {
    return question.options?.map((option) => `${option.label} (value: ${option.value})`).join("; ") ?? "Not applicable";
  }
  if (field === "note") {
    if (!question.note) return "Disabled";
    const config = noteConfig(question);
    return `Enabled · ${config.label} · placeholder: ${config.placeholder} · ${config.maxLength} characters maximum`;
  }
  if (field === "min" || field === "max" || field === "step") {
    return typeof value === "number" ? String(value) : "Not set";
  }
  if (field === "maxLength") {
    if (typeof value === "number") return `${value} characters`;
    if (question.type === "text") return `Default · ${LIMITS.textMax} characters`;
    if (question.type === "longtext") return `Default · ${LIMITS.longtextMax} characters`;
    return "Not applicable";
  }
  if (field === "custom") return question.custom ? "Custom response set with KQA.set()" : "Standard respondent control";
  return "Not set";
}

export function fieldsForQuestion(question: Question): QuestionField[] {
  return QUESTION_FIELDS.filter((field) => field === "required" || question[field] !== undefined);
}
