import { evaluateEligibility, isAnswered, validateAnswer } from "../format/answers";
import { LIMITS, scaleBounds, type AnswerMap, type Manifest, type Question } from "../format/schema";
import { LogCollapsingHighestDenseDDSketch } from "@datadog/sketches-js";
import { ANALYTICS_COHORTS, ANALYTICS_STATUSES, type AnalyticsCohortKey } from "./cohorts";
import type { ParticipantStatus } from "../repo/types";

export interface AnalyticsRespondent {
  answers: AnswerMap;
  /** Eligibility inferred from the current manifest rules, not a record of what was rendered. */
  eligibility?: Record<string, boolean>;
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
  /** Quantile method and any approximation limits; absent values are never suppressed. */
  quantiles: {
    method: "hyndman_fan_type_7" | "datadog_ddsketch";
    approximate: boolean;
    relativeValueAccuracy: number | null;
    binLimitPerSign: number | null;
    binsCollapsed: boolean;
    mappingRangeExceeded: boolean;
    errorGuarantee: "exact" | "relative_value_error" | "not_guaranteed";
  };
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
  /** Everyone in the selected status cohort, including those currently inactive by routing rules. */
  cohortCount: number;
  /** People eligible under the current manifest rules. This is inferred, not a historical display record. */
  eligibleCount: number;
  /** People currently inactive under the current manifest rules. */
  inactiveCount: number;
  answeredCount: number;
  /** Currently eligible people without a non-empty stored answer. */
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
  eligibleCount: number;
  inactiveCount: number;
  answeredCount: number;
  noteOnlyCount: number;
  distributionDenominator: number;
  distributionUnmappedResponseCount: number;
  numericUnmappedResponseCount: number;
  distributionCounts: { value: string; count: number }[];
  /** Exact numeric observations only while the exact sample limit is not exceeded. */
  numericValues: number[];
  numericSketch?: { method: "datadog_ddsketch"; relativeValueAccuracy: number; binLimitPerSign: number; binsCollapsed: boolean; mappingRangeExceeded: boolean };
  numericCount: number;
  numericMean: number;
  numericMin: number | null;
  numericMax: number | null;
  numericSketchCollapsed: boolean;
  numericSketchRangeExceeded: boolean;
}

export interface QuestionSummaryAccumulator {
  add(respondent: AnalyticsRespondent): void;
  merge(other: QuestionSummaryAccumulator, options?: { consumeSource?: boolean }): void;
  finish(): QuestionSummary;
  snapshot(): QuestionSummaryAccumulatorSnapshot;
}

interface QuestionSummaryAccumulatorMergeState {
  cohortCount: number;
  eligibleCount: number;
  inactiveCount: number;
  answeredCount: number;
  noteOnlyCount: number;
  distributionDenominator: number;
  distributionUnmappedResponseCount: number;
  numericUnmappedResponseCount: number;
  distributionCounts: readonly { value: string; count: number }[];
  numericValues: number[];
  numericSketch?: LogCollapsingHighestDenseDDSketch;
  numericCount: number;
  numericMean: number;
  numericMin: number | null;
  numericMax: number | null;
  numericSketchCollapsed: boolean;
  numericSketchRangeExceeded: boolean;
  clear(): void;
}

const accumulatorMergeStates = new WeakMap<QuestionSummaryAccumulator, () => QuestionSummaryAccumulatorMergeState>();

/** Exact Type-7 quantiles are retained for ordinary/small cohorts; larger cohorts use bounded memory. */
export const EXACT_NUMERIC_QUANTILE_LIMIT = 256;
export const NUMERIC_SKETCH_RELATIVE_ACCURACY = 0.02;
export const NUMERIC_SKETCH_BIN_LIMIT_PER_SIGN = 512;

export interface CohortAnalyticsRespondent extends AnalyticsRespondent {
  status: ParticipantStatus;
}

/** Attach current-rule eligibility to an analytics stream. This is inferred from answers, not historical display telemetry. */
export async function* withCurrentEligibility<T extends AnalyticsRespondent>(manifest: Manifest, respondents: AsyncIterable<T>): AsyncGenerator<T & { eligibility: Record<string, boolean> }> {
  for await (const respondent of respondents) {
    yield { ...respondent, eligibility: evaluateEligibility(manifest, respondent.answers) };
  }
}

