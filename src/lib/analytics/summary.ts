import { isAnswered, validateAnswer } from "../format/answers";
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
  return sorted.length % 2 ? sorted[middle] : sorted[middle - 1] / 2 + sorted[middle] / 2;
}

function initialDistribution(q: Question) {
  const choiceType = q.type === "single" || q.type === "select" || q.type === "multi";
  const rows = choiceType ? q.options?.map((option) => ({ value: option.value, label: option.label, count: 0 })) ?? [] : [];
  const lower = q.type === "scale" ? q.min ?? 1 : 1;
  const upper = q.type === "scale" ? q.max ?? 5 : 0;
  if (q.type === "scale") {
    for (let value = Math.ceil(lower); value <= Math.floor(upper); value += 1) rows.push({ value: String(value), label: String(value), count: 0 });
  }
  return rows;
}

/**
 * Descriptive, current-version summary only. It never scores responses or infers meaning from text.
 * Text answers stay in the answer-review view and are not included in this aggregate.
 */
export function createQuestionSummaryAccumulator(q: Question) {
  const distributionRows = initialDistribution(q);
  const byValue = new Map(distributionRows.map((row) => [row.value, row]));
  const hasDistribution = q.type === "single" || q.type === "select" || q.type === "multi" || q.type === "scale";
  const hasNumericSummary = q.type === "number" || q.type === "scale";
  let eligibleCount = 0;
  let answeredCount = 0;
  let noteOnlyCount = 0;
  let distributionDenominator = 0;
  let distributionUnmappedResponseCount = 0;
  let numericUnmappedResponseCount = 0;
  const numericValues: number[] = [];

  function add(respondent: AnalyticsRespondent) {
    eligibleCount += 1;
    const answer = respondent.answers[q.id];
    const answered = isAnswered(q, respondent.answers);
    if (!answered && typeof answer?.note === "string" && answer.note.trim() !== "") noteOnlyCount += 1;
    if (!answered) return;
    answeredCount += 1;

    if (hasDistribution) {
      const raw = answer?.value;
      const values = Array.isArray(raw) ? [...new Set(raw)] : [raw];
      const normalized = values.map((value) => q.type === "scale" ? numericValue(value) : value);
      const shapeValid = q.type === "multi" ? Array.isArray(raw) : !Array.isArray(raw);
      const valid = shapeValid && normalized.every((value) => value !== null && byValue.has(String(value)));
      if (!valid) distributionUnmappedResponseCount += 1;
      else {
        distributionDenominator += 1;
        for (const value of normalized) byValue.get(String(value))!.count += 1;
      }
    }

    if (hasNumericSummary) {
      const result = validateAnswer(q, answer?.value);
      const value = result.ok && typeof result.value === "number" ? result.value : null;
      if (value === null) numericUnmappedResponseCount += 1;
      else numericValues.push(value);
    }
  }

  function finish(): QuestionSummary {
    numericValues.sort((a, b) => a - b);
    let numeric: DescriptiveStats | null = null;
    let scaleMedian: number | null = null;
    if (q.type === "number" && numericValues.length) {
      // Divide each value before adding so a sum of otherwise valid finite values cannot overflow.
      const mean = numericValues.reduce((average, value, index) => {
        const count = index + 1;
        return average * ((count - 1) / count) + value / count;
      }, 0);
      numeric = {
        n: numericValues.length,
        min: numericValues[0],
        max: numericValues[numericValues.length - 1],
        mean,
        median: median(numericValues),
      };
    }
    if (q.type === "scale" && numericValues.length) scaleMedian = median(numericValues);

    return {
      eligibleCount,
      answeredCount,
      missingCount: eligibleCount - answeredCount,
      noteOnlyCount,
      unmappedResponseCount: Math.max(distributionUnmappedResponseCount, numericUnmappedResponseCount),
      distributionDenominator,
      distribution: distributionRows.map((row) => ({
        ...row,
        percent: distributionDenominator ? (row.count / distributionDenominator) * 100 : 0,
      })),
      numeric,
      scaleMedian,
    };
  }

  return { add, finish };
}

export function summarizeQuestion(q: Question, respondents: AnalyticsRespondent[]): QuestionSummary {
  const summary = createQuestionSummaryAccumulator(q);
  for (const respondent of respondents) summary.add(respondent);
  return summary.finish();
}
