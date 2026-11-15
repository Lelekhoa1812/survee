import { isAnswered, validateAnswer } from "../format/answers";
import type { AnswerMap, Question } from "../format/schema";
import { ANALYTICS_COHORTS, ANALYTICS_STATUSES, type AnalyticsCohortKey } from "./cohorts";
import type { ParticipantStatus } from "../repo/types";

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
  q1: number;
  q3: number;
  max: number;
  mean: number;
  median: number;
}

export interface QuestionSummaryDisclosureRisk {
  /** Cohort and response totals equal one. */
  singletonCohort: boolean;
  singletonAnsweredCount: boolean;
  singletonNoAnswerCount: boolean;
  singletonNoteOnlyCount: boolean;
  singletonUnmappedResponseCount: boolean;
  /** Valid respondent denominator equals one. */
  singletonDistributionDenominator: boolean;
  /** Distribution values selected by exactly one valid respondent. */
  singletonDistributionValues: string[];
  /** A number summary based on exactly one valid response. */
  singletonNumericSummary: boolean;
}

export interface QuestionSummary {
  /** Everyone in the selected status cohort; KQA does not track item-level display eligibility. */
  cohortCount: number;
  /** @deprecated Use cohortCount; this is not item-level eligibility. */
  eligibleCount: number;
  answeredCount: number;
  /** People in the cohort without a non-empty stored answer; may include people who did not see the item. */
  noAnswerCount: number;
  /** @deprecated Use noAnswerCount; this is not item-level missingness. */
  missingCount: number;
  noteOnlyCount: number;
  /** Respondents whose stored value does not fit the current version's choices or range. */
  unmappedResponseCount: number;
  /** Distribution percentages use this denominator; multi-select percentages are per respondent. */
  distributionDenominator: number;
  distribution: DistributionRow[];
  numeric: DescriptiveStats | null;
  /** Lower central observed response category; use scaleMedianRange to interpret ordinal scales. */
  scaleMedian: number | null;
  /** Central observed response category for odd n; central pair for even n. Never averages ordinal codes. */
  scaleMedianRange: { lower: number; upper: number } | null;
  /** Detectable singleton counts only; not an identifiability assessment or anonymity guarantee. */
  disclosureRisk: QuestionSummaryDisclosureRisk;
}

export interface QuestionSummaryAccumulatorSnapshot {
  cohortCount: number;
  answeredCount: number;
  noteOnlyCount: number;
  distributionDenominator: number;
  distributionUnmappedResponseCount: number;
  numericUnmappedResponseCount: number;
  distributionCounts: { value: string; count: number }[];
  numericValues: number[];
}

export interface QuestionSummaryAccumulator {
  add(respondent: AnalyticsRespondent): void;
  merge(other: QuestionSummaryAccumulator): void;
  finish(): QuestionSummary;
  snapshot(): QuestionSummaryAccumulatorSnapshot;
}

interface QuestionSummaryAccumulatorMergeState {
  cohortCount: number;
  answeredCount: number;
  noteOnlyCount: number;
  distributionDenominator: number;
  distributionUnmappedResponseCount: number;
  numericUnmappedResponseCount: number;
  distributionCounts: readonly { value: string; count: number }[];
  numericValues: readonly number[];
}

const accumulatorMergeStates = new WeakMap<QuestionSummaryAccumulator, () => QuestionSummaryAccumulatorMergeState>();

export interface CohortAnalyticsRespondent extends AnalyticsRespondent {
  status: ParticipantStatus;
}