export interface QuestionCohortSummaries {
  /** Time the shared status scan completed; every status cohort in this result uses this value. */
  asOf: string;
  statusCounts: Record<ParticipantStatus, number>;
  summaries: Record<AnalyticsCohortKey, Record<string, QuestionSummary>>;
}

export interface SelectedQuestionCohortSummaries {
  asOf: string;
  statusCounts: Record<ParticipantStatus, number>;
  combined: Record<string, QuestionSummary>;
  statusSummaries: Partial<Record<ParticipantStatus, Record<string, QuestionSummary>>>;
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

function scaleValueAtRank(rows: readonly { value: string; count: number }[], rank: number): number | null {
  let cumulative = 0;
  for (const row of rows) {
    cumulative += row.count;
    if (rank < cumulative) return Number(row.value);
  }
  return null;
}

function initialDistribution(q: Question) {
  const choiceType = q.type === "single" || q.type === "select" || q.type === "multi";
  const rows = choiceType ? q.options?.map((option) => ({ value: option.value, label: option.label, count: 0 })) ?? [] : [];
  if (q.type === "scale") {
    const bounds = scaleBounds(q);
    const first = Math.ceil(bounds.min);
    const last = Math.floor(bounds.max);
    const count = last - first + 1;
    const maxCategories = LIMITS.scaleSpanMax + 1;
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || bounds.max <= bounds.min
      || !Number.isFinite(count) || count < 1 || count > maxCategories) {
      throw new Error(`Scale summaries require a non-empty range of at most ${maxCategories} safely representable integer categories.`);
    }
    for (let index = 0; index < count; index += 1) {
      const value = first + index;
      rows.push({ value: String(value), label: String(value), count: 0 });
    }
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
  let eligibleCount = 0;
  let inactiveCount = 0;
  let answeredCount = 0;
  let noteOnlyCount = 0;
  let distributionDenominator = 0;
  let distributionUnmappedResponseCount = 0;
  let numericUnmappedResponseCount = 0;
  let numericValues: number[] = [];
  let numericSketch: LogCollapsingHighestDenseDDSketch | undefined;
  let numericCount = 0;
  let numericMean = 0;
  let numericMin: number | null = null;
  let numericMax: number | null = null;
  let numericSketchCollapsed = false;
  let numericSketchRangeExceeded = false;

  function newNumericSketch() {
    return new LogCollapsingHighestDenseDDSketch({
      relativeAccuracy: NUMERIC_SKETCH_RELATIVE_ACCURACY,
      binLimit: NUMERIC_SKETCH_BIN_LIMIT_PER_SIGN,
    });
  }

  function hasCollapsedBins(sketch: LogCollapsingHighestDenseDDSketch) {
    return Boolean((sketch.store as { isCollapsed?: boolean }).isCollapsed)
      || Boolean((sketch.negativeStore as { isCollapsed?: boolean }).isCollapsed);
  }

  function mergeNumericSketches(target: LogCollapsingHighestDenseDDSketch, source: LogCollapsingHighestDenseDDSketch) {
    if (!source.count) return;
    if (!target.count) {
      target.store.copy(source.store);
      target.negativeStore.copy(source.negativeStore);
    } else {
      // @datadog/sketches-js 2.1.1's BaseDDSketch.merge omits negativeStore; merge both bounded stores here.
      target.store.merge(source.store);
      target.negativeStore.merge(source.negativeStore);
    }
    target.zeroCount += source.zeroCount;
    target.count += source.count;
    target.sum += source.sum;
    target.min = Math.min(target.min, source.min);
    target.max = Math.max(target.max, source.max);
  }

  function isOutsideSketchMapping(sketch: LogCollapsingHighestDenseDDSketch, value: number) {
    const magnitude = Math.abs(value);
    const mapping = sketch.mapping as { minPossible: number; maxPossible: number };
    return magnitude !== 0 && (magnitude <= mapping.minPossible || magnitude >= mapping.maxPossible);
  }

  function promoteNumericValues() {
    if (numericSketch) return;
    numericSketch = newNumericSketch();
    for (const value of numericValues) {
      numericSketch.accept(value);
      numericSketchRangeExceeded ||= isOutsideSketchMapping(numericSketch, value);
    }
    numericValues = [];
    numericSketchCollapsed ||= hasCollapsedBins(numericSketch);
  }

  function addNumericValue(value: number) {
    if (!numericSketch && numericValues.length < EXACT_NUMERIC_QUANTILE_LIMIT) {
      numericValues.push(value);
    } else {
      promoteNumericValues();
      numericSketch!.accept(value);
      numericSketchCollapsed ||= hasCollapsedBins(numericSketch!);
      numericSketchRangeExceeded ||= isOutsideSketchMapping(numericSketch!, value);
    }
    numericCount += 1;
    numericMean = numericMean * ((numericCount - 1) / numericCount) + value / numericCount;
    numericMin = numericMin === null ? value : Math.min(numericMin, value);
    numericMax = numericMax === null ? value : Math.max(numericMax, value);
  }

  function add(respondent: AnalyticsRespondent) {
    cohortCount += 1;
    if (respondent.eligibility?.[q.id] === false) {
      inactiveCount += 1;
      return;
    }
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
      const validation = validateAnswer(q, raw);
      const shapeValid = q.type === "multi" ? Array.isArray(raw) : !Array.isArray(raw);
      const valid = validation.ok && shapeValid && normalized.every((value) => value !== null && byValue.has(String(value)));
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
      else if (q.type === "number") addNumericValue(value);
    }
  }

