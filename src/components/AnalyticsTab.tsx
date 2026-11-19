"use client";

import { useEffect, useMemo, useState } from "react";
import type { QuestionSummary } from "@/lib/analytics/summary";
import { canCrossTabByAnswer, MAX_CROSSTAB_CELLS, MAX_CROSSTAB_DIMENSION_GROUPS, type AnswerCrossTabCell, type AnswerCrossTabValue, type AnswerSegmentGroup } from "@/lib/analytics/segments";
import { describeNumericQuantiles, formatPercentage, numericQuantileMethodLabel } from "@/lib/analytics/format";
import { buildAnalyticsCsv, buildAnswerCrossTabCsv } from "@/lib/analytics/export";
import { ANALYTICS_COHORTS, analyticsCohortForStatuses, type AnalyticsCohortKey } from "@/lib/analytics/cohorts";
import type { Question, QuestionType } from "@/lib/format/schema";
import type { ParticipantStatus } from "@/lib/repo/types";
import type { InterviewData } from "./interview-types";
import { fullTime } from "@/lib/time";
import { Badge, CopyButton, Icon } from "./ui";

type Display = "chart" | "table";

const STATUS_LABELS: Record<ParticipantStatus, string> = {
  invited: "Invited · not started",
  in_progress: "In progress",
  submitted: "Submitted",
};
const STATUS_SHORT_LABELS: Record<ParticipantStatus, string> = {
  invited: "Invited",
  in_progress: "In progress",
  submitted: "Submitted",
};
const COMPARE_STATUSES: ParticipantStatus[] = ["invited", "in_progress", "submitted"];
const SEGMENTABLE_TYPES = new Set<QuestionType>(["single", "select", "multi", "scale"]);
const MAX_SEGMENT_OUTCOMES = 20;

const TYPE_LABELS: Record<QuestionType, string> = {
  single: "Single choice",
  multi: "Checkboxes",
  select: "Dropdown",
  rank: "Rank all options",
  text: "Short text",
  longtext: "Paragraph",
  number: "Number",
  scale: "Scale",
  date: "Date",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function formatScaleMedianRange(range: QuestionSummary["scaleMedianRange"]) {
  if (!range) return "—";
  return range.lower === range.upper
    ? formatNumber(range.lower)
    : `${formatNumber(range.lower)}–${formatNumber(range.upper)}`;
}

function makeDownloadName(name: string) {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${safe || "interview"}-analysis.csv`;
}

function singletonSignals(summary: QuestionSummary): string[] {
  const risk = summary.disclosureRisk;
  const signals: string[] = [];
  if (risk.singletonCohort) signals.push("cohort n=1");
  if (risk.singletonAnsweredCount) signals.push("answered=1");
  if (risk.singletonNoAnswerCount) signals.push("no answer=1");
  if (risk.singletonNoteOnlyCount) signals.push("note only=1");
  if (risk.singletonUnmappedResponseCount) signals.push("unmapped=1");
  if (risk.singletonDistributionDenominator) signals.push("valid response n=1");
  for (const value of risk.singletonDistributionValues) {
    const option = summary.distribution.find((row) => row.value === value);
    signals.push(`${option?.label ?? value} count=1`);
  }
  if (risk.singletonNumericSummary) signals.push("numeric n=1");
  return signals;
}

function SingletonDisclosureNote({ summary }: { summary: QuestionSummary }) {
  const signals = singletonSignals(summary);
  if (!signals.length) return null;
  return <p className="analysis-disclosure-flag" role="note">Singleton signals: {signals.join(" · ")}. These flags do not assess attribute combinations or guarantee anonymity.</p>;
}

function ComparisonDisclosureNote({ summaries }: { summaries: Record<ParticipantStatus, QuestionSummary> }) {
  const groups = COMPARE_STATUSES.flatMap((status) => {
    const signals = singletonSignals(summaries[status]);
    return signals.length ? [`${STATUS_SHORT_LABELS[status]} — ${signals.join(", ")}`] : [];
  });
  if (!groups.length) return null;
  return <p className="analysis-disclosure-flag" role="note">Singleton signals: {groups.join("; ")}. These flags do not assess attribute combinations or guarantee anonymity.</p>;
}

function DistributionChart({ question, summary }: { question: Question; summary: QuestionSummary }) {
  return (
    <>
      {!summary.distributionDenominator && <p className="analysis-empty">No valid responses to chart yet. Counts are zero and percentages are unavailable.</p>}
      <p className="muted analysis-valid-n">Valid responses: n={summary.distributionDenominator}</p>
      <div className="analysis-chart" role="list" aria-label={`Answer distribution for ${question.label}; ${summary.distributionDenominator} valid responses`}>
        {summary.distribution.map((option) => (
          <div className="analysis-bar-row" role="listitem" key={option.value}>
            <span className="analysis-bar-label" title={option.label}>{option.label}</span>
            <div className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, option.percent)}%` }} /></div>
            <span className="analysis-bar-value">{option.count} <span className="muted">({summary.distributionDenominator ? formatPercentage(option.percent) : "—"})</span></span>
          </div>
        ))}
      </div>
    </>
  );
}

function DistributionTable({ question, summary }: { question: Question; summary: QuestionSummary }) {
  return (
    <div className="table-wrap analysis-table-wrap">
      <table className="t">
        <caption className="sr">Answer distribution for {question.label}</caption>
        <thead><tr><th scope="col">Answer</th><th scope="col">Count</th><th scope="col">Percent</th></tr></thead>
        <tbody>
          {summary.distribution.map((option) => (
            <tr key={option.value}>
              <td>{option.label}</td>
              <td>{option.count}</td>
              <td>{summary.distributionDenominator ? formatPercentage(option.percent) : "—"}</td>
            </tr>
          ))}
          <tr className="analysis-total"><th scope="row">Valid responses</th><td colSpan={2}>{summary.distributionDenominator}</td></tr>
        </tbody>
      </table>
    </div>
  );
}

