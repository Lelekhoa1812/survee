import { isAnswered, validateAnswer } from "../format/answers";
import { scaleBounds, type Question } from "../format/schema";
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
  return !!question && ["single", "select", "multi", "scale"].includes(question.type);
}
