import { LIMITS, isCalendarDate, scaleBounds, type AnswerMap, type AnswerValue, type Condition, type Manifest, type Question, type RepeatField, type RepeatRecordMap } from "./schema";

export type AnswerIssueCode = "expected_option" | "invalid_option" | "expected_option_list" | "below_minimum_selections" | "above_maximum_selections" | "exclusive_conflict" | "expected_rank" | "rank_incomplete" | "rank_duplicate" | "expected_text" | "max_length" | "expected_number" | "below_minimum" | "above_maximum" | "invalid_step" | "expected_scale" | "outside_scale" | "invalid_date" | "not_scalar";
export type ValidateResult = { ok: true; value: AnswerValue | null } | { ok: false; reason: string; code: AnswerIssueCode; params?: { minimum?: number; maximum?: number } };

export type RepeatIssueCode = "stale_revision" | "invalid_question" | "invalid_row_id" | "history_limit" | "max_rows" | "invalid_field" | "inactive_question" | "min_rows" | "required_field" | "invalid_option" | "expected_text" | "max_length" | "expected_number" | "below_minimum" | "above_maximum" | "invalid_step" | "expected_scale" | "outside_scale" | "invalid_date" | "nonempty_scalar";
export interface RepeatAnswerIssue { questionId: string; rowId?: string; fieldId?: string; reason: string; code: RepeatIssueCode; params?: { minimum?: number; maximum?: number } }

type RepeatFieldResult = { ok: true; value: string | number } | { ok: false; reason: string; code: RepeatIssueCode; params?: { minimum?: number; maximum?: number } };

/** Keep scalar validation authoritative while exposing stable, value-free metadata for repeat fields. */
export function validateRepeatFieldValue(field: RepeatField, raw: unknown): RepeatFieldResult {
  const result = validateAnswer({ ...field, required: false } as Question, raw);
  if (result.ok) {
    if (result.value === null || Array.isArray(result.value)) return { ok: false, reason: "a non-empty scalar value is required", code: "nonempty_scalar" };
    return { ok: true, value: result.value };
  }
  const reason = result.reason;
  switch (field.type) {
    case "single": case "select": return { ok: false, reason, code: "invalid_option" };
    case "text": case "longtext":
      return typeof raw !== "string" ? { ok: false, reason, code: "expected_text" } : { ok: false, reason, code: "max_length", params: { maximum: field.maxLength ?? (field.type === "text" ? LIMITS.textMax : LIMITS.longtextMax) } };
    case "number": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, reason, code: "expected_number" };
      if (field.min !== undefined && n < field.min) return { ok: false, reason, code: "below_minimum", params: { minimum: field.min } };
      if (field.max !== undefined && n > field.max) return { ok: false, reason, code: "above_maximum", params: { maximum: field.max } };
      if (field.step !== undefined) return { ok: false, reason, code: "invalid_step" };
      return { ok: false, reason, code: "above_maximum", params: { maximum: field.max } };
    }
    case "scale": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      const { min, max } = scaleBounds(field as Question);
      if (typeof n === "number" && Number.isInteger(n) && n >= min && n <= max && field.step !== undefined) return { ok: false, reason, code: "invalid_step" };
      return { ok: false, reason, code: typeof n !== "number" || !Number.isInteger(n) ? "expected_scale" : "outside_scale", params: { minimum: min, maximum: max } };
    }
    case "date": return { ok: false, reason, code: "invalid_date" };
  }
}

export function exclusiveConflictCount(q: Question, value: unknown): number {
  if (q.type !== "multi" || !Array.isArray(value)) return 0;
  const unique = [...new Set(value.filter((item): item is string => typeof item === "string"))];
  const exclusiveCount = unique.filter((item) => q.exclusiveOptions?.includes(item)).length;
  return exclusiveCount * (unique.length - 1);
}

/**
 * Validate and normalise a value for a question. `null` means "clear the answer".
 * Used by the answer API (server side), the probe and the importer, so there is one definition of "valid".
 */
