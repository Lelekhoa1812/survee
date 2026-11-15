import { isAnswered } from "../format/answers";
import type { AnswerMap, Question } from "../format/schema";

export interface AnalyticsRespondent {
  answers: AnswerMap;
}

export interface DistributionRow {
  value: string;
  label: string;
  count: number;
  percent: number;
}

export interface DescriptiveStats {
  n: number;
  min: number;
  max: number;
  mean: number;
  median: number;
}

export interface QuestionSummary {
  eligibleCount: number;
  answeredCount: number;
  missingCount: number;
  noteOnlyCount: number;
  /** Respondents whose stored value does not fit the current version's choices or range. */
  unmappedResponseCount: number;
  /** Distribution percentages use this denominator; multi-select percentages are per respondent. */
  distributionDenominator: number;
  distribution: DistributionRow[];
  numeric: DescriptiveStats | null;
  scaleMedian: number | null;
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function median(sorted: number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function valueDistribution(q: Question, respondents: AnalyticsRespondent[]) {
  const choiceType = q.type === "single" || q.type === "select" || q.type === "multi";
  const rows = choiceType ? q.options?.map((option) => ({ value: option.value, label: option.label, count: 0 })) ?? [] : [];
  const lower = q.type === "scale" ? q.min ?? 1 : 1;
  const upper = q.type === "scale" ? q.max ?? 5 : 0;
  if (q.type === "scale") {
    for (let value = Math.ceil(lower); value <= Math.floor(upper); value += 1) rows.push({ value: String(value), label: String(value), count: 0 });
  }

  const byValue = new Map(rows.map((row) => [row.value, row]));
  let denominator = 0;
  let unmappedResponseCount = 0;
  for (const respondent of respondents) {
    if (!isAnswered(q, respondent.answers)) continue;
    const raw = respondent.answers[q.id]?.value;
    const values = Array.isArray(raw) ? [...new Set(raw)] : [raw];
    const normalized = values.map((value) => q.type === "scale" ? numericValue(value) : value);
    const shapeValid = q.type === "multi" ? Array.isArray(raw) : !Array.isArray(raw);
    const valid = shapeValid && normalized.every((value) => value !== null && byValue.has(String(value)));
    if (!valid) {
      unmappedResponseCount += 1;
      continue;
    }
    denominator += 1;
    for (const value of normalized) byValue.get(String(value))!.count += 1;
  }
  return {
    distributionDenominator: denominator,
    unmappedResponseCount,
    distribution: rows.map((row) => ({
      ...row,
      percent: denominator ? (row.count / denominator) * 100 : 0,
    })),
  };
}

/**
 * Descriptive, current-version summary only. It never scores responses or infers meaning from text.
 * Text answers stay in the answer-review view and are not included in this aggregate.
 */
export function summarizeQuestion(q: Question, respondents: AnalyticsRespondent[]): QuestionSummary {
  const answered = respondents.filter((respondent) => isAnswered(q, respondent.answers));
  const noteOnlyCount = respondents.filter((respondent) => {
    const answer = respondent.answers[q.id];
    return !isAnswered(q, respondent.answers) && typeof answer?.note === "string" && answer.note.trim() !== "";
  }).length;

  let distribution: ReturnType<typeof valueDistribution> | null = null;
  if (q.type === "single" || q.type === "select" || q.type === "multi" || q.type === "scale") {
    distribution = valueDistribution(q, respondents);
  }

  let numeric: DescriptiveStats | null = null;
  let scaleMedian: number | null = null;
  let numericUnmappedResponseCount = 0;
  if (q.type === "number" || q.type === "scale") {
    const values: number[] = [];
    for (const respondent of answered) {
      const value = numericValue(respondent.answers[q.id]?.value);
      const valid = value !== null && (q.type !== "scale" || (Number.isInteger(value) && value >= (q.min ?? 1) && value <= (q.max ?? 5)));
      if (!valid) {
        numericUnmappedResponseCount += 1;
        continue;
      }
      values.push(value);
    }
    values.sort((a, b) => a - b);
    if (q.type === "number" && values.length) {
      numeric = {
        n: values.length,
        min: values[0],
        max: values[values.length - 1],
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
        median: median(values),
      };
    }
    if (q.type === "scale" && values.length) scaleMedian = median(values);
  }

  return {
    eligibleCount: respondents.length,
    answeredCount: answered.length,
    missingCount: respondents.length - answered.length,
    noteOnlyCount,
    unmappedResponseCount: Math.max(distribution?.unmappedResponseCount ?? 0, numericUnmappedResponseCount),
    distributionDenominator: distribution?.distributionDenominator ?? 0,
    distribution: distribution?.distribution ?? [],
    numeric,
    scaleMedian,
  };
}
