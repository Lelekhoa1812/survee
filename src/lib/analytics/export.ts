import type { Question } from "../format/schema";
import type { QuestionSummary } from "./summary";

export interface AnalyticsExportItem {
  question: Question;
  summary: QuestionSummary;
}

const HEADERS = [
  "question_id", "question", "type", "cohort", "measure", "answer_value", "answer_label",
  "count", "percent", "valid_responses", "answered", "missing", "min", "median", "mean", "max",
];

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

/** Export aggregate summaries only. Respondent names, notes, and free-text answers are never read here. */
export function buildAnalyticsCsv(items: AnalyticsExportItem[], cohort: string): string {
  const rows = [row(HEADERS)];
  for (const { question, summary } of items) {
    const base = [question.id, question.label, question.type, cohort];
    if (summary.distribution.length) {
      for (const option of summary.distribution) {
        rows.push(row([
          ...base, "distribution", option.value, option.label, option.count, summary.distributionDenominator ? option.percent : null,
          summary.distributionDenominator, summary.answeredCount, summary.missingCount, null, null, null, null,
        ]));
      }
      if (summary.scaleMedian !== null) {
        rows.push(row([
          ...base, "ordinal_scale_median", null, null, null, null, summary.distributionDenominator,
          summary.answeredCount, summary.missingCount, null, summary.scaleMedian, null, null,
        ]));
      }
    } else if (question.type === "number") {
      rows.push(row([
        ...base, "numeric_summary", null, null, null, null, summary.numeric?.n ?? 0, summary.answeredCount,
        summary.missingCount, summary.numeric?.min, summary.numeric?.median, summary.numeric?.mean, summary.numeric?.max,
      ]));
    } else {
      rows.push(row([
        ...base, "response_count", null, null, summary.answeredCount, null, summary.answeredCount,
        summary.answeredCount, summary.missingCount, null, null, null, null,
      ]));
    }
  }
  return `${rows.join("\r\n")}\r\n`;
}