  function finish(): QuestionSummary {
    let numeric: DescriptiveStats | null = null;
    let scaleMedian: number | null = null;
    let scaleMedianRange: QuestionSummary["scaleMedianRange"] = null;
    if (q.type === "number" && numericCount) {
      const sortedValues = numericSketch ? null : [...numericValues].sort((a, b) => a - b);
      const approximate = numericSketch !== undefined;
      const quantile = (probability: number) => approximate
        ? Math.min(numericMax!, Math.max(numericMin!, numericSketch!.getValueAtQuantile(probability)))
        : quantileType7(sortedValues!, probability);
      const binsCollapsed = numericSketchCollapsed || (numericSketch ? hasCollapsedBins(numericSketch) : false);
      const mappingRangeExceeded = numericSketchRangeExceeded;
      numeric = {
        n: numericCount,
        min: numericMin!,
        q1: quantile(0.25),
        q3: quantile(0.75),
        max: numericMax!,
        mean: numericMean,
        median: approximate ? quantile(0.5) : median(sortedValues!),
        quantiles: approximate
          ? {
            method: "datadog_ddsketch",
            approximate: true,
            relativeValueAccuracy: NUMERIC_SKETCH_RELATIVE_ACCURACY,
            binLimitPerSign: NUMERIC_SKETCH_BIN_LIMIT_PER_SIGN,
            binsCollapsed,
            mappingRangeExceeded,
            errorGuarantee: binsCollapsed || mappingRangeExceeded ? "not_guaranteed" : "relative_value_error",
          }
          : {
            method: "hyndman_fan_type_7",
            approximate: false,
            relativeValueAccuracy: null,
            binLimitPerSign: null,
            binsCollapsed: false,
            mappingRangeExceeded: false,
            errorGuarantee: "exact",
          },
      };
    }
    if (q.type === "scale" && distributionDenominator) {
      // Scale answers have at most 21 ordered integer categories. Reuse their
      // bounded distribution counts instead of retaining one value per person.
      const lower = scaleValueAtRank(distributionRows, Math.floor((distributionDenominator - 1) / 2));
      const upper = scaleValueAtRank(distributionRows, Math.floor(distributionDenominator / 2));
      if (lower === null || upper === null) throw new Error("Valid scale counts did not map to scale categories.");
      scaleMedian = lower;
      scaleMedianRange = { lower, upper };
    }

    const distribution = distributionRows.map((row) => ({
      ...row,
      percent: distributionDenominator ? (row.count / distributionDenominator) * 100 : 0,
    }));
    const noAnswerCount = eligibleCount - answeredCount;
    const unmappedResponseCount = Math.max(distributionUnmappedResponseCount, numericUnmappedResponseCount);

    return {
      cohortCount,
      eligibleCount,
      inactiveCount,
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
      eligibleCount,
      inactiveCount,
      answeredCount,
      noteOnlyCount,
      distributionDenominator,
      distributionUnmappedResponseCount,
      numericUnmappedResponseCount,
      distributionCounts: distributionRows.map(({ value, count }) => ({ value, count })),
      numericValues: [...numericValues],
      ...(numericSketch ? {
        numericSketch: {
          method: "datadog_ddsketch" as const,
          relativeValueAccuracy: NUMERIC_SKETCH_RELATIVE_ACCURACY,
          binLimitPerSign: NUMERIC_SKETCH_BIN_LIMIT_PER_SIGN,
          binsCollapsed: numericSketchCollapsed || hasCollapsedBins(numericSketch),
          mappingRangeExceeded: numericSketchRangeExceeded,
        },
      } : {}),
      numericCount,
      numericMean,
      numericMin,
      numericMax,
      numericSketchCollapsed: numericSketchCollapsed || (numericSketch ? hasCollapsedBins(numericSketch) : false),
      numericSketchRangeExceeded,
    };
  }