function NumericSummary({ summary, display }: { summary: QuestionSummary; display: Display }) {
  const stats = summary.numeric;
  if (!stats) return <p className="analysis-empty">No valid numeric responses yet.</p>;
  if (display === "table") {
    return (
      <div className="table-wrap analysis-table-wrap">
        <table className="t">
          <caption className="sr">Descriptive statistics for numeric answers</caption>
          <thead><tr><th scope="col">Valid n</th><th scope="col">Minimum</th><th scope="col">Q1</th><th scope="col">Median</th><th scope="col">Q3</th><th scope="col">Mean</th><th scope="col">Maximum</th><th scope="col">Quartile method</th></tr></thead>
          <tbody><tr><td>{stats.n}</td><td>{formatNumber(stats.min)}</td><td>{formatNumber(stats.q1)}</td><td>{formatNumber(stats.median)}</td><td>{formatNumber(stats.q3)}</td><td>{formatNumber(stats.mean)}</td><td>{formatNumber(stats.max)}</td><td>{numericQuantileMethodLabel(stats)}</td></tr></tbody>
        </table>
        <p className="analysis-text-note">{describeNumericQuantiles(stats)}</p>
      </div>
    );
  }
  const span = stats.max - stats.min;
  const chartable = Number.isFinite(span);
  const position = (value: number) => span === 0 ? 50 : ((value - stats.min) / span) * 100;
  return (
    <div className="analysis-numeric-summary">
      {chartable ? (
        <div className="analysis-boxplot-wrap">
          <div
            className="analysis-boxplot"
            role="img"
            aria-label={`Number response range and quartiles: minimum ${formatNumber(stats.min)}, first quartile ${formatNumber(stats.q1)}, median ${formatNumber(stats.median)}, third quartile ${formatNumber(stats.q3)}, maximum ${formatNumber(stats.max)}; valid n ${stats.n}; quartiles ${numericQuantileMethodLabel(stats)}.`}
          >
            <div className="analysis-boxplot-track" aria-hidden="true" />
            {span === 0 ? (
              <span className="analysis-boxplot-point" aria-hidden="true" />
            ) : (
              <>
                <div className="analysis-boxplot-box" aria-hidden="true" style={{ left: `${position(stats.q1)}%`, width: `${position(stats.q3) - position(stats.q1)}%` }} />
                <span className="analysis-boxplot-median" aria-hidden="true" style={{ left: `${position(stats.median)}%` }} />
              </>
            )}
          </div>
          <div className="analysis-boxplot-axis"><span>Min {formatNumber(stats.min)}</span><span>Max {formatNumber(stats.max)}</span></div>
        </div>
      ) : <p className="analysis-text-note">The numeric range is too wide to draw on a finite linear axis.</p>}
      <dl className="analysis-stat-grid">
        <div><dt>Valid n</dt><dd>{stats.n}</dd></div>
        <div><dt>Q1</dt><dd>{formatNumber(stats.q1)}</dd></div>
        <div><dt>Median</dt><dd>{formatNumber(stats.median)}</dd></div>
        <div><dt>Q3</dt><dd>{formatNumber(stats.q3)}</dd></div>
        <div><dt>Mean</dt><dd>{formatNumber(stats.mean)}</dd></div>
      </dl>
      <p className="analysis-text-note">Box spans Q1 to Q3; line marks the median. Whiskers show the minimum and maximum, not outlier fences. {describeNumericQuantiles(stats)}</p>
    </div>
  );
}

function QuestionAnalysis({ question, summary, display, showHeading = true }: { question: Question; summary: QuestionSummary; display: Display; showHeading?: boolean }) {
  const hasDistribution = summary.distribution.length > 0;
  return (
    <article className="analysis-question">
      {showHeading && <div className="analysis-question-head">
        <div>
          <h3>{question.label}</h3>
          <div className="analysis-meta">
            <span className="code-chip">{question.id}</span>
            <span>{TYPE_LABELS[question.type]}</span>
            {question.required && <Badge kind="info" plain>Required</Badge>}
          </div>
        </div>
        <p className="analysis-response-count"><b>{summary.answeredCount}</b> answered · {summary.noAnswerCount} eligible with no answer · {summary.inactiveCount} inactive · eligible n={summary.eligibleCount} · cohort n={summary.cohortCount}</p>
      </div>}

      {!showHeading && <p className="analysis-response-count"><b>{summary.answeredCount}</b> answered · {summary.noAnswerCount} eligible with no answer · {summary.inactiveCount} inactive · eligible n={summary.eligibleCount} · cohort n={summary.cohortCount}</p>}

      <SingletonDisclosureNote summary={summary} />

      {hasDistribution && (display === "chart"
        ? <DistributionChart question={question} summary={summary} />
        : <DistributionTable question={question} summary={summary} />)}

      {question.type === "number" && <NumericSummary summary={summary} display={display} />}
      {question.type === "scale" && summary.scaleMedianRange !== null && (
        <p className="question-stats">{summary.scaleMedianRange.lower === summary.scaleMedianRange.upper ? "Median category" : "Median categories"}: {formatScaleMedianRange(summary.scaleMedianRange)} · valid n={summary.distributionDenominator}. These are observed ordinal categories; codes are not averaged and no mean is calculated.</p>
      )}
      {!hasDistribution && question.type !== "number" && (
        <p className="analysis-text-note">{question.type === "rank"
          ? "Response count only. KQA preserves each full order in individual answers and exports; it does not calculate a ranking score."
          : "Response count only. Text and date values are not included in this analysis; review individual answers in the Answers tab."}</p>
      )}
      {summary.unmappedResponseCount > 0 && (
        <p className="question-warning">{summary.unmappedResponseCount} stored {summary.unmappedResponseCount === 1 ? "answer does" : "answers do"} not match this version&apos;s options or range and {summary.unmappedResponseCount === 1 ? "is" : "are"} excluded from the summary.</p>
      )}
      {summary.noteOnlyCount > 0 && <p className="analysis-text-note">{summary.noteOnlyCount} {summary.noteOnlyCount === 1 ? "person added" : "people added"} a note without an answer. Notes are excluded from the analysis.</p>}
    </article>
  );
}