export function validateAnswer(q: Question, raw: unknown, options: { allowOverLimit?: boolean; allowExclusiveConflict?: boolean; allowUnderMinSelections?: boolean } = {}): ValidateResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  switch (q.type) {
    case "single":
    case "select": {
      if (typeof raw !== "string") return { ok: false, code: "expected_option", reason: `expected one option value (string), got ${describe(raw)}` };
      if (raw === "") return { ok: true, value: null };
      const allowed = (q.options ?? []).map((o) => o.value);
      if (!allowed.includes(raw)) return { ok: false, code: "invalid_option", reason: `"${raw}" is not one of the options (${allowed.join(", ")})` };
      return { ok: true, value: raw };
    }
    case "multi": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return { ok: false, code: "expected_option_list", reason: `expected an array of option values, got ${describe(raw)}` };
      const allowed = new Set((q.options ?? []).map((o) => o.value));
      const bad = raw.filter((x) => !allowed.has(x));
      if (bad.length) return { ok: false, code: "invalid_option", reason: `not option values: ${bad.map((b) => `"${b}"`).join(", ")}` };
      const unique = [...new Set(raw)];
      if (!options.allowUnderMinSelections && unique.length > 0 && q.minSelections !== undefined && unique.length < q.minSelections) return { ok: false, code: "below_minimum_selections", params: { minimum: q.minSelections }, reason: `choose at least ${q.minSelections} options or leave this question blank` };
      if (!options.allowOverLimit && q.maxSelections !== undefined && unique.length > q.maxSelections) return { ok: false, code: "above_maximum_selections", params: { maximum: q.maxSelections }, reason: `choose no more than ${q.maxSelections} options` };
      const exclusive = new Set(q.exclusiveOptions ?? []);
      if (!options.allowExclusiveConflict && unique.some((value) => exclusive.has(value)) && unique.length > 1) return { ok: false, code: "exclusive_conflict", reason: "choose an exclusive option by itself" };
      // Keep the manifest's order so exports and comparisons are stable.
      const order = (q.options ?? []).map((o) => o.value);
      unique.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return { ok: true, value: unique.length ? unique : null };
    }
    case "rank": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return { ok: false, code: "expected_rank", reason: `expected an ordered array of option values, got ${describe(raw)}` };
      if (raw.length === 0) return { ok: true, value: null };
      const allowed = (q.options ?? []).map((option) => option.value);
      if (raw.length !== allowed.length) return { ok: false, code: "rank_incomplete", reason: `rank every option exactly once (expected ${allowed.length}, got ${raw.length})` };
      if (new Set(raw).size !== raw.length) return { ok: false, code: "rank_duplicate", reason: "each option must appear exactly once" };
      const invalid = raw.filter((value) => !allowed.includes(value));
      if (invalid.length) return { ok: false, code: "invalid_option", reason: `not option values: ${invalid.map((value) => `"${value}"`).join(", ")}` };
      return { ok: true, value: [...raw] };
    }
    case "text":
    case "longtext": {
      if (typeof raw !== "string") return { ok: false, code: "expected_text", reason: `expected text (string), got ${describe(raw)}` };
      const max = q.maxLength ?? (q.type === "text" ? LIMITS.textMax : LIMITS.longtextMax);
      if (raw.length > max) return { ok: false, code: "max_length", params: { maximum: max }, reason: `text is ${raw.length} characters, the limit is ${max}` };
      return { ok: true, value: raw.trim() === "" ? null : raw };
    }
    case "number": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, code: "expected_number", reason: `expected a number, got ${describe(raw)}` };
      if (q.min !== undefined && n < q.min) return { ok: false, code: "below_minimum", params: { minimum: q.min }, reason: `${n} is below the minimum ${q.min}` };
      if (q.max !== undefined && n > q.max) return { ok: false, code: "above_maximum", params: { maximum: q.max }, reason: `${n} is above the maximum ${q.max}` };
      if (q.step !== undefined) {
        const base = q.min ?? 0;
        if (!matchesStep(n, base, q.step)) return { ok: false, code: "invalid_step", reason: `${n} does not match increments of ${q.step} from ${base}` };
      }
      return { ok: true, value: n };
    }
    case "scale": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      const { min, max } = scaleBounds(q);
      if (typeof n !== "number" || !Number.isInteger(n)) return { ok: false, code: "expected_scale", reason: `expected a whole number from ${min} to ${max}, got ${describe(raw)}` };
      if (n < min || n > max) return { ok: false, code: "outside_scale", params: { minimum: min, maximum: max }, reason: `${n} is outside the scale ${min} to ${max}` };
      if (q.step !== undefined && !matchesStep(n, min, q.step)) return { ok: false, code: "invalid_step", reason: `${n} does not match increments of ${q.step} from ${min}` };
      return { ok: true, value: n };
    }
    case "date": {
      if (typeof raw !== "string") return { ok: false, code: "invalid_date", reason: `expected a date as YYYY-MM-DD, got ${describe(raw)}` };
      if (raw === "") return { ok: true, value: null };
      if (!isCalendarDate(raw)) return { ok: false, code: "invalid_date", reason: `"${raw}" is not a valid YYYY-MM-DD date` };
      return { ok: true, value: raw };
    }
    case "repeat":
      return { ok: false, code: "not_scalar", reason: "repeat answers are stored as record groups, not scalar answer values" };
  }
}