  function merge(other: QuestionSummaryAccumulator, options: { consumeSource?: boolean } = {}) {
    // Prefer private state to avoid copying sketches or exact values during internal cohort merges.
    const sourceState = accumulatorMergeStates.get(other)?.();
    const source = sourceState ?? other.snapshot();
    if (!sourceState && source.numericSketch) {
      throw new Error("Cannot merge a numeric sketch snapshot without its mergeable accumulator state.");
    }
    cohortCount += source.cohortCount;
    eligibleCount += source.eligibleCount;
    inactiveCount += source.inactiveCount;
    answeredCount += source.answeredCount;
    noteOnlyCount += source.noteOnlyCount;
    distributionDenominator += source.distributionDenominator;
    distributionUnmappedResponseCount += source.distributionUnmappedResponseCount;
    numericUnmappedResponseCount += source.numericUnmappedResponseCount;
    for (const row of source.distributionCounts) {
      const target = byValue.get(row.value);
      if (target) target.count += row.count;
    }
    const sourceNumericCount = source.numericCount ?? source.numericValues.length;
    if (sourceNumericCount) {
      if (numericCount + sourceNumericCount > EXACT_NUMERIC_QUANTILE_LIMIT) promoteNumericValues();
      if (!numericSketch && !source.numericSketch) {
        numericValues.push(...source.numericValues);
      } else {
        promoteNumericValues();
        if (sourceNumericCount) {
          const sourceSketch = sourceState?.numericSketch ?? null;
          if (sourceSketch) mergeNumericSketches(numericSketch!, sourceSketch);
          else for (const value of source.numericValues) numericSketch!.accept(value);
          numericSketchCollapsed ||= source.numericSketchCollapsed ?? false;
          numericSketchRangeExceeded ||= source.numericSketchRangeExceeded ?? false;
          if (!sourceSketch) {
            for (const value of source.numericValues) {
              numericSketchRangeExceeded ||= isOutsideSketchMapping(numericSketch!, value);
            }
          }
          numericSketchCollapsed ||= hasCollapsedBins(numericSketch!);
        }
      }
      if (numericCount === 0) {
        numericMean = source.numericMean ?? source.numericValues.reduce((sum, value) => sum + value / sourceNumericCount, 0);
        numericMin = source.numericMin ?? Math.min(...source.numericValues);
        numericMax = source.numericMax ?? Math.max(...source.numericValues);
        numericCount = sourceNumericCount;
      } else {
        const combinedCount = numericCount + sourceNumericCount;
        const sourceMean = source.numericMean ?? source.numericValues.reduce((sum, value) => sum + value / sourceNumericCount, 0);
        numericMean = numericMean * (numericCount / combinedCount) + sourceMean * (sourceNumericCount / combinedCount);
        numericMin = Math.min(numericMin!, source.numericMin ?? Math.min(...source.numericValues));
        numericMax = Math.max(numericMax!, source.numericMax ?? Math.max(...source.numericValues));
        numericCount = combinedCount;
      }
    }
    // Some one-shot merges (segmented status summaries) have already materialized the source
    // summary and will never use that accumulator again. Clear its full state after merging so
    // its exact observations can be collected without leaving a partially valid accumulator.
    if (options.consumeSource && sourceState) sourceState.clear();
  }