function ComparisonDistributionChart({ question, summaries }: { question: Question; summaries: Record<ParticipantStatus, QuestionSummary> }) {
  const rows = summaries.invited.distribution;
  return (
    <div className="analysis-compare-chart">
      <div className="analysis-compare-legend" role="list" aria-label="Status group valid response counts">
        {COMPARE_STATUSES.map((status) => (
          <span className={`analysis-compare-legend-item analysis-status-${status}`} role="listitem" key={status}>
            <i aria-hidden="true" />{STATUS_LABELS[status]} · valid n={summaries[status].distributionDenominator}
          </span>
        ))}
      </div>
      <div className="analysis-compare-options" role="list" aria-label={`Answer shares by status for ${question.label}`}>
        {rows.map((option) => (
          <div className="analysis-compare-option" role="listitem" key={option.value}>
            <h4>{option.label}</h4>
            <div className="analysis-compare-series-list">
              {COMPARE_STATUSES.map((status) => {
                const summary = summaries[status];
                const value = summary.distribution.find((row) => row.value === option.value);
                const count = value?.count ?? 0;
                const percent = summary.distributionDenominator ? value?.percent ?? 0 : null;
                const width = percent === null ? 0 : Math.max(0, Math.min(100, percent));
                const percentLabel = percent === null ? "—" : formatPercentage(percent);
                return (
                  <div
                    className={`analysis-compare-series analysis-status-${status}`}
                    role="group"
                    aria-label={`${STATUS_LABELS[status]}: ${count} of ${summary.distributionDenominator} valid responses${percent === null ? "" : `, ${percentLabel}`}`}
                    key={status}
                  >
                    <span className="analysis-compare-series-label">{status === "in_progress" ? "In progress" : status === "invited" ? "Invited" : "Submitted"}</span>
                    <div className="analysis-compare-track" aria-hidden="true"><i style={{ width: `${width}%` }} /></div>
                    <span className="analysis-compare-value">{count} ({percentLabel})</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ComparisonNumericChart({ summaries }: { summaries: Record<ParticipantStatus, QuestionSummary> }) {
  const values = COMPARE_STATUSES.flatMap((status) => {
    const stats = summaries[status].numeric;
    return stats ? [stats.min, stats.q1, stats.median, stats.q3, stats.max] : [];
  });
  if (!values.length) return <p className="analysis-empty">No valid numeric responses to compare yet.</p>;

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const span = maximum - minimum;
  if (!Number.isFinite(span)) {
    return <p className="analysis-text-note">The shared numeric range is too wide to draw on a finite linear axis. Use the data table for exact summaries.</p>;
  }
  const position = (value: number) => span === 0 ? 50 : ((value - minimum) / span) * 100;
  return (
    <div className="analysis-compare-numeric">
      <p className="analysis-text-note">Each status uses the same linear scale. The box spans Q1–Q3; the marker is the median and the line shows minimum–maximum. Quartiles may be approximate; each row's method and error limit are included in its accessible label and data table.</p>
      <div className="analysis-compare-range-list" role="list" aria-label="Numeric ranges by status">
        {COMPARE_STATUSES.map((status) => {
          const summary = summaries[status];
          const stats = summary.numeric;
          return (
            <div className="analysis-compare-range-row" role="listitem" key={status}>
              <div className="analysis-compare-range-heading">
                <strong>{STATUS_LABELS[status]}</strong>
                <span>valid n={stats?.n ?? 0}</span>
              </div>
              {stats ? <>
                <div className={`analysis-compare-range analysis-status-${status}`} role="img" aria-label={`${STATUS_LABELS[status]} numeric range: minimum ${formatNumber(stats.min)}, first quartile ${formatNumber(stats.q1)}, median ${formatNumber(stats.median)}, third quartile ${formatNumber(stats.q3)}, maximum ${formatNumber(stats.max)}; valid n=${stats.n}; quartiles ${numericQuantileMethodLabel(stats)}`}>
                  <span className="analysis-compare-whisker" aria-hidden="true" style={{ left: `${position(stats.min)}%`, width: `${position(stats.max) - position(stats.min)}%` }} />
                  <span className="analysis-compare-box" aria-hidden="true" style={{ left: `${position(stats.q1)}%`, width: `${position(stats.q3) - position(stats.q1)}%` }} />
                  <span className="analysis-compare-median" aria-hidden="true" style={{ left: `${position(stats.median)}%` }} />
                </div>
                <p className="analysis-compare-range-values">Min {formatNumber(stats.min)} · Q1 {formatNumber(stats.q1)} · Median {formatNumber(stats.median)} · Q3 {formatNumber(stats.q3)} · Max {formatNumber(stats.max)}</p>
              </> : <p className="analysis-compare-range-empty">No valid numeric responses.</p>}
            </div>
          );
        })}
      </div>
      <div className="analysis-compare-range-axis"><span>Min {formatNumber(minimum)}</span><span>Max {formatNumber(maximum)}</span></div>
    </div>
  );
}

function ComparisonTable({ question, summaries }: { question: Question; summaries: Record<ParticipantStatus, QuestionSummary> }) {
  const distributionQuestion = question.type === "single" || question.type === "multi" || question.type === "select" || question.type === "scale";
  const numericQuestion = question.type === "number";
  const distributionRows = summaries.invited.distribution;
  const numericRows: { label: string; value: (summary: QuestionSummary) => string }[] = [
    { label: "Valid responses", value: (summary) => String(summary.numeric?.n ?? 0) },
    { label: "Minimum", value: (summary) => summary.numeric ? formatNumber(summary.numeric.min) : "—" },
    { label: "Q1", value: (summary) => summary.numeric ? formatNumber(summary.numeric.q1) : "—" },
    { label: "Median", value: (summary) => summary.numeric ? formatNumber(summary.numeric.median) : "—" },
    { label: "Q3", value: (summary) => summary.numeric ? formatNumber(summary.numeric.q3) : "—" },
    { label: "Mean", value: (summary) => summary.numeric ? formatNumber(summary.numeric.mean) : "—" },
    { label: "Maximum", value: (summary) => summary.numeric ? formatNumber(summary.numeric.max) : "—" },
    { label: "Quartile method", value: (summary) => summary.numeric ? numericQuantileMethodLabel(summary.numeric) : "—" },
  ];
  const countRows: { label: string; value: (summary: QuestionSummary) => number }[] = [
    { label: "Answered", value: (summary) => summary.answeredCount },
    { label: "No answer", value: (summary) => summary.noAnswerCount },
    { label: "Note only", value: (summary) => summary.noteOnlyCount },
    { label: "Unmapped", value: (summary) => summary.unmappedResponseCount },
  ];

  return (
    <div className="table-wrap analysis-table-wrap analysis-compare-table-wrap" role="region" aria-label={`${question.label} status comparison table`} tabIndex={0}>
      <table className="t analysis-compare-table">
        <caption className="sr">{question.label}: invited, in progress, and submitted status comparison</caption>
        <thead>
          <tr>
            <th scope="col">Measure</th>
            {COMPARE_STATUSES.map((status) => <th scope="col" key={status}>{STATUS_LABELS[status]}<span className="analysis-cohort-denom">Cohort n={summaries[status].cohortCount}</span></th>)}
          </tr>
        </thead>
        <tbody>
          {distributionQuestion && (
            <>
              <tr className="analysis-total"><th scope="row">Valid responses (n)</th>{COMPARE_STATUSES.map((status) => <td key={status}>{summaries[status].distributionDenominator}</td>)}</tr>
              {distributionRows.map((option) => (
                <tr key={option.value}>
                  <th scope="row">{option.label}</th>
                  {COMPARE_STATUSES.map((status) => {
                    const value = summaries[status].distribution.find((item) => item.value === option.value);
                    const percent = summaries[status].distributionDenominator ? formatPercentage(value?.percent ?? 0) : "—";
                    return <td key={status}>{value ? `${value.count} (${percent})` : "—"}</td>;
                  })}
                </tr>
              ))}
              {question.type === "scale" && <tr><th scope="row">Median category (range if even n)</th>{COMPARE_STATUSES.map((status) => <td key={status}>{formatScaleMedianRange(summaries[status].scaleMedianRange)}</td>)}</tr>}
            </>
          )}
          {numericQuestion && numericRows.map((row, index) => (
            <tr className={index === 0 ? "analysis-total" : undefined} key={row.label}>
              <th scope="row">{row.label}</th>{COMPARE_STATUSES.map((status) => <td key={status}>{row.value(summaries[status])}</td>)}
            </tr>
          ))}
          {countRows.map((row, index) => (
            <tr className={index === 0 ? "analysis-total" : undefined} key={row.label}>
              <th scope="row">{row.label}</th>{COMPARE_STATUSES.map((status) => <td key={status}>{row.value(summaries[status])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ComparisonQuestion({ question, summaries, showHeading = true, display = "table" }: { question: Question; summaries: Record<ParticipantStatus, QuestionSummary>; showHeading?: boolean; display?: Display }) {
  const distributionQuestion = question.type === "single" || question.type === "multi" || question.type === "select" || question.type === "scale";
  const numericQuestion = question.type === "number";
  const responseCounts = COMPARE_STATUSES.map((status) => {
    const summary = summaries[status];
    const label = STATUS_LABELS[status];
    return `${label}: ${summary.answeredCount} answered, ${summary.noAnswerCount} no answer`;
  }).join(" · ");

  return (
    <article className="analysis-question">
      {showHeading && <div className="analysis-question-head">
        <div>
          <h3>{question.label}</h3>
          <div className="analysis-meta"><span className="code-chip">{question.id}</span><span>{TYPE_LABELS[question.type]}</span>{question.required && <Badge kind="info" plain>Required</Badge>}</div>
        </div>
        <p className="analysis-response-count">Three status groups</p>
      </div>}
      <p className="analysis-text-note">{responseCounts}</p>
      <ComparisonDisclosureNote summaries={summaries} />
      {question.type === "rank" && <p className="analysis-text-note">Full answer order is preserved in individual answers and exports. KQA reports counts only and does not calculate a ranking score.</p>}
      {display === "table" ? <ComparisonTable question={question} summaries={summaries} /> : <>
        {distributionQuestion && <ComparisonDistributionChart question={question} summaries={summaries} />}
        {numericQuestion && <ComparisonNumericChart summaries={summaries} />}
        {!distributionQuestion && !numericQuestion && question.type !== "rank" && <p className="analysis-text-note">There is no comparison chart for this question type. Use the data table for counts; text and date values are not aggregated.</p>}
        <details className="analysis-compare-table-details">
          <summary>Show data table</summary>
          <ComparisonTable question={question} summaries={summaries} />
        </details>
      </>}
      {distributionQuestion && <p className="analysis-text-note">Percentages use each status group&apos;s valid-response count above. Checkbox percentages are respondent shares and can total more than 100%.</p>}
      {display === "table" && (question.type === "text" || question.type === "longtext" || question.type === "date") && <p className="analysis-text-note">Text and date values are not aggregated. This comparison shows response counts only.</p>}
    </article>
  );
}

interface SegmentAnalysisResponse {
  interviewId: string;
  surveyVersion: number;
  asOf: string;
  segmentBy: { id: string; type: QuestionType; label: string };
  outcomes: { id: string; type: QuestionType; label: string }[];
  scope: { statuses: ParticipantStatus[]; participantCount: number; statusCounts: Record<ParticipantStatus, number>; compareStatuses: boolean };
  segments: AnswerSegmentGroup[];
  methodology: string[];
}

interface CrossTabAnalysisResponse {
  interviewId: string;
  surveyVersion: number;
  asOf: string;
  rowBy: { id: string; type: QuestionType; label: string };
  columnBy: { id: string; type: QuestionType; label: string };
  scope: { statuses: ParticipantStatus[]; participantCount: number; statusCounts: Record<ParticipantStatus, number> };
  rows: AnswerCrossTabValue[];
  columns: AnswerCrossTabValue[];
  cells: AnswerCrossTabCell[];
  overlapping: boolean;
  methodology: string[];
}

function CrossTabResults({ result, compareStatuses }: { result: CrossTabAnalysisResponse; compareStatuses: boolean }) {
  const cellByKey = new Map(result.cells.map((cell) => [JSON.stringify([cell.rowKey, cell.columnKey]), cell]));
  return (
    <section className="card analysis-segment-list" aria-label={`Cross-tab of ${result.rowBy.label} by ${result.columnBy.label}`}>
      <header className="analysis-segment-result-head">
        <div>
          <h2>{result.rowBy.label} × {result.columnBy.label}</h2>
          <p className="muted">{result.scope.participantCount} people in selected statuses · one shared scan · row percentages</p>
        </div>
      </header>
      <p className="analysis-disclosure-note">Small groups and combinations of answers can make people identifiable. KQA keeps every cell visible and does not apply a minimum size; follow your disclosure rules before sharing.</p>
      {result.overlapping && <p className="analysis-text-note analysis-cross-tab-note">At least one question uses checkboxes. A person can appear in multiple rows or columns, so counts and percentages can overlap or sum above 100%.</p>}
      <div className="table-wrap analysis-cross-tab-wrap">
        <table className="t analysis-cross-tab-table">
          <caption className="sr">Counts and row percentages for {result.rowBy.label} by {result.columnBy.label}; selected cohort size {result.scope.participantCount}.</caption>
          <thead><tr>
            <th scope="col">{result.rowBy.label} ↓ / {result.columnBy.label} →</th>
            {result.columns.map((column) => <th scope="col" key={column.key}>{column.label}<small>{column.participantCount} in column</small></th>)}
          </tr></thead>
          <tbody>{result.rows.map((row) => <tr key={row.key}>
            <th scope="row">{row.label}<small>{row.participantCount} in row</small></th>
            {result.columns.map((column) => {
              const cell = cellByKey.get(JSON.stringify([row.key, column.key]));
              if (!cell) return <td key={column.key}>—</td>;
              const percent = cell.rowPercent === null ? "—" : formatPercentage(cell.rowPercent);
              const statusDetail = compareStatuses
                ? `Invited ${cell.statusCounts.invited}; in progress ${cell.statusCounts.in_progress}; submitted ${cell.statusCounts.submitted}. `
                : "";
              return <td key={column.key} aria-label={`${cell.participantCount} of ${cell.rowDenominator} people in row, ${percent}. ${statusDetail}${cell.disclosureRisk.singletonSegment ? "Singleton cell: one person." : ""}`}>
                <span>{cell.participantCount} <span className="muted">({percent})</span></span>
                {compareStatuses && <small>Inv {cell.statusCounts.invited} · Prog {cell.statusCounts.in_progress} · Sub {cell.statusCounts.submitted}</small>}
                {cell.disclosureRisk.singletonSegment && <small className="analysis-disclosure-flag">1 person</small>}
              </td>;
            })}
          </tr>)}</tbody>
        </table>
      </div>
      <p className="analysis-freshness" role="status">Cross-tab completed {fullTime(result.asOf)} for n={result.scope.participantCount}. Each row percentage uses that row&apos;s participant count as the denominator.</p>
    </section>
  );
}

function SegmentResults({ questions, result, compareStatuses, display }: { questions: Question[]; result: SegmentAnalysisResponse; compareStatuses: boolean; display: Display }) {
  return (
    <section className="card analysis-segment-list" aria-label={`Results grouped by ${result.segmentBy.label}`}>
      <header className="analysis-segment-result-head">
        <div>
          <h2>{questions.length === 1 ? questions[0].label : `${questions.length} outcome questions`}</h2>
          <p className="muted">Grouped by {result.segmentBy.label} · {result.scope.participantCount} people in selected statuses · one shared scan</p>
        </div>
        {questions.length === 1 && <span className="code-chip">{questions[0].id}</span>}
      </header>
      <p className="analysis-disclosure-note">Small groups and combinations of attributes can make people identifiable. KQA keeps every group visible and does not apply a minimum size; follow your disclosure rules before sharing.</p>
      {result.segments.map((segment) => {
        const statusSummaries = segment.statusSummaries;
        const singletonStatuses = segment.disclosureRisk.singletonStatusGroups.map((status) => STATUS_SHORT_LABELS[status]);
        return (
          <article key={segment.key} className="analysis-segment">
            <div className="analysis-segment-head">
              <div>
                <h3>{segment.label}</h3>
                <p className="muted">{segment.participantCount} {segment.participantCount === 1 ? "participant" : "participants"}</p>
              </div>
              {compareStatuses && <p className="analysis-segment-statuses">
                Invited {segment.statusCounts.invited} · In progress {segment.statusCounts.in_progress} · Submitted {segment.statusCounts.submitted}
              </p>}
            </div>
            {segment.disclosureRisk.singletonSegment && <p className="analysis-disclosure-flag">Singleton group · 1 person in this segment.</p>}
            {!segment.disclosureRisk.singletonSegment && singletonStatuses.length > 0 && <p className="analysis-disclosure-flag">One-person status group{singletonStatuses.length === 1 ? "" : "s"} · {singletonStatuses.join(", ")}.</p>}
            {questions.map((question) => <div key={question.id} className="analysis-segment-outcome">
              <h4>{question.label}</h4>
              {compareStatuses && statusSummaries
                ? <ComparisonQuestion question={question} showHeading={false} display={display} summaries={{
                    invited: statusSummaries.invited![question.id],
                    in_progress: statusSummaries.in_progress![question.id],
                    submitted: statusSummaries.submitted![question.id],
                  }} />
                : <QuestionAnalysis question={question} showHeading={false} summary={segment.summaries[question.id]} display={display} />}
            </div>)}
          </article>
        );
      })}
    </section>
  );
}

export function AnalyticsTab({ data }: { data: InterviewData }) {
  const [cohortKey, setCohortKey] = useState<AnalyticsCohortKey>("everyone");
  const [compareStatuses, setCompareStatuses] = useState(false);
  const [display, setDisplay] = useState<Display>("chart");
  const [segmentMode, setSegmentMode] = useState(false);
  const [crossTabMode, setCrossTabMode] = useState(false);
  const [segmentById, setSegmentById] = useState("");
  const [segmentOutcomeIds, setSegmentOutcomeIds] = useState<string[]>([]);
  const [segmentResult, setSegmentResult] = useState<SegmentAnalysisResponse | null>(null);
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [segmentError, setSegmentError] = useState("");
  const [crossTabColumnId, setCrossTabColumnId] = useState("");
  const [crossTabResult, setCrossTabResult] = useState<CrossTabAnalysisResponse | null>(null);
  const [crossTabLoading, setCrossTabLoading] = useState(false);
  const [crossTabError, setCrossTabError] = useState("");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<QuestionType | "all">("all");
  const cohort = ANALYTICS_COHORTS.find((item) => item.key === cohortKey) ?? ANALYTICS_COHORTS[0];
  const cohortLabel = cohort.label;
  const statusCounts = data.analysis?.statusCounts ?? { invited: 0, in_progress: 0, submitted: 0 };
  const cohortCount = cohort.statuses.reduce((count, status) => count + statusCounts[status], 0);
  const questions = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return data.manifest.questions.filter((question) => {
      const matchesType = typeFilter === "all" || question.type === typeFilter;
      const matchesSearch = !normalizedSearch || `${question.id} ${question.label}`.toLocaleLowerCase().includes(normalizedSearch);
      return matchesType && matchesSearch;
    });
  }, [data.manifest.questions, search, typeFilter]);
  const segmentQuestions = useMemo(() => data.manifest.questions.filter((question) => SEGMENTABLE_TYPES.has(question.type)), [data.manifest.questions]);
  const segmentQuestion = segmentQuestions.find((question) => question.id === segmentById) ?? segmentQuestions[0];
  const crossTabColumnQuestions = segmentQuestions.filter((question) => canCrossTabByAnswer(segmentQuestion, question));
  const crossTabColumnQuestion = crossTabColumnQuestions.find((question) => question.id === crossTabColumnId) ?? crossTabColumnQuestions[0];
  const canMakeCrossTab = segmentQuestions.some((rowQuestion) => segmentQuestions.some((columnQuestion) => canCrossTabByAnswer(rowQuestion, columnQuestion)));
  const outcomeQuestions = questions.filter((question) => question.id !== segmentQuestion?.id);
  const visibleOutcomeIds = new Set(outcomeQuestions.map((question) => question.id));
  const chosenOutcomeIds = segmentOutcomeIds.filter((id) => visibleOutcomeIds.has(id));
  const selectedOutcomeQuestions = chosenOutcomeIds.length
    ? outcomeQuestions.filter((question) => chosenOutcomeIds.includes(question.id))
    : outcomeQuestions.slice(0, 1);
  const selectedOutcomeIdsParam = JSON.stringify(selectedOutcomeQuestions.map((question) => question.id));
  const selectedStatuses = compareStatuses ? COMPARE_STATUSES : cohort.statuses;
  const selectedStatusesParam = selectedStatuses.join(",");
  const currentSegmentResult = segmentResult
    && segmentResult.interviewId === data.interview.id
    && segmentResult.surveyVersion === data.interview.currentVersion
    && segmentQuestion
    && segmentResult.segmentBy.id === segmentQuestion.id
    && segmentResult.outcomes.length === selectedOutcomeQuestions.length
    && segmentResult.outcomes.every((outcome, index) => outcome.id === selectedOutcomeQuestions[index]?.id)
    && segmentResult.scope.compareStatuses === compareStatuses
    && segmentResult.scope.statuses.length === selectedStatuses.length
    && segmentResult.scope.statuses.every((status, index) => status === selectedStatuses[index])
    ? segmentResult
    : null;
  const currentCrossTabResult = crossTabResult
    && crossTabResult.interviewId === data.interview.id
    && crossTabResult.surveyVersion === data.interview.currentVersion
    && segmentQuestion
    && crossTabColumnQuestion
    && crossTabResult.rowBy.id === segmentQuestion.id
    && crossTabResult.columnBy.id === crossTabColumnQuestion.id
    && crossTabResult.scope.statuses.length === selectedStatuses.length
    && crossTabResult.scope.statuses.every((status, index) => status === selectedStatuses[index])
    ? crossTabResult
    : null;
  const segmentResultsPending = segmentMode && !segmentError && selectedOutcomeQuestions.length > 0 && !currentSegmentResult;
  const cohortSummaries = data.analysis?.summaries[cohort.key] ?? {};
  const summaries = useMemo(() => new Map(questions.map((question) => [question.id, cohortSummaries[question.id]])), [questions, cohortSummaries]);
  const exportItems = useMemo(() => compareStatuses
    ? questions.flatMap((question) => COMPARE_STATUSES.map((status) => ({ question, summary: data.analysis!.summaries[status][question.id], cohort: STATUS_LABELS[status] })))
    : questions.map((question) => ({ question, summary: summaries.get(question.id)! })),
  [questions, summaries, compareStatuses, data.analysis]);
  const segmentExportItems = useMemo(() => {
    if (!currentSegmentResult || !selectedOutcomeQuestions.length || !segmentQuestion) return [];
    return currentSegmentResult.segments.flatMap((segment) => selectedOutcomeQuestions.flatMap((question) => compareStatuses
      ? COMPARE_STATUSES.flatMap((status) => {
          const summary = segment.statusSummaries?.[status]?.[question.id];
          return summary ? [{
            question,
            summary,
            cohort: `${segmentQuestion.label} = ${segment.label} · ${STATUS_LABELS[status]}`,
            disclosureRisk: {
              singletonSegment: segment.statusCounts[status] === 1,
              singletonStatusGroups: segment.statusCounts[status] === 1 ? [status] : [],
            },
          }] : [];
        })
      : [{ question, summary: segment.summaries[question.id], cohort: `${segmentQuestion.label} = ${segment.label}`, disclosureRisk: segment.disclosureRisk }]));
  }, [currentSegmentResult, selectedOutcomeIdsParam, segmentQuestion, compareStatuses]);
  const activeExportItems = segmentMode ? segmentExportItems : exportItems;
  const csv = useMemo(() => buildAnalyticsCsv(activeExportItems, cohortLabel, {
    interviewId: data.interview.id,
    surveyVersion: data.interview.currentVersion,
    asOf: segmentMode ? currentSegmentResult?.asOf : data.analysis?.asOf,
  }), [activeExportItems, cohortLabel, data.interview.id, data.interview.currentVersion, data.analysis?.asOf, segmentMode, currentSegmentResult?.asOf]);
  const crossTabCsv = currentCrossTabResult ? buildAnswerCrossTabCsv(currentCrossTabResult, {
    interviewId: data.interview.id,
    surveyVersion: data.interview.currentVersion,
    asOf: currentCrossTabResult.asOf,
    rowQuestionLabel: currentCrossTabResult.rowBy.label,
    columnQuestionLabel: currentCrossTabResult.columnBy.label,
  }) : "";
  const activeCsv = crossTabMode ? crossTabCsv : csv;
  const exportReady = crossTabMode ? !!currentCrossTabResult : segmentMode ? !!currentSegmentResult : !!questions.length;
  const submitted = cohort.statuses.some((status) => status === "submitted") ? statusCounts.submitted : 0;
  const inProgress = cohort.statuses.some((status) => status === "in_progress") ? statusCounts.in_progress : 0;
  const selectedParticipantCount = compareStatuses
    ? statusCounts.invited + statusCounts.in_progress + statusCounts.submitted
    : cohortCount;

  function toggleStatus(status: ParticipantStatus, checked: boolean) {
    const next = checked ? [...cohort.statuses, status] : cohort.statuses.filter((item) => item !== status);
    const match = analyticsCohortForStatuses(next);
    if (match) setCohortKey(match.key);
  }

  function toggleSegmentOutcome(questionId: string, checked: boolean) {
    const selected = selectedOutcomeQuestions.map((question) => question.id);
    if (checked) {
      if (selected.length >= MAX_SEGMENT_OUTCOMES) return;
      setSegmentOutcomeIds([...selected, questionId]);
    } else {
      const next = selected.filter((id) => id !== questionId);
      if (next.length) setSegmentOutcomeIds(next);
    }
  }

  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([activeCsv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = makeDownloadName(data.interview.name);
    anchor.style.display = "none";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  useEffect(() => {
    if (!segmentMode || !segmentQuestion || !selectedOutcomeQuestions.length) {
      setSegmentResult(null);
      setSegmentError("");
      setSegmentLoading(false);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({ surveyVersion: String(data.interview.currentVersion), segmentBy: segmentQuestion.id, statuses: selectedStatusesParam, compareStatuses: String(compareStatuses) });
    for (const question of selectedOutcomeQuestions) query.append("questionId", question.id);
    setSegmentResult(null);
    setSegmentError("");
    setSegmentLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/interviews/${encodeURIComponent(data.interview.id)}/analysis?${query}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as (SegmentAnalysisResponse & { ok?: boolean; error?: string }) | null;
        if (!response.ok || !body?.ok) throw new Error(body?.error || "Could not load answer segments. Try again.");
        if (body.interviewId !== data.interview.id || body.surveyVersion !== data.interview.currentVersion) {
          throw new Error("The survey changed while analysis loaded. Reload the interview before viewing or exporting these results.");
        }
        setSegmentResult(body);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSegmentError(error instanceof Error ? error.message : "Could not load answer segments.");
      } finally {
        if (!controller.signal.aborted) setSegmentLoading(false);
      }
    })();
    return () => controller.abort();
  }, [segmentMode, segmentQuestion?.id, selectedOutcomeIdsParam, data.interview.id, data.interview.currentVersion, selectedStatusesParam, compareStatuses]);

  useEffect(() => {
    if (!crossTabMode || !segmentQuestion || !crossTabColumnQuestion) {
      setCrossTabResult(null);
      setCrossTabError("");
      setCrossTabLoading(false);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({
      surveyVersion: String(data.interview.currentVersion),
      segmentBy: segmentQuestion.id,
      crossTabWith: crossTabColumnQuestion.id,
      statuses: selectedStatusesParam,
    });
    setCrossTabResult(null);
    setCrossTabError("");
    setCrossTabLoading(true);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/interviews/${encodeURIComponent(data.interview.id)}/analysis?${query}`, {
          credentials: "same-origin",
          cache: "no-store",
          signal: controller.signal,
        });
        const body = await response.json().catch(() => null) as (CrossTabAnalysisResponse & { ok?: boolean; error?: string }) | null;
        if (!response.ok || !body?.ok) throw new Error(body?.error || "Could not load the cross-tab. Try again.");
        if (body.interviewId !== data.interview.id || body.surveyVersion !== data.interview.currentVersion
          || body.rowBy.id !== segmentQuestion.id || body.columnBy.id !== crossTabColumnQuestion.id) {
          throw new Error("The survey changed while analysis loaded. Reload the interview before viewing or exporting these results.");
        }
        setCrossTabResult(body);
      } catch (error) {
        if (controller.signal.aborted) return;
        setCrossTabError(error instanceof Error ? error.message : "Could not load the cross-tab.");
      } finally {
        if (!controller.signal.aborted) setCrossTabLoading(false);
      }
    })();
    return () => controller.abort();
  }, [crossTabMode, segmentQuestion?.id, crossTabColumnQuestion?.id, data.interview.id, data.interview.currentVersion, selectedStatusesParam]);

  const groups = useMemo(() => {
    const sections = data.manifest.sections ?? [];
    const known = new Set(sections.map((section) => section.id));
    const out = sections.map((section) => ({
      id: section.id,
      title: section.title,
      questions: questions.filter((question) => question.section === section.id),
    })).filter((section) => section.questions.length);
    const loose = questions.filter((question) => !question.section || !known.has(question.section));
    if (loose.length) out.push({ id: "_", title: sections.length ? "Other questions" : "Questions", questions: loose });
    return out;
  }, [data.manifest.sections, questions]);

  return (
    <div className="stack">
      <section className="card analysis-intro">
        <div className="analysis-intro-head">
          <div>
            <h2>Response analysis</h2>
            <p>Descriptive summaries for the current survey version. Earlier wording is not separated from current wording. No minimum group size is applied.</p>
          </div>
          <Badge kind="info" plain>Version {data.interview.currentVersion}</Badge>
        </div>
        <p className="analysis-caveat">Choose one status cohort or compare invited, in-progress, and submitted groups side by side. Each question&apos;s cohort denominator includes everyone in that status group. Eligibility and inactivity are inferred from current routing rules and saved answers; they are not historical records that a question was displayed. No-answer counts include eligible people only, with inactive people reported separately. Checkbox percentages can total more than 100%. Text and note content are excluded. Singleton signals flag counts of one, but do not assess identification from combinations of attributes or guarantee anonymity. These summaries describe the selected interview cohort; nonresponse or self-selection can shape results. They do not establish population representativeness, statistical significance, or causal effects.</p>
        {data.analysis?.asOf && <p className="analysis-freshness" role="status">Analytics read completed {fullTime(data.analysis.asOf)}. Status groups share one live scan; updates during that scan may be observed.</p>}
      </section>

      {compareStatuses ? <div className="stats analysis-stats">
        {COMPARE_STATUSES.map((status) => <div className="stat" key={status}><b>{statusCounts[status]}</b><span>{STATUS_LABELS[status]}</span></div>)}
        <div className="stat"><b>{questions.length}</b><span>Questions shown</span></div>
      </div> : <div className="stats analysis-stats">
        <div className="stat"><b>{cohortCount}</b><span>{cohortLabel} in cohort</span></div>
        <div className="stat"><b>{submitted}</b><span>Submitted in cohort</span></div>
        <div className="stat"><b>{inProgress}</b><span>In progress in cohort</span></div>
        <div className="stat"><b>{questions.length}</b><span>Questions shown</span></div>
      </div>}

      <section className="card analysis-controls" aria-label="Analysis controls">
        <div className="analysis-control-grid">
          <div className="field">
            <label htmlFor="analysis-search">Find a question</label>
            <input id="analysis-search" className="input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search label or ID" />
          </div>
          <div className="field">
            <label htmlFor="analysis-type">Question type</label>
            <select id="analysis-type" className="select" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as QuestionType | "all")}>
              <option value="all">All types</option>
              {Object.entries(TYPE_LABELS).map(([type, label]) => <option key={type} value={type}>{label}</option>)}
            </select>
          </div>
        </div>
        <div className="analysis-control-footer">
          <div className="seg" role="group" aria-label="Analysis view">
            <button type="button" aria-pressed={!segmentMode && !crossTabMode} onClick={() => { setSegmentMode(false); setCrossTabMode(false); }}>Question summaries</button>
            <button type="button" aria-pressed={segmentMode} disabled={!segmentQuestions.length} onClick={() => { setCrossTabMode(false); setSegmentMode(true); }}>Break down by answer</button>
            <button type="button" aria-pressed={crossTabMode} disabled={!canMakeCrossTab} onClick={() => { setSegmentMode(false); setCrossTabMode(true); }}>Cross-tab answers</button>
          </div>
          <div className="seg" role="group" aria-label="Cohort view">
            <button type="button" aria-pressed={!compareStatuses} onClick={() => setCompareStatuses(false)}>One cohort</button>
            <button type="button" aria-pressed={compareStatuses} onClick={() => setCompareStatuses(true)}>Compare statuses</button>
          </div>
          {!compareStatuses && <fieldset className="analysis-cohort-options">
            <legend>Include participant statuses</legend>
            {(["invited", "in_progress", "submitted"] as const).map((status) => (
              <label key={status} className="analysis-cohort-option">
                <input
                  type="checkbox"
                  checked={cohort.statuses.some((item) => item === status)}
                  disabled={cohort.statuses.length === 1 && cohort.statuses.some((item) => item === status)}
                  onChange={(event) => toggleStatus(status, event.target.checked)}
                />
                <span>{STATUS_LABELS[status]} <span className="muted">({statusCounts[status]})</span></span>
              </label>
            ))}
          </fieldset>}
          <div className="seg" role="group" aria-label="Display format">
            <button type="button" aria-pressed={display === "chart"} onClick={() => setDisplay("chart")}>Chart</button>
            <button type="button" aria-pressed={display === "table"} onClick={() => setDisplay("table")}>Table</button>
          </div>
          <div className="row wrap analysis-export-actions">
            <CopyButton className="btn sm" label="Copy CSV" done="Copied" getText={() => activeCsv} disabled={!exportReady} />
            <button type="button" className="btn sm" onClick={downloadCsv} disabled={!exportReady}><Icon name="download" size={14} /> Download CSV</button>
          </div>
        </div>
        {segmentMode && <div className="analysis-segment-controls">
          <div className="field">
            <label htmlFor="analysis-segment-by">Break down by answer</label>
            <select id="analysis-segment-by" className="select" value={segmentQuestion?.id ?? ""} onChange={(event) => {
              const nextSegmentId = event.target.value;
              setSegmentById(nextSegmentId);
              setSegmentOutcomeIds((current) => current.filter((id) => id !== nextSegmentId));
              setSegmentResult(null);
              setSegmentError("");
              setCrossTabResult(null);
              setCrossTabError("");
            }}>
              {segmentQuestions.map((question) => <option key={question.id} value={question.id}>{question.label}</option>)}
            </select>
          </div>
          <fieldset className="analysis-outcome-picker" aria-describedby="analysis-outcome-help">
            <legend>Outcome questions</legend>
            <p id="analysis-outcome-help" className="muted">{selectedOutcomeQuestions.length} of {MAX_SEGMENT_OUTCOMES} selected. Choose one or more; summaries share one participant scan.</p>
            <div className="analysis-outcome-options">
              {outcomeQuestions.map((question) => {
                const checked = selectedOutcomeQuestions.some((selected) => selected.id === question.id);
                const atLimit = selectedOutcomeQuestions.length >= MAX_SEGMENT_OUTCOMES;
                return <label key={question.id} className="analysis-outcome-option">
                  <input
                    type="checkbox"
                    data-question-id={question.id}
                    checked={checked}
                    disabled={!checked && atLimit}
                    onChange={(event) => toggleSegmentOutcome(question.id, event.target.checked)}
                  />
                  <span>{question.label}</span>
                  <span className="muted">{TYPE_LABELS[question.type]}</span>
                </label>;
              })}
            </div>
          </fieldset>
        </div>}
        {crossTabMode && <div className="analysis-segment-controls">
          <div className="field">
            <label htmlFor="analysis-cross-tab-row">Row question</label>
            <select id="analysis-cross-tab-row" className="select" value={segmentQuestion?.id ?? ""} onChange={(event) => {
              setSegmentById(event.target.value);
              setSegmentResult(null);
              setCrossTabResult(null);
              setSegmentError("");
              setCrossTabError("");
            }}>
              {segmentQuestions.map((question) => <option key={question.id} value={question.id}>{question.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="analysis-cross-tab-column">Column question</label>
            <select id="analysis-cross-tab-column" className="select" value={crossTabColumnQuestion?.id ?? ""} onChange={(event) => {
              setCrossTabColumnId(event.target.value);
              setCrossTabResult(null);
              setCrossTabError("");
            }}>
              {crossTabColumnQuestions.map((question) => <option key={question.id} value={question.id}>{question.label}</option>)}
            </select>
            <span className="hint">Each question is limited to {MAX_CROSSTAB_DIMENSION_GROUPS} groups and the matrix to {MAX_CROSSTAB_CELLS} cells.</span>
          </div>
        </div>}
      </section>

      <p className="muted analysis-result-count" aria-live="polite">{segmentMode
        ? segmentLoading || segmentResultsPending ? "Calculating answer groups…" : `${currentSegmentResult?.segments.length ?? 0} answer groups · ${compareStatuses ? "Invited, in progress, and submitted groups are shown separately" : `${cohortCount} ${cohortCount === 1 ? "person" : "people"} in this cohort`}`
        : crossTabMode
          ? crossTabLoading ? "Calculating cross-tab…" : `${currentCrossTabResult?.cells.length ?? 0} cells · ${selectedParticipantCount} ${selectedParticipantCount === 1 ? "person" : "people"} in this cohort`
          : `Showing ${questions.length} of ${data.manifest.questions.length} questions · ${compareStatuses ? "Invited, in progress, and submitted groups are shown separately" : `${cohortCount} ${cohortCount === 1 ? "person" : "people"} in this cohort`}`}</p>
      {segmentMode ? <>
        {!segmentQuestions.length && <div className="card empty"><h3>No categorical questions to segment by</h3><p>Add a single-choice, dropdown, checkbox, or scale question to define answer groups.</p></div>}
        {!selectedOutcomeQuestions.length && segmentQuestions.length > 0 && <div className="card empty"><h3>No outcome questions match</h3><p>Change the search or question type filter, or choose a different segmentation question.</p></div>}
        {segmentQuestion?.type === "multi" && <p className="analysis-text-note">This checkbox question can place one person in several answer groups. Group counts and percentages overlap and must not be added together.</p>}
        {(segmentLoading || segmentResultsPending) && <p className="card analysis-segment-message" role="status">Calculating answer groups…</p>}
        {segmentError && <p className="card analysis-segment-message question-warning" role="alert">{segmentError}</p>}
        {currentSegmentResult && selectedOutcomeQuestions.length > 0 && <>
          <p className="analysis-freshness" role="status">Segment analysis completed {fullTime(currentSegmentResult.asOf)} for n={currentSegmentResult.scope.participantCount}. All selected outcome summaries share one live scan.</p>
          <SegmentResults questions={selectedOutcomeQuestions} result={currentSegmentResult} compareStatuses={compareStatuses} display={display} />
        </>}
      </> : crossTabMode ? <>
        {!canMakeCrossTab && <div className="card empty"><h3>No compatible question pair</h3><p>Choose two different single-choice, dropdown, checkbox, or bounded scale questions with at most {MAX_CROSSTAB_DIMENSION_GROUPS} groups each and no more than {MAX_CROSSTAB_CELLS} cells.</p></div>}
        {canMakeCrossTab && !crossTabColumnQuestions.length && <div className="card empty"><h3>No compatible column for this row</h3><p>Choose another row question with a smaller answer set.</p></div>}
        {(crossTabLoading || (!crossTabError && !currentCrossTabResult && crossTabColumnQuestions.length > 0)) && <p className="card analysis-segment-message" role="status">Calculating cross-tab…</p>}
        {crossTabError && <p className="card analysis-segment-message question-warning" role="alert">{crossTabError}</p>}
        {currentCrossTabResult && <CrossTabResults result={currentCrossTabResult} compareStatuses={compareStatuses} />}
      </> : groups.length ? groups.map((group) => (
        <section key={group.id} className="stack" style={{ gap: 10 }}>
          <h2 className="section-title">{group.title}</h2>
          <div className="card analysis-question-list">
            {group.questions.map((question) => compareStatuses
              ? <ComparisonQuestion key={question.id} question={question} display={display} summaries={{ invited: data.analysis!.summaries.invited[question.id], in_progress: data.analysis!.summaries.in_progress[question.id], submitted: data.analysis!.summaries.submitted[question.id] }} />
              : <QuestionAnalysis key={question.id} question={question} summary={summaries.get(question.id)!} display={display} />)}
          </div>
        </section>
      )) : (
        <div className="card empty">
          <div className="ico"><Icon name="inbox" size={24} /></div>
          <h3>No questions match</h3>
          <p>Try a different search or question type.</p>
        </div>
      )}
    </div>
  );
}
