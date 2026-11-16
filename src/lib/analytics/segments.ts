import { isAnswered, validateAnswer } from "../format/answers";
import { LIMITS, scaleBounds, type Question } from "../format/schema";
import type { ParticipantStatus } from "../repo/types";
import { ANALYTICS_STATUSES } from "./cohorts";
import { createQuestionSummaryAccumulator, type CohortAnalyticsRespondent, type QuestionSummary, type QuestionSummaryAccumulator } from "./summary";

export type AnswerSegmentKind = "answer" | "no_answer" | "unmapped";

export interface AnswerSegmentDisclosureRisk {
  /** A detectable singleton signal, not a complete assessment of identifiability. */
  singletonSegment: boolean;
  /** Status groups with one person when per-status summaries are returned. */
  singletonStatusGroups: ParticipantStatus[];
}

export interface AnswerSegmentGroup {
  key: string;
  kind: AnswerSegmentKind;
  value?: string;
  label: string;
  participantCount: number;
  disclosureRisk: AnswerSegmentDisclosureRisk;
  statusCounts: Record<ParticipantStatus, number>;
  summaries: Record<string, QuestionSummary>;
  statusSummaries?: Partial<Record<ParticipantStatus, Record<string, QuestionSummary>>>;
}

export interface AnswerSegmentAnalysis {
  asOf: string;
  statuses: ParticipantStatus[];
  participantCount: number;
  statusCounts: Record<ParticipantStatus, number>;
  segments: AnswerSegmentGroup[];
}

export interface AnswerCrossTabValue {
  key: string;
  kind: AnswerSegmentKind;
  value?: string;
  label: string;
  participantCount: number;
  statusCounts: Record<ParticipantStatus, number>;
}

export interface AnswerCrossTabCell {
  rowKey: string;
  columnKey: string;
  participantCount: number;
  rowDenominator: number;
  rowPercent: number | null;
  statusCounts: Record<ParticipantStatus, number>;
  disclosureRisk: AnswerSegmentDisclosureRisk;
}

export interface AnswerCrossTabAnalysis {
  asOf: string;
  statuses: ParticipantStatus[];
  participantCount: number;
  statusCounts: Record<ParticipantStatus, number>;
  rows: AnswerCrossTabValue[];
  columns: AnswerCrossTabValue[];
  cells: AnswerCrossTabCell[];
  overlapping: boolean;
}

interface SegmentDefinition {
  key: string;
  kind: AnswerSegmentKind;
  value?: string;
  label: string;
}

interface MutableSegment extends SegmentDefinition {
  participantCount: number;
  statusCounts: Record<ParticipantStatus, number>;
  combined?: Map<string, QuestionSummaryAccumulator>;
  byStatus?: Partial<Record<ParticipantStatus, Map<string, QuestionSummaryAccumulator>>>;
}

const MAX_SCALE_SEGMENT_VALUES = LIMITS.scaleSpanMax + 1;
/** Bounds the matrix and per-person work, including the no-answer and unmapped groups. */
export const MAX_CROSSTAB_CELLS = 400;
export const MAX_CROSSTAB_DIMENSION_GROUPS = 20;

function hasBoundedScaleSegments(question: Question): boolean {
  const bounds = scaleBounds(question);
  const first = Math.ceil(bounds.min);
  const last = Math.floor(bounds.max);
  const count = Math.floor(bounds.max) - Math.ceil(bounds.min) + 1;
  return bounds.max > bounds.min && Number.isSafeInteger(first) && Number.isSafeInteger(last)
    && Number.isFinite(count) && count > 0 && count <= MAX_SCALE_SEGMENT_VALUES;
}

function scaleSegmentationError(): string {
  return `Scale segmentation supports at most ${MAX_SCALE_SEGMENT_VALUES} integer answer groups using safe integer bounds. Update the scale range before analyzing it.`;
}

function definitions(question: Question): SegmentDefinition[] {
  const bounds = question.type === "scale" ? scaleBounds(question) : null;
  const values = bounds
    ? Array.from({ length: Math.floor(bounds.max) - Math.ceil(bounds.min) + 1 }, (_, index) => String(Math.ceil(bounds.min) + index)).map((value) => ({ value, label: value }))
    : (question.options ?? []).map(({ value, label }) => ({ value, label }));
  return [
    ...values.map(({ value, label }) => ({ key: `answer:${value}`, kind: "answer" as const, value, label })),
    { key: "special:no_answer", kind: "no_answer", label: "No stored answer" },
    { key: "special:unmapped", kind: "unmapped", label: "Unmapped answer" },
  ];
}

function answerSegments(question: Question, respondent: CohortAnalyticsRespondent): string[] {
  if (!isAnswered(question, respondent.answers)) return ["special:no_answer"];
  const validation = validateAnswer(question, respondent.answers[question.id]?.value);
  if (!validation.ok || validation.value === null) return ["special:unmapped"];
  if (question.type === "multi") {
    return Array.isArray(validation.value) ? validation.value.map((value) => `answer:${value}`) : ["special:unmapped"];
  }
  return [`answer:${String(validation.value)}`];
}