  function clear() {
    cohortCount = 0;
    eligibleCount = 0;
    inactiveCount = 0;
    answeredCount = 0;
    noteOnlyCount = 0;
    distributionDenominator = 0;
    distributionUnmappedResponseCount = 0;
    numericUnmappedResponseCount = 0;
    for (const row of distributionRows) row.count = 0;
    numericValues = [];
    numericSketch = undefined;
    numericCount = 0;
    numericMean = 0;
    numericMin = null;
    numericMax = null;
    numericSketchCollapsed = false;
    numericSketchRangeExceeded = false;
  }

  const accumulator = { add, merge, finish, snapshot };
  accumulatorMergeStates.set(accumulator, () => ({
    cohortCount,
    eligibleCount,
    inactiveCount,
    answeredCount,
    noteOnlyCount,
    distributionDenominator,
    distributionUnmappedResponseCount,
    numericUnmappedResponseCount,
    distributionCounts: distributionRows,
    numericValues,
    numericSketch,
    numericCount,
    numericMean,
    numericMin,
    numericMax,
    numericSketchCollapsed: numericSketchCollapsed || (numericSketch ? hasCollapsedBins(numericSketch) : false),
    numericSketchRangeExceeded,
    clear,
  }));
  return accumulator;
}

export function summarizeQuestion(q: Question, respondents: AnalyticsRespondent[]): QuestionSummary {
  if (q.type === "repeat") throw new Error("Repeat-group fields are not summarized as scalar answers.");
  const summary = createQuestionSummaryAccumulator(q);
  for (const respondent of respondents) summary.add(respondent);
  return summary.finish();
}

/** Build every non-empty status cohort from one respondent scan and per-status accumulators. */
export async function summarizeQuestionCohorts(
  questions: Question[],
  respondents: AsyncIterable<CohortAnalyticsRespondent>,
): Promise<QuestionCohortSummaries> {
  questions = questions.filter((question) => question.type !== "repeat");
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

/** Build only the selected combined cohort and its per-status summaries from one scan. */
export async function summarizeSelectedQuestionCohort(
  questions: Question[],
  respondents: AsyncIterable<CohortAnalyticsRespondent>,
  statuses: readonly ParticipantStatus[],
): Promise<SelectedQuestionCohortSummaries> {
  questions = questions.filter((question) => question.type !== "repeat");
  const selectedStatuses = ANALYTICS_STATUSES.filter((status) => statuses.includes(status));
  const statusCounts: Record<ParticipantStatus, number> = { invited: 0, in_progress: 0, submitted: 0 };
  const byStatus = new Map(selectedStatuses.map((status) => [
    status,
    new Map(questions.map((question) => [question.id, createQuestionSummaryAccumulator(question)])),
  ]));

  for await (const respondent of respondents) {
    const accumulators = byStatus.get(respondent.status);
    if (!accumulators) continue;
    statusCounts[respondent.status] += 1;
    for (const accumulator of accumulators.values()) accumulator.add(respondent);
  }

  const combinedAccumulators = new Map(questions.map((question) => [question.id, createQuestionSummaryAccumulator(question)]));
  const statusSummaries: Partial<Record<ParticipantStatus, Record<string, QuestionSummary>>> = {};
  for (const status of selectedStatuses) {
    const accumulators = byStatus.get(status)!;
    statusSummaries[status] = Object.fromEntries([...accumulators].map(([id, accumulator]) => [id, accumulator.finish()]));
    for (const [id, accumulator] of accumulators) {
      combinedAccumulators.get(id)?.merge(accumulator, { consumeSource: true });
    }
  }
  const combined = Object.fromEntries([...combinedAccumulators].map(([id, accumulator]) => [id, accumulator.finish()]));

  return { asOf: new Date().toISOString(), statusCounts, combined, statusSummaries };
}