function describe(v: unknown): string {
  if (Array.isArray(v)) return "an array";
  if (v === null) return "null";
  return typeof v === "object" ? "an object" : `${typeof v} ${JSON.stringify(v)?.slice(0, 40)}`;
}

export function isAnswered(q: Question, answers: AnswerMap, recordGroups: RepeatRecordMap = {}): boolean {
  if (q.type === "repeat") return (recordGroups[q.id] ?? []).some((row) => !row.deletedAt);
  const a = answers[q.id];
  if (!a || a.value === undefined || a.value === null) return false;
  if (q.type === "rank") return validateAnswer(q, a.value).ok && Array.isArray(a.value) && a.value.length > 0;
  if (Array.isArray(a.value)) return a.value.length > 0;
  if (typeof a.value === "string") return a.value.trim() !== "";
  return true;
}

/** Evaluate the current manifest's bounded routing rules in question order. */
export function evaluateEligibility(manifest: Manifest, answers: AnswerMap, recordGroups: RepeatRecordMap = {}): Record<string, boolean> {
  const eligible: Record<string, boolean> = {};
  const questionById = new Map(manifest.questions.map((item) => [item.id, item]));
  for (const question of manifest.questions) {
    const when = question.when;
    if (!when) { eligible[question.id] = true; continue; }
    const matches = (condition: NonNullable<typeof when.all>[number]): boolean => {
      if (!eligible[condition.question]) return false;
      const sourceQuestion = questionById.get(condition.question);
      if (sourceQuestion?.type === "repeat" && condition.operator !== "answered" && condition.operator !== "notAnswered") return false;
      const value = answers[condition.question]?.value;
      const answered = sourceQuestion?.type === "repeat"
        ? (recordGroups[condition.question] ?? []).some((row) => !row.deletedAt)
        : value !== undefined && value !== null && (Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim() !== "" : true);
      if (condition.operator === "answered") return answered;
      if (condition.operator === "notAnswered") return !answered;
      if (!answered || !("value" in condition)) return false;
      if (isTypedComparison(condition)) {
        const source = questionById.get(condition.question);
        if (!source || !typedValueIsUsable(source, value, condition.value)) return false;
        return compareTypedValue(value, condition.value, condition.operator);
      }
      const has = Array.isArray(value) ? value.includes(condition.value) : value === condition.value;
      return condition.operator === "equals" || condition.operator === "contains" ? has : !has;
    };
    const all = when.all ?? [];
    const any = when.any ?? [];
    eligible[question.id] = (all.length === 0 || all.every(matches)) && (any.length === 0 || any.some(matches));
  }
  return eligible;
}

