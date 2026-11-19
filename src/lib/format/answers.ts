import { LIMITS, scaleBounds, type AnswerMap, type AnswerValue, type Manifest, type Question } from "./schema";

export type ValidateResult = { ok: true; value: AnswerValue | null } | { ok: false; reason: string };

/**
 * Validate and normalise a value for a question. `null` means "clear the answer".
 * Used by the answer API (server side), the probe and the importer, so there is one definition of "valid".
 */
export function validateAnswer(q: Question, raw: unknown, options: { allowOverLimit?: boolean } = {}): ValidateResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  switch (q.type) {
    case "single":
    case "select": {
      if (typeof raw !== "string") return { ok: false, reason: `expected one option value (string), got ${describe(raw)}` };
      if (raw === "") return { ok: true, value: null };
      const allowed = (q.options ?? []).map((o) => o.value);
      if (!allowed.includes(raw)) return { ok: false, reason: `"${raw}" is not one of the options (${allowed.join(", ")})` };
      return { ok: true, value: raw };
    }
    case "multi": {
      if (!Array.isArray(raw) || raw.some((x) => typeof x !== "string")) return { ok: false, reason: `expected an array of option values, got ${describe(raw)}` };
      const allowed = new Set((q.options ?? []).map((o) => o.value));
      const bad = raw.filter((x) => !allowed.has(x));
      if (bad.length) return { ok: false, reason: `not option values: ${bad.map((b) => `"${b}"`).join(", ")}` };
      const unique = [...new Set(raw)];
      if (!options.allowOverLimit && q.maxSelections !== undefined && unique.length > q.maxSelections) return { ok: false, reason: `choose no more than ${q.maxSelections} options` };
      // Keep the manifest's order so exports and comparisons are stable.
      const order = (q.options ?? []).map((o) => o.value);
      unique.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return { ok: true, value: unique.length ? unique : null };
    }
    case "text":
    case "longtext": {
      if (typeof raw !== "string") return { ok: false, reason: `expected text (string), got ${describe(raw)}` };
      const max = q.maxLength ?? (q.type === "text" ? LIMITS.textMax : LIMITS.longtextMax);
      if (raw.length > max) return { ok: false, reason: `text is ${raw.length} characters, the limit is ${max}` };
      return { ok: true, value: raw.trim() === "" ? null : raw };
    }
    case "number": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      if (typeof n !== "number" || !Number.isFinite(n)) return { ok: false, reason: `expected a number, got ${describe(raw)}` };
      if (q.min !== undefined && n < q.min) return { ok: false, reason: `${n} is below the minimum ${q.min}` };
      if (q.max !== undefined && n > q.max) return { ok: false, reason: `${n} is above the maximum ${q.max}` };
      return { ok: true, value: n };
    }
    case "scale": {
      const n = typeof raw === "string" && raw.trim() !== "" ? Number(raw) : raw;
      const { min, max } = scaleBounds(q);
      if (typeof n !== "number" || !Number.isInteger(n)) return { ok: false, reason: `expected a whole number from ${min} to ${max}, got ${describe(raw)}` };
      if (n < min || n > max) return { ok: false, reason: `${n} is outside the scale ${min} to ${max}` };
      return { ok: true, value: n };
    }
    case "date": {
      if (typeof raw !== "string") return { ok: false, reason: `expected a date as YYYY-MM-DD, got ${describe(raw)}` };
      if (raw === "") return { ok: true, value: null };
      // Date.parse normalises impossible days (for example, February 31) instead
      // of rejecting them. Compare calendar parts explicitly, including leap years.
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
      const year = match ? Number(match[1]) : 0;
      const month = match ? Number(match[2]) : 0;
      const day = match ? Number(match[3]) : 0;
      const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
      const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
      if (year < 1 || month < 1 || month > 12 || day < 1 || day > days[month - 1]) return { ok: false, reason: `"${raw}" is not a valid YYYY-MM-DD date` };
      return { ok: true, value: raw };
    }
  }
}

function describe(v: unknown): string {
  if (Array.isArray(v)) return "an array";
  if (v === null) return "null";
  return typeof v === "object" ? "an object" : `${typeof v} ${JSON.stringify(v)?.slice(0, 40)}`;
}

export function isAnswered(q: Question, answers: AnswerMap): boolean {
  const a = answers[q.id];
  if (!a || a.value === undefined || a.value === null) return false;
  if (Array.isArray(a.value)) return a.value.length > 0;
  if (typeof a.value === "string") return a.value.trim() !== "";
  return true;
}

/** Evaluate the current manifest's bounded routing rules in question order. */
export function evaluateEligibility(manifest: Manifest, answers: AnswerMap): Record<string, boolean> {
  const eligible: Record<string, boolean> = {};
  for (const question of manifest.questions) {
    const when = question.when;
    if (!when) { eligible[question.id] = true; continue; }
    const matches = (condition: NonNullable<typeof when.all>[number]): boolean => {
      if (!eligible[condition.question]) return false;
      const value = answers[condition.question]?.value;
      const answered = value !== undefined && value !== null && (Array.isArray(value) ? value.length > 0 : typeof value === "string" ? value.trim() !== "" : true);
      if (condition.operator === "answered") return answered;
      if (condition.operator === "notAnswered") return !answered;
      if (!answered || !("value" in condition)) return false;
      const has = Array.isArray(value) ? value.includes(condition.value) : value === condition.value;
      return condition.operator === "equals" || condition.operator === "contains" ? has : !has;
    };
    const all = when.all ?? [];
    const any = when.any ?? [];
    eligible[question.id] = (all.length === 0 || all.every(matches)) && (any.length === 0 || any.some(matches));
  }
  return eligible;
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
  eligible: Record<string, boolean>;
  inactive: number;
}

export function progress(manifest: Manifest, answers: AnswerMap): Progress {
  let answered = 0;
  let requiredTotal = 0;
  let requiredAnswered = 0;
  const missingRequired: string[] = [];
  const invalidSelections: Progress["invalidSelections"] = [];
  const eligible = evaluateEligibility(manifest, answers);
  let total = 0;
  for (const q of manifest.questions) {
    if (!eligible[q.id]) continue;
    total += 1;
    const done = isAnswered(q, answers);
    if (done) answered += 1;
    const value = answers[q.id]?.value;
    if (q.type === "multi" && q.maxSelections !== undefined && Array.isArray(value)) {
      const selected = new Set(value).size;
      if (selected > q.maxSelections) invalidSelections.push({ id: q.id, selected, maximum: q.maxSelections });
    }
    if (q.required) {
      requiredTotal += 1;
      if (done) requiredAnswered += 1;
      else missingRequired.push(q.id);
    }
  }
  return { total, answered, requiredTotal, requiredAnswered, missingRequired, invalidSelections, eligible, inactive: manifest.questions.length - total };
}

/** Human-readable form of a stored value: option labels instead of option values. */
export function displayValue(q: Question, value: AnswerValue | undefined): string {
  if (value === undefined || value === null) return "";
  const label = (v: string) => q.options?.find((o) => o.value === v)?.label ?? v;
  if (Array.isArray(value)) return value.map(label).join("; ");
  if (typeof value === "string") return q.type === "single" || q.type === "select" ? label(value) : value;
  return String(value);
}
