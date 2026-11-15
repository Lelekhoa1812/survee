import type { Question } from "../format/schema";
import type { ParticipantStatus } from "../repo/types";
import type { QuestionSummary } from "./summary";

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
}

const HEADERS = [
  "question_id", "question", "type", "cohort", "interview_id", "survey_version", "as_of", "measure", "answer_value", "answer_label",
  "count", "percent", "valid_responses", "cohort_count", "answered", "no_answer", "no_answer_note", "note_only", "unmapped", "min", "q1", "median", "q3", "mean", "max",
  "disclosure_risk_singleton_segment", "disclosure_risk_singleton_status_groups", "disclosure_risk_question_summary", "disclosure_risk_note",
  "scale_median_lower", "scale_median_upper",
];

const NO_ANSWER_NOTE = "KQA does not track conditional or routed item display; no_answer may include people who did not see this question.";
const DISCLOSURE_RISK_NOTE = "Singleton signals cover counts of one only; no minimum threshold or anonymity guarantee, and attribute combinations can add risk.";

function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let text = String(value);
  // Keep spreadsheet programs from interpreting survey-authored labels as formulas.
  if (typeof value === "string" && /^[\u0000-\u0020]*[=+\-@]/.test(text)) text = `'${text}`;
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
          summary.distributionDenominator, summary.cohortCount, summary.answeredCount, summary.noAnswerCount,
          NO_ANSWER_NOTE, summary.noteOnlyCount, summary.unmappedResponseCount, null, null, null, null, null, null, ...risk, null, null,
        ]));
      }
      if (summary.scaleMedian !== null) {
        rows.push(row([
          ...base, "ordinal_scale_median", null, null, null, null, summary.distributionDenominator,
          summary.cohortCount, summary.answeredCount, summary.noAnswerCount, NO_ANSWER_NOTE, summary.noteOnlyCount,
          summary.unmappedResponseCount, null, null, summary.scaleMedian, null, null, null, ...risk,
          summary.scaleMedianRange?.lower ?? summary.scaleMedian, summary.scaleMedianRange?.upper ?? summary.scaleMedian,
        ]));
      }
    } else if (question.type === "number") {
      rows.push(row([
        ...base, "numeric_summary", null, null, null, null, summary.numeric?.n ?? 0, summary.cohortCount,
        summary.answeredCount, summary.noAnswerCount, NO_ANSWER_NOTE, summary.noteOnlyCount, summary.unmappedResponseCount,
        summary.numeric?.min, summary.numeric?.q1, summary.numeric?.median, summary.numeric?.q3, summary.numeric?.mean, summary.numeric?.max, ...risk, null, null,
      ]));
    } else {
      rows.push(row([
        ...base, "response_count", null, null, summary.answeredCount, null, summary.answeredCount,
        summary.cohortCount, summary.answeredCount, summary.noAnswerCount, NO_ANSWER_NOTE, summary.noteOnlyCount,
        summary.unmappedResponseCount, null, null, null, null, null, null, ...risk, null, null,
      ]));
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}