type TypedComparison = Extract<Condition, { operator: "lt" | "lte" | "gt" | "gte" | "eq" | "ne" }>;
function isTypedComparison(condition: Condition): condition is TypedComparison {
  return condition.operator === "lt" || condition.operator === "lte" || condition.operator === "gt" || condition.operator === "gte" || condition.operator === "eq" || condition.operator === "ne";
}
function typedValueIsUsable(question: Question, actual: unknown, expected: unknown): boolean {
  if (question.type === "date") return typeof actual === "string" && isCalendarDate(actual) && typeof expected === "string" && isCalendarDate(expected);
  if (question.type !== "number" && question.type !== "scale") return false;
  if (typeof actual !== "number" || !Number.isFinite(actual) || typeof expected !== "number" || !Number.isFinite(expected)) return false;
  if (question.type === "number") return validateAnswer(question, actual).ok;
  if (question.type === "scale") {
    return Number.isInteger(actual) && Number.isInteger(expected)
      && validateAnswer(question, actual).ok && validateAnswer(question, expected).ok;
  }
  return false;
}

function matchesStep(value: number, base: number, step: number): boolean {
  return Math.abs((value - base) / step - Math.round((value - base) / step)) <= 1e-9;
}
function compareTypedValue(actual: string | number | string[] | undefined, expected: string | number, operator: TypedComparison["operator"]): boolean {
  if (actual === undefined || typeof actual !== typeof expected || Array.isArray(actual)) return false;
  switch (operator) {
    case "lt": return actual < expected;
    case "lte": return actual <= expected;
    case "gt": return actual > expected;
    case "gte": return actual >= expected;
    case "eq": return actual === expected;
    case "ne": return actual !== expected;
  }
}

/** Return requested question ids plus every transitive routing prerequisite needed to infer their current eligibility. */
export function eligibilityQuestionIds(manifest: Manifest, requestedIds: readonly string[]): string[] {
  const byId = new Map(manifest.questions.map((question) => [question.id, question]));
  const included = new Set<string>();
  const visit = (id: string) => {
    if (included.has(id)) return;
    const question = byId.get(id);
    if (!question) return;
    included.add(id);
    for (const condition of [...(question.when?.all ?? []), ...(question.when?.any ?? [])]) visit(condition.question);
  };
  for (const id of requestedIds) visit(id);
  return manifest.questions.filter((question) => included.has(question.id)).map((question) => question.id);
}

export interface Progress {
  total: number;
  answered: number;
  requiredTotal: number;
  requiredAnswered: number;
  missingRequired: string[];
  invalidSelections: { id: string; selected: number; maximum: number }[];
  invalidMinimumSelections: { id: string; selected: number; minimum: number }[];
  invalidExclusiveSelections: { id: string }[];
  invalidRankSelections: { id: string }[];
  invalidAnswers: { id: string; code: AnswerIssueCode }[];
  eligible: Record<string, boolean>;
  inactive: number;
  repeatErrors: RepeatAnswerIssue[];
}