function crosstabCellKey(rowKey: string, columnKey: string): string {
  return JSON.stringify([rowKey, columnKey]);
}

/**
 * Count every answer pair in a two-question cross-tab. Checkbox dimensions deliberately overlap;
 * each person contributes once per distinct answer pair. No raw or free-form answer is emitted.
 */
export async function summarizeAnswerCrossTab(
  rowQuestion: Question,
  columnQuestion: Question,
  respondents: AsyncIterable<CohortAnalyticsRespondent>,
  statuses: ParticipantStatus[] = [...ANALYTICS_STATUSES],
): Promise<AnswerCrossTabAnalysis> {
  if (rowQuestion.id === columnQuestion.id) throw new Error("Choose two different questions for a cross-tab.");
  if (!canSegmentByAnswer(rowQuestion)) throw new Error(answerSegmentationError(rowQuestion));
  if (!canSegmentByAnswer(columnQuestion)) throw new Error(answerSegmentationError(columnQuestion));
  if (!canCrossTabByAnswer(rowQuestion, columnQuestion)) {
    throw new Error(answerCrossTabError(rowQuestion, columnQuestion));
  }

  const rowGroups = definitions(rowQuestion).map((definition) => ({
    ...definition, participantCount: 0, statusCounts: { invited: 0, in_progress: 0, submitted: 0 },
  }));
  const columnGroups = definitions(columnQuestion).map((definition) => ({
    ...definition, participantCount: 0, statusCounts: { invited: 0, in_progress: 0, submitted: 0 },
  }));
  const rowByKey = new Map(rowGroups.map((group) => [group.key, group]));
  const columnByKey = new Map(columnGroups.map((group) => [group.key, group]));
  const counts = new Map<string, { participantCount: number; statusCounts: Record<ParticipantStatus, number> }>();
  const statusCounts: Record<ParticipantStatus, number> = { invited: 0, in_progress: 0, submitted: 0 };

  for await (const respondent of respondents) {
    statusCounts[respondent.status] += 1;
    const rowKeys = [...new Set(answerSegments(rowQuestion, respondent))];
    const columnKeys = [...new Set(answerSegments(columnQuestion, respondent))];
    for (const key of rowKeys) {
      const group = rowByKey.get(key);
      if (!group) continue;
      group.participantCount += 1;
      group.statusCounts[respondent.status] += 1;
    }
    for (const key of columnKeys) {
      const group = columnByKey.get(key);
      if (!group) continue;
      group.participantCount += 1;
      group.statusCounts[respondent.status] += 1;
    }
    for (const rowKey of rowKeys) for (const columnKey of columnKeys) {
      const key = crosstabCellKey(rowKey, columnKey);
      const cell = counts.get(key) ?? { participantCount: 0, statusCounts: { invited: 0, in_progress: 0, submitted: 0 } };
      cell.participantCount += 1;
      cell.statusCounts[respondent.status] += 1;
      counts.set(key, cell);
    }
  }

  const rows = rowGroups.filter((group) => group.kind === "answer" || group.participantCount > 0);
  const columns = columnGroups.filter((group) => group.kind === "answer" || group.participantCount > 0);
  const cells = rows.flatMap((row) => columns.map((column): AnswerCrossTabCell => {
    const count = counts.get(crosstabCellKey(row.key, column.key));
    const participantCount = count?.participantCount ?? 0;
    const rowDenominator = row.participantCount;
    return {
      rowKey: row.key,
      columnKey: column.key,
      participantCount,
      rowDenominator,
      rowPercent: rowDenominator ? participantCount / rowDenominator * 100 : null,
      statusCounts: count?.statusCounts ?? { invited: 0, in_progress: 0, submitted: 0 },
      disclosureRisk: {
        singletonSegment: participantCount === 1,
        singletonStatusGroups: statuses.filter((status) => count?.statusCounts[status] === 1),
      },
    };
  }));

  return {
    asOf: new Date().toISOString(),
    statuses: [...statuses],
    participantCount: statuses.reduce((count, status) => count + statusCounts[status], 0),
    statusCounts,
    rows,
    columns,
    cells,
    overlapping: rowQuestion.type === "multi" || columnQuestion.type === "multi",
  };
}

export function canCrossTabByAnswer(rowQuestion: Question | undefined, columnQuestion: Question | undefined): boolean {
  if (!rowQuestion || !columnQuestion || rowQuestion.id === columnQuestion.id
    || !canSegmentByAnswer(rowQuestion) || !canSegmentByAnswer(columnQuestion)) return false;
  const rowGroups = definitions(rowQuestion).length;
  const columnGroups = definitions(columnQuestion).length;
  return rowGroups <= MAX_CROSSTAB_DIMENSION_GROUPS
    && columnGroups <= MAX_CROSSTAB_DIMENSION_GROUPS
    && rowGroups * columnGroups <= MAX_CROSSTAB_CELLS;
}

