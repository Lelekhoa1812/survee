import type { Question } from "../format/schema";
import type { ParticipantStatus } from "../repo/types";
import type { QuestionSummary } from "./summary";
import type { AnswerCrossTabAnalysis } from "./segments";
import { neutraliseCell } from "../export/csv";

export interface AnalyticsExportItem {
  question: Question;
  summary: QuestionSummary;
  /** Optional per-row cohort label for side-by-side exports. */
  cohort?: string;
  /** Singleton signals for grouped results; does not certify anonymity or safety. */
  disclosureRisk?: { singletonSegment: boolean; singletonStatusGroups: ParticipantStatus[] };
}

export interface AnalyticsExportMetadata {
  interviewId?: string;
  surveyVersion?: number;
  asOf?: string;
  rowQuestionLabel?: string;
  columnQuestionLabel?: string;
}

const HEADERS = [
  "question_id", "question", "type", "cohort", "interview_id", "survey_version", "as_of", "measure", "answer_value", "answer_label",
  "count", "percent", "valid_responses", "cohort_count", "eligible", "inactive", "answered", "no_answer", "no_answer_note", "note_only", "unmapped", "min", "q1", "median", "q3", "mean", "max",
  "quantile_method", "quantile_approximate", "quantile_relative_value_accuracy", "quantile_bin_limit_per_sign", "quantile_bins_collapsed", "quantile_mapping_range_exceeded", "quantile_error_guarantee",
  "disclosure_risk_singleton_segment", "disclosure_risk_singleton_status_groups", "disclosure_risk_question_summary", "disclosure_risk_note",
  "scale_median_lower", "scale_median_upper",
];

const NO_ANSWER_NOTE = "Eligibility is inferred from current routing rules, not recorded display. no_answer counts eligible people without a non-empty stored answer; inactive people are reported separately.";
const DISCLOSURE_RISK_NOTE = "Singleton signals cover counts of one only; no minimum threshold or anonymity guarantee, and attribute combinations can add risk.";

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "string" ? neutraliseCell(value) : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function row(values: (string | number | null | undefined)[]): string {
  return values.map(cell).join(",");
}

/** Export aggregate summaries with their source cohort and time. Respondent names, notes, and free text are never read here. */
export function buildAnalyticsCsv(items: AnalyticsExportItem[], cohort: string, metadata: AnalyticsExportMetadata = {}): string {
  const rows = [row(HEADERS)];
  for (const { question, summary, cohort: itemCohort, disclosureRisk } of items) {
    const base = [question.id, question.label, question.type, itemCohort ?? cohort, metadata.interviewId, metadata.surveyVersion, metadata.asOf];
    const groupRisk = disclosureRisk ? [disclosureRisk.singletonSegment ? "true" : "false", disclosureRisk.singletonStatusGroups.join("|")] : [null, null];
    const risk = [...groupRisk, JSON.stringify(summary.disclosureRisk), DISCLOSURE_RISK_NOTE];
    if (summary.distribution.length) {
      for (const option of summary.distribution) {
        rows.push(row([
          ...base, "distribution", option.value, option.label, option.count, summary.distributionDenominator ? option.percent : null,
          summary.distributionDenominator, summary.cohortCount, summary.eligibleCount, summary.inactiveCount, summary.answeredCount, summary.noAnswerCount,
          NO_ANSWER_NOTE, summary.noteOnlyCount, summary.unmappedResponseCount, null, null, null, null, null, null,
          null, null, null, null, null, null, null, ...risk, null, null,
        ]));
      }
      if (summary.scaleMedian !== null) {
        rows.push(row([
          ...base, "ordinal_scale_median", null, null, null, null, summary.distributionDenominator,
          summary.cohortCount, summary.eligibleCount, summary.inactiveCount, summary.answeredCount, summary.noAnswerCount, NO_ANSWER_NOTE, summary.noteOnlyCount,
          summary.unmappedResponseCount, null, null, summary.scaleMedian, null, null, null,
          null, null, null, null, null, null, null, ...risk,
          summary.scaleMedianRange?.lower ?? summary.scaleMedian, summary.scaleMedianRange?.upper ?? summary.scaleMedian,
        ]));
      }
    } else if (question.type === "number") {
      rows.push(row([
        ...base, "numeric_summary", null, null, null, null, summary.numeric?.n ?? 0, summary.cohortCount,
        summary.eligibleCount, summary.inactiveCount, summary.answeredCount, summary.noAnswerCount, NO_ANSWER_NOTE, summary.noteOnlyCount, summary.unmappedResponseCount,
        summary.numeric?.min, summary.numeric?.q1, summary.numeric?.median, summary.numeric?.q3, summary.numeric?.mean, summary.numeric?.max,
        summary.numeric?.quantiles.method, summary.numeric ? String(summary.numeric.quantiles.approximate) : null,
        summary.numeric?.quantiles.relativeValueAccuracy, summary.numeric?.quantiles.binLimitPerSign,
        summary.numeric ? String(summary.numeric.quantiles.binsCollapsed) : null,
        summary.numeric ? String(summary.numeric.quantiles.mappingRangeExceeded) : null,
        summary.numeric?.quantiles.errorGuarantee,
        ...risk, null, null,
      ]));
    } else {
      rows.push(row([
        ...base, "response_count", null, null, summary.answeredCount, null, summary.answeredCount,
        summary.cohortCount, summary.eligibleCount, summary.inactiveCount, summary.answeredCount, summary.noAnswerCount, NO_ANSWER_NOTE, summary.noteOnlyCount,
        summary.unmappedResponseCount, null, null, null, null, null, null,
        null, null, null, null, null, null, null, ...risk, null, null,
      ]));
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}

/** Export every count-only cross-tab cell, including zeros and its row denominator. */
export function buildAnswerCrossTabCsv(
  result: Pick<AnswerCrossTabAnalysis, "rows" | "columns" | "cells" | "overlapping">,
  metadata: AnalyticsExportMetadata = {},
): string {
  const rows = [row([
    "row_question", "row_answer", "column_question", "column_answer", "interview_id", "survey_version", "as_of",
    "count", "row_denominator", "row_percent", "invited_count", "in_progress_count", "submitted_count",
    "singleton_cell", "singleton_status_groups", "overlapping_dimensions", "methodology_note",
  ])];
  const rowByKey = new Map(result.rows.map((item) => [item.key, item]));
  const columnByKey = new Map(result.columns.map((item) => [item.key, item]));
  const note = "No minimum group threshold or anonymity guarantee; checkbox dimensions overlap.";
  for (const item of result.cells) {
    const rowValue = rowByKey.get(item.rowKey);
    const columnValue = columnByKey.get(item.columnKey);
    if (!rowValue || !columnValue) continue;
    rows.push(row([
      metadata.rowQuestionLabel ?? "", rowValue.label, metadata.columnQuestionLabel ?? "", columnValue.label,
      metadata.interviewId, metadata.surveyVersion, metadata.asOf,
      item.participantCount, item.rowDenominator, item.rowPercent,
      item.statusCounts.invited, item.statusCounts.in_progress, item.statusCounts.submitted,
      item.disclosureRisk.singletonSegment ? "true" : "false", item.disclosureRisk.singletonStatusGroups.join("|"),
      result.overlapping ? "true" : "false", note,
    ]));
  }
  return `${rows.join("\r\n")}\r\n`;
}