export function progress(manifest: Manifest, answers: AnswerMap, recordGroups: RepeatRecordMap = {}): Progress {
  let answered = 0;
  let requiredTotal = 0;
  let requiredAnswered = 0;
  const missingRequired: string[] = [];
  const invalidSelections: Progress["invalidSelections"] = [];
  const invalidMinimumSelections: Progress["invalidMinimumSelections"] = [];
  const invalidExclusiveSelections: Progress["invalidExclusiveSelections"] = [];
  const invalidRankSelections: Progress["invalidRankSelections"] = [];
  const invalidAnswers: Progress["invalidAnswers"] = [];
  const eligible = evaluateEligibility(manifest, answers, recordGroups);
  const repeatErrors = validateRecordGroups(manifest, recordGroups, answers, eligible);
  let total = 0;
  for (const q of manifest.questions) {
    if (!eligible[q.id]) continue;
    total += 1;
    const done = q.type === "repeat"
      ? isAnswered(q, answers, recordGroups) && !repeatErrors.some((issue) => issue.questionId === q.id)
      : isAnswered(q, answers, recordGroups);
    if (done) answered += 1;
    if (q.required) {
      requiredTotal += 1;
      if (done) requiredAnswered += 1;
      else missingRequired.push(q.id);
    }
    const value = answers[q.id]?.value;
    if (q.type === "repeat") continue;
    if (q.type === "multi" && q.maxSelections !== undefined && Array.isArray(value)) {
      const selected = new Set(value).size;
      if (selected > q.maxSelections) invalidSelections.push({ id: q.id, selected, maximum: q.maxSelections });
    }
    if (q.type === "multi" && q.minSelections !== undefined && Array.isArray(value)) {
      const selected = new Set(value).size;
      if (selected > 0 && selected < q.minSelections) invalidMinimumSelections.push({ id: q.id, selected, minimum: q.minSelections });
    }
    if (q.type === "multi" && Array.isArray(value) && value.some((item) => q.exclusiveOptions?.includes(item)) && new Set(value).size > 1) invalidExclusiveSelections.push({ id: q.id });
    if (value !== undefined && value !== null) {
      if (q.type === "rank") {
        if (!validateAnswer(q, value).ok) invalidRankSelections.push({ id: q.id });
      } else {
        const result = validateAnswer(q, value, q.type === "multi" ? { allowUnderMinSelections: true, allowOverLimit: true, allowExclusiveConflict: true } : undefined);
        if (!result.ok) invalidAnswers.push({ id: q.id, code: result.code });
      }
    }
  }
  return { total, answered, requiredTotal, requiredAnswered, missingRequired, invalidSelections, invalidMinimumSelections, invalidExclusiveSelections, invalidRankSelections, invalidAnswers, eligible, inactive: manifest.questions.length - total, repeatErrors };
}

/** Validate retained repeat rows at submit; drafts remain saveable while required fields are incomplete. */
export function validateRecordGroups(manifest: Manifest, recordGroups: RepeatRecordMap = {}, answers: AnswerMap = {}, eligibility?: Record<string, boolean>): RepeatAnswerIssue[] {
  const issues: RepeatAnswerIssue[] = [];
  const eligible = eligibility ?? evaluateEligibility(manifest, answers, recordGroups);
  for (const question of manifest.questions) {
    if (question.type !== "repeat" || eligible[question.id] === false) continue;
    const rows = (recordGroups[question.id] ?? []).filter((row) => !row.deletedAt);
    const minRows = Math.max(question.minRows ?? 0, question.required ? 1 : 0);
    if (rows.length < minRows) issues.push({ questionId: question.id, reason: `add at least ${minRows} record${minRows === 1 ? "" : "s"}`, code: "min_rows", params: { minimum: minRows } });
    const fields = new Map((question.fields ?? []).map((field) => [field.id, field]));
    for (const row of rows) {
      for (const field of question.fields ?? []) {
        const value = row.values?.[field.id];
        const hasValue = value !== undefined && !(typeof value === "string" && value.trim() === "");
        if (field.required && !hasValue) {
          issues.push({ questionId: question.id, rowId: row.id, fieldId: field.id, reason: "this field is required in each retained record", code: "required_field" });
          continue;
        }
        if (hasValue) {
          const validation = validateRepeatFieldValue(field, value);
          if (!validation.ok) issues.push({ questionId: question.id, rowId: row.id, fieldId: field.id, reason: validation.reason, code: validation.code, ...(validation.params ? { params: validation.params } : {}) });
        }
      }
      for (const fieldId of Object.keys(row.values ?? {})) {
        if (!fields.has(fieldId)) issues.push({ questionId: question.id, rowId: row.id, fieldId, reason: "this field is not in the current questionnaire", code: "invalid_field" });
      }
    }
  }
  return issues;
}

/** Human-readable form of a stored value: option labels instead of option values. */
export function displayValue(q: Question, value: AnswerValue | undefined): string {
  if (value === undefined || value === null) return "";
  const label = (v: string) => q.options?.find((o) => o.value === v)?.label ?? v;
  if (Array.isArray(value)) return q.type === "rank"
    ? value.map((item, index) => `${index + 1}. ${label(item)}`).join("; ")
    : value.map(label).join("; ");
  if (typeof value === "string") return q.type === "single" || q.type === "select" ? label(value) : value;
  return String(value);
}