export interface QuestionCohortSummaries {
  /** Time the shared status scan completed; every status cohort in this result uses this value. */
  asOf: string;
  statusCounts: Record<ParticipantStatus, number>;
  summaries: Record<AnalyticsCohortKey, Record<string, QuestionSummary>>;
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

/** Hyndman-Fan type 7 sample quantile: index=(n-1)*p with linear interpolation. */
function quantileType7(sorted: number[], probability: number): number {
  const index = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  if (lowerIndex === upperIndex || sorted[lowerIndex] === sorted[upperIndex]) return sorted[lowerIndex];
  const weight = index - lowerIndex;
  return sorted[lowerIndex] * (1 - weight) + sorted[upperIndex] * weight;
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
export function createQuestionSummaryAccumulator(q: Question): QuestionSummaryAccumulator {
  const distributionRows = initialDistribution(q);
  const byValue = new Map(distributionRows.map((row) => [row.value, row]));
  const hasDistribution = q.type === "single" || q.type === "select" || q.type === "multi" || q.type === "scale";
  const hasNumericSummary = q.type === "number" || q.type === "scale";
  let cohortCount = 0;
  let answeredCount = 0;
  let noteOnlyCount = 0;
  let distributionDenominator = 0;
  let distributionUnmappedResponseCount = 0;
  let numericUnmappedResponseCount = 0;
  const numericValues: number[] = [];

  function add(respondent: AnalyticsRespondent) {
    cohortCount += 1;
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
    let scaleMedianRange: QuestionSummary["scaleMedianRange"] = null;
    if (q.type === "number" && numericValues.length) {
      // Divide each value before adding so a sum of otherwise valid finite values cannot overflow.
      const mean = numericValues.reduce((average, value, index) => {
        const count = index + 1;
        return average * ((count - 1) / count) + value / count;
      }, 0);
      numeric = {
        n: numericValues.length,
        min: numericValues[0],
        q1: quantileType7(numericValues, 0.25),
        q3: quantileType7(numericValues, 0.75),
        max: numericValues[numericValues.length - 1],
        mean,
        median: median(numericValues),
      };
    }
    if (q.type === "scale" && numericValues.length) {
      const lower = numericValues[Math.floor((numericValues.length - 1) / 2)];
      const upper = numericValues[Math.floor(numericValues.length / 2)];
      scaleMedian = lower;
      scaleMedianRange = { lower, upper };
    }

    const distribution = distributionRows.map((row) => ({
      ...row,
      percent: distributionDenominator ? (row.count / distributionDenominator) * 100 : 0,
    }));
    const noAnswerCount = cohortCount - answeredCount;
    const unmappedResponseCount = Math.max(distributionUnmappedResponseCount, numericUnmappedResponseCount);

    return {
      cohortCount,
      eligibleCount: cohortCount,
      answeredCount,
      noAnswerCount,
      missingCount: noAnswerCount,
      noteOnlyCount,
      unmappedResponseCount,
      distributionDenominator,
      distribution,
      numeric,
      scaleMedian,
      scaleMedianRange,
      disclosureRisk: {
        singletonCohort: cohortCount === 1,
        singletonAnsweredCount: answeredCount === 1,
        singletonNoAnswerCount: noAnswerCount === 1,
        singletonNoteOnlyCount: noteOnlyCount === 1,
        singletonUnmappedResponseCount: unmappedResponseCount === 1,
        singletonDistributionDenominator: distributionDenominator === 1,
        singletonDistributionValues: distribution.filter((row) => row.count === 1).map((row) => row.value),
        singletonNumericSummary: numeric?.n === 1,
      },
    };
  }

  function snapshot(): QuestionSummaryAccumulatorSnapshot {
    return {
      cohortCount,
      answeredCount,
      noteOnlyCount,
      distributionDenominator,
      distributionUnmappedResponseCount,
      numericUnmappedResponseCount,
      distributionCounts: distributionRows.map(({ value, count }) => ({ value, count })),
      numericValues: [...numericValues],
    };
  }

  function merge(other: QuestionSummaryAccumulator) {
    // Keep the public snapshot independent, but avoid allocating a second full numeric list when
    // merging accumulators created here. Exact quantiles still require retaining each value.
    const source = accumulatorMergeStates.get(other)?.() ?? other.snapshot();
    cohortCount += source.cohortCount;
    answeredCount += source.answeredCount;
    noteOnlyCount += source.noteOnlyCount;
    distributionDenominator += source.distributionDenominator;
    distributionUnmappedResponseCount += source.distributionUnmappedResponseCount;
    numericUnmappedResponseCount += source.numericUnmappedResponseCount;
    for (const row of source.distributionCounts) {
      const target = byValue.get(row.value);
      if (target) target.count += row.count;
    }
    for (const value of source.numericValues) numericValues.push(value);
  }

  const accumulator = { add, merge, finish, snapshot };
  accumulatorMergeStates.set(accumulator, () => ({
    cohortCount,
    answeredCount,
    noteOnlyCount,
    distributionDenominator,
    distributionUnmappedResponseCount,
    numericUnmappedResponseCount,
    distributionCounts: distributionRows,
    numericValues,
  }));
  return accumulator;
}

export function summarizeQuestion(q: Question, respondents: AnalyticsRespondent[]): QuestionSummary {
  const summary = createQuestionSummaryAccumulator(q);
  for (const respondent of respondents) summary.add(respondent);
  return summary.finish();
}

/** Build every non-empty status cohort from one respondent scan and per-status accumulators. */
export async function summarizeQuestionCohorts(
  questions: Question[],
  respondents: AsyncIterable<CohortAnalyticsRespondent>,
): Promise<QuestionCohortSummaries> {
  const statusCounts: Record<ParticipantStatus, number> = { invited: 0, in_progress: 0, submitted: 0 };
  const byStatus = new Map(ANALYTICS_STATUSES.map((status) => [
    status,
    new Map(questions.map((question) => [question.id, createQuestionSummaryAccumulator(question)])),
  ]));

  for await (const respondent of respondents) {
    const accumulators = byStatus.get(respondent.status);
    if (!accumulators) continue;
    statusCounts[respondent.status] += 1;
    for (const accumulator of accumulators.values()) accumulator.add(respondent);
  }

  const summaries = {} as QuestionCohortSummaries["summaries"];
  for (const cohort of ANALYTICS_COHORTS) {
    const byQuestion: Record<string, QuestionSummary> = {};
    for (const question of questions) {
      const combined = createQuestionSummaryAccumulator(question);
      for (const status of cohort.statuses) combined.merge(byStatus.get(status)!.get(question.id)!);
      byQuestion[question.id] = combined.finish();
    }
    summaries[cohort.key] = byQuestion;
  }

  return { asOf: new Date().toISOString(), statusCounts, summaries };
}