export function answerCrossTabError(rowQuestion: Question | undefined, columnQuestion: Question | undefined): string {
  if (rowQuestion?.id === columnQuestion?.id && rowQuestion) return "Choose two different questions for a cross-tab.";
  if (!canSegmentByAnswer(rowQuestion)) return answerSegmentationError(rowQuestion);
  if (!canSegmentByAnswer(columnQuestion)) return answerSegmentationError(columnQuestion);
  return `Cross-tabs support at most ${MAX_CROSSTAB_DIMENSION_GROUPS} groups per question and ${MAX_CROSSTAB_CELLS} answer cells, including no-answer and unmapped groups. Choose questions with fewer answer options.`;
}

function accumulators(questions: Question[]): Map<string, QuestionSummaryAccumulator> {
  return new Map(questions.map((question) => [question.id, createQuestionSummaryAccumulator(question)]));
}

/**
 * Summarize selected outcomes inside answer-defined groups using one projected respondent scan.
 * Only closed categorical dimensions are supported; text, date, and free-form number values never
 * become group labels. Multi-select dimensions intentionally overlap across option groups.
 */
export async function summarizeAnswerSegments(
  segmentQuestion: Question,
  questions: Question[],
  respondents: AsyncIterable<CohortAnalyticsRespondent>,
  statuses: ParticipantStatus[] = [...ANALYTICS_STATUSES],
  compareStatuses = false,
): Promise<AnswerSegmentAnalysis> {
  if (segmentQuestion.type === "scale" && !hasBoundedScaleSegments(segmentQuestion)) {
    throw new Error(scaleSegmentationError());
  }
  const groups: MutableSegment[] = definitions(segmentQuestion).map((definition) => ({
    ...definition,
    participantCount: 0,
    statusCounts: { invited: 0, in_progress: 0, submitted: 0 },
    ...(compareStatuses
      ? { byStatus: Object.fromEntries(statuses.map((status) => [status, accumulators(questions)])) as Partial<Record<ParticipantStatus, Map<string, QuestionSummaryAccumulator>>> }
      : { combined: accumulators(questions) }),
  }));
  const groupByKey = new Map(groups.map((group) => [group.key, group]));
  const statusCounts: Record<ParticipantStatus, number> = { invited: 0, in_progress: 0, submitted: 0 };

  for await (const respondent of respondents) {
    statusCounts[respondent.status] += 1;
    for (const key of answerSegments(segmentQuestion, respondent)) {
      const group = groupByKey.get(key);
      if (!group) continue;
      group.participantCount += 1;
      group.statusCounts[respondent.status] += 1;
      const destination = compareStatuses ? group.byStatus?.[respondent.status] : group.combined;
      if (!destination) continue;
      for (const accumulator of destination.values()) accumulator.add(respondent);
    }
  }

  const segments = groups
    .filter((group) => group.kind === "answer" || group.participantCount > 0)
    .map((group): AnswerSegmentGroup => {
      const statusSummaries: Partial<Record<ParticipantStatus, Record<string, QuestionSummary>>> = {};
      if (compareStatuses) {
        for (const status of statuses) {
          const byQuestion = group.byStatus?.[status];
          if (byQuestion) statusSummaries[status] = Object.fromEntries([...byQuestion].map(([id, accumulator]) => [id, accumulator.finish()]));
        }
        const combined = accumulators(questions);
        for (const status of statuses) {
          const byQuestion = group.byStatus?.[status];
          if (!byQuestion) continue;
          for (const [id, accumulator] of byQuestion) {
            combined.get(id)?.merge(accumulator, { consumeSource: true });
          }
        }
        return {
          key: group.key, kind: group.kind, ...(group.value === undefined ? {} : { value: group.value }), label: group.label,
          participantCount: group.participantCount,
          disclosureRisk: {
            singletonSegment: group.participantCount === 1,
            singletonStatusGroups: statuses.filter((status) => group.statusCounts[status] === 1),
          },
          statusCounts: group.statusCounts,
          summaries: Object.fromEntries([...combined].map(([id, accumulator]) => [id, accumulator.finish()])),
          statusSummaries,
        };
      }
      return {
        key: group.key, kind: group.kind, ...(group.value === undefined ? {} : { value: group.value }), label: group.label,
        participantCount: group.participantCount,
        disclosureRisk: { singletonSegment: group.participantCount === 1, singletonStatusGroups: [] },
        statusCounts: group.statusCounts,
        summaries: Object.fromEntries([...(group.combined ?? [])].map(([id, accumulator]) => [id, accumulator.finish()])),
      };
    });

  return {
    asOf: new Date().toISOString(),
    statuses: [...statuses],
    participantCount: statuses.reduce((count, status) => count + statusCounts[status], 0),
    statusCounts,
    segments,
  };
}

export function canSegmentByAnswer(question: Question | undefined): question is Question & { type: "single" | "select" | "multi" | "scale" } {
  return !!question
    && ["single", "select", "multi", "scale"].includes(question.type)
    && (question.type !== "scale" || hasBoundedScaleSegments(question));
}

export function answerSegmentationError(question: Question | undefined): string {
  if (question?.type === "scale" && !hasBoundedScaleSegments(question)) return scaleSegmentationError();
  return "Segment by a single-choice, dropdown, checkbox, or scale question. Text, date, and free-form number questions cannot define groups.";
}
