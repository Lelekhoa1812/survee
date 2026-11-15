"use client";

import { useEffect, useMemo, useState } from "react";
import type { QuestionSummary } from "@/lib/analytics/summary";
import type { AnswerSegmentGroup } from "@/lib/analytics/segments";
import { formatPercentage } from "@/lib/analytics/format";
import { buildAnalyticsCsv } from "@/lib/analytics/export";
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
const COMPARE_STATUSES: ParticipantStatus[] = ["invited", "in_progress", "submitted"];
const SEGMENTABLE_TYPES = new Set<QuestionType>(["single", "select", "multi", "scale"]);

const TYPE_LABELS: Record<QuestionType, string> = {
  single: "Single choice",
  multi: "Checkboxes",
  select: "Dropdown",
  text: "Short text",
  longtext: "Paragraph",
  number: "Number",
  scale: "Scale",
  date: "Date",
};

function formatNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function makeDownloadName(name: string) {
  const safe = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${safe || "interview"}-analysis.csv`;
}

function DistributionChart({ question, summary }: { question: Question; summary: QuestionSummary }) {
  if (!summary.distributionDenominator) {
    return <p className="analysis-empty">No valid responses to chart yet.</p>;
  }
  return (
    <>
      <p className="muted analysis-valid-n">Valid responses: n={summary.distributionDenominator}</p>
      <div className="analysis-chart" role="list" aria-label={`Answer distribution for ${question.label}; ${summary.distributionDenominator} valid responses`}>
        {summary.distribution.map((option) => (
          <div className="analysis-bar-row" role="listitem" key={option.value}>
            <span className="analysis-bar-label" title={option.label}>{option.label}</span>
            <div className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, option.percent)}%` }} /></div>
            <span className="analysis-bar-value">{option.count} <span className="muted">({formatPercentage(option.percent)})</span></span>
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
          <thead><tr><th scope="col">Valid n</th><th scope="col">Minimum</th><th scope="col">Q1</th><th scope="col">Median</th><th scope="col">Q3</th><th scope="col">Mean</th><th scope="col">Maximum</th></tr></thead>
          <tbody><tr><td>{stats.n}</td><td>{formatNumber(stats.min)}</td><td>{formatNumber(stats.q1)}</td><td>{formatNumber(stats.median)}</td><td>{formatNumber(stats.q3)}</td><td>{formatNumber(stats.mean)}</td><td>{formatNumber(stats.max)}</td></tr></tbody>
        </table>
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
            aria-label={`Number response range and quartiles: minimum ${formatNumber(stats.min)}, first quartile ${formatNumber(stats.q1)}, median ${formatNumber(stats.median)}, third quartile ${formatNumber(stats.q3)}, maximum ${formatNumber(stats.max)}; valid n ${stats.n}.`}
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
      <p className="analysis-text-note">Box spans Q1 to Q3; line marks the median. Whiskers show the minimum and maximum, not outlier fences.</p>
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
        <p className="analysis-response-count"><b>{summary.answeredCount}</b> answered · cohort n={summary.cohortCount}</p>
      </div>}

      {hasDistribution && (display === "chart"
        ? <DistributionChart question={question} summary={summary} />
        : <DistributionTable question={question} summary={summary} />)}

      {question.type === "number" && <NumericSummary summary={summary} display={display} />}
      {question.type === "scale" && summary.scaleMedian !== null && (
        <p className="question-stats">Median response: {formatNumber(summary.scaleMedian)} · valid n={summary.distributionDenominator}. Scale responses are ordinal; no mean is calculated.</p>
      )}
      {!hasDistribution && question.type !== "number" && (
        <p className="analysis-text-note">Response count only. Text and date values are not included in this analysis; review individual answers in the Answers tab.</p>
      )}
      {summary.unmappedResponseCount > 0 && (
        <p className="question-warning">{summary.unmappedResponseCount} stored {summary.unmappedResponseCount === 1 ? "answer does" : "answers do"} not match this version&apos;s options or range and {summary.unmappedResponseCount === 1 ? "is" : "are"} excluded from the summary.</p>
      )}
      {summary.noteOnlyCount > 0 && <p className="analysis-text-note">{summary.noteOnlyCount} {summary.noteOnlyCount === 1 ? "person added" : "people added"} a note without an answer. Notes are excluded from the analysis.</p>}
    </article>
  );
}

export function ComparisonQuestion({ question, summaries, showHeading = true }: { question: Question; summaries: Record<ParticipantStatus, QuestionSummary>; showHeading?: boolean }) {
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
  ];
  const countRows: { label: string; value: (summary: QuestionSummary) => number }[] = [
    { label: "Answered", value: (summary) => summary.answeredCount },
    { label: "No answer", value: (summary) => summary.noAnswerCount },
    { label: "Note only", value: (summary) => summary.noteOnlyCount },
    { label: "Unmapped", value: (summary) => summary.unmappedResponseCount },
  ];

  return (
    <article className="analysis-question">
      {showHeading && <div className="analysis-question-head">
        <div>
          <h3>{question.label}</h3>
          <div className="analysis-meta"><span className="code-chip">{question.id}</span><span>{TYPE_LABELS[question.type]}</span>{question.required && <Badge kind="info" plain>Required</Badge>}</div>
        </div>
        <p className="analysis-response-count">Three status groups</p>
      </div>}
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
                {question.type === "scale" && <tr><th scope="row">Median (ordinal)</th>{COMPARE_STATUSES.map((status) => <td key={status}>{summaries[status].scaleMedian === null ? "—" : formatNumber(summaries[status].scaleMedian!)}</td>)}</tr>}
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
      {distributionQuestion && <p className="analysis-text-note">Percentages use each status group&apos;s valid-response count above. Checkbox percentages are respondent shares and can total more than 100%.</p>}
      {(question.type === "text" || question.type === "longtext" || question.type === "date") && <p className="analysis-text-note">Text and date values are not aggregated. This comparison shows response counts only.</p>}
    </article>
  );
}

interface SegmentAnalysisResponse {
  asOf: string;
  segmentBy: { id: string; type: QuestionType; label: string };
  outcome: { id: string; type: QuestionType; label: string };
  scope: { statuses: ParticipantStatus[]; participantCount: number; statusCounts: Record<ParticipantStatus, number>; compareStatuses: boolean };
  segments: AnswerSegmentGroup[];
  methodology: string[];
}

function SegmentResults({ question, result, compareStatuses, display }: { question: Question; result: SegmentAnalysisResponse; compareStatuses: boolean; display: Display }) {
  return (
    <section className="card analysis-segment-list" aria-label={`Results grouped by ${result.segmentBy.label}`}>
      <header className="analysis-segment-result-head">
        <div>
          <h2>{question.label}</h2>
          <p className="muted">Outcome · {TYPE_LABELS[question.type]} · {result.scope.participantCount} people in selected statuses</p>
        </div>
        <span className="code-chip">{question.id}</span>
      </header>
      {result.segments.map((segment) => {
        const statusSummaries = segment.statusSummaries;
        return (
          <article key={segment.key} className="analysis-segment">
            <div className="analysis-segment-head">
              <div>
                <h3>{segment.label}</h3>
                <p className="muted">{segment.participantCount} {segment.participantCount === 1 ? "participant" : "participants"} · {segment.summaries[question.id].answeredCount} outcome answers</p>
              </div>
              {compareStatuses && <p className="analysis-segment-statuses">
                Invited {segment.statusCounts.invited} · In progress {segment.statusCounts.in_progress} · Submitted {segment.statusCounts.submitted}
              </p>}
            </div>
            {compareStatuses && statusSummaries
              ? <ComparisonQuestion question={question} showHeading={false} summaries={{
                  invited: statusSummaries.invited![question.id],
                  in_progress: statusSummaries.in_progress![question.id],
                  submitted: statusSummaries.submitted![question.id],
                }} />
              : <QuestionAnalysis question={question} showHeading={false} summary={segment.summaries[question.id]} display={display} />}
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
  const [segmentById, setSegmentById] = useState("");
  const [segmentOutcomeId, setSegmentOutcomeId] = useState("");
  const [segmentResult, setSegmentResult] = useState<SegmentAnalysisResponse | null>(null);
  const [segmentLoading, setSegmentLoading] = useState(false);
  const [segmentError, setSegmentError] = useState("");
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
  const outcomeQuestions = questions.filter((question) => question.id !== segmentQuestion?.id);
  const outcomeQuestion = outcomeQuestions.find((question) => question.id === segmentOutcomeId) ?? outcomeQuestions[0];
  const cohortSummaries = data.analysis?.summaries[cohort.key] ?? {};
  const summaries = useMemo(() => new Map(questions.map((question) => [question.id, cohortSummaries[question.id]])), [questions, cohortSummaries]);
  const exportItems = useMemo(() => compareStatuses
    ? questions.flatMap((question) => COMPARE_STATUSES.map((status) => ({ question, summary: data.analysis!.summaries[status][question.id], cohort: STATUS_LABELS[status] })))
    : questions.map((question) => ({ question, summary: summaries.get(question.id)! })),
  [questions, summaries, compareStatuses, data.analysis]);
  const segmentExportItems = useMemo(() => {
    if (!segmentResult || !outcomeQuestion || !segmentQuestion) return [];
    return segmentResult.segments.flatMap((segment) => compareStatuses
      ? COMPARE_STATUSES.flatMap((status) => {
          const summary = segment.statusSummaries?.[status]?.[outcomeQuestion.id];
          return summary ? [{ question: outcomeQuestion, summary, cohort: `${segmentQuestion.label} = ${segment.label} · ${STATUS_LABELS[status]}` }] : [];
        })
      : [{ question: outcomeQuestion, summary: segment.summaries[outcomeQuestion.id], cohort: `${segmentQuestion.label} = ${segment.label}` }]);
  }, [segmentResult, outcomeQuestion, segmentQuestion, compareStatuses]);
  const activeExportItems = segmentMode ? segmentExportItems : exportItems;
  const csv = useMemo(() => buildAnalyticsCsv(activeExportItems, cohortLabel, {
    interviewId: data.interview.id,
    surveyVersion: data.interview.currentVersion,
    asOf: segmentMode ? segmentResult?.asOf : data.analysis?.asOf,
  }), [activeExportItems, cohortLabel, data.interview.id, data.interview.currentVersion, data.analysis?.asOf, segmentMode, segmentResult?.asOf]);
  const selectedStatuses = compareStatuses ? COMPARE_STATUSES : cohort.statuses;
  const selectedStatusesParam = selectedStatuses.join(",");
  const submitted = cohort.statuses.some((status) => status === "submitted") ? statusCounts.submitted : 0;
  const inProgress = cohort.statuses.some((status) => status === "in_progress") ? statusCounts.in_progress : 0;

  function toggleStatus(status: ParticipantStatus, checked: boolean) {
    const next = checked ? [...cohort.statuses, status] : cohort.statuses.filter((item) => item !== status);
    const match = analyticsCohortForStatuses(next);
    if (match) setCohortKey(match.key);
  }

  function downloadCsv() {
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
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
    if (!segmentMode || !segmentQuestion || !outcomeQuestion) {
      setSegmentResult(null);
      setSegmentError("");
      setSegmentLoading(false);
      return;
    }
    const controller = new AbortController();
    const query = new URLSearchParams({
      segmentBy: segmentQuestion.id,
      questionId: outcomeQuestion.id,
      statuses: selectedStatusesParam,
      compareStatuses: String(compareStatuses),
    });
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
        setSegmentResult(body);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSegmentError(error instanceof Error ? error.message : "Could not load answer segments.");
      } finally {
        if (!controller.signal.aborted) setSegmentLoading(false);
      }
    })();
    return () => controller.abort();
  }, [segmentMode, segmentQuestion?.id, outcomeQuestion?.id, data.interview.id, selectedStatusesParam, compareStatuses]);

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
        <p className="analysis-caveat">Choose one status cohort or compare invited, in-progress, and submitted groups side by side. Each question&apos;s cohort denominator includes everyone in that status group. KQA does not track whether a conditional or routed question was shown, so no-answer counts may include people who did not see the question. Checkbox percentages can total more than 100%. Text and note content are excluded. These summaries describe the selected interview cohort; nonresponse or self-selection can shape results. They do not establish population representativeness, statistical significance, or causal effects.</p>
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
            <button type="button" aria-pressed={!segmentMode} onClick={() => setSegmentMode(false)}>Question summaries</button>
            <button type="button" aria-pressed={segmentMode} disabled={!segmentQuestions.length} onClick={() => setSegmentMode(true)}>Break down by answer</button>
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
          {!compareStatuses && <div className="seg" role="group" aria-label="Display format">
            <button type="button" aria-pressed={display === "chart"} onClick={() => setDisplay("chart")}>Chart</button>
            <button type="button" aria-pressed={display === "table"} onClick={() => setDisplay("table")}>Table</button>
          </div>}
          <div className="row wrap analysis-export-actions">
            <CopyButton className="btn sm" label="Copy CSV" done="Copied" getText={() => csv} disabled={segmentMode ? !segmentResult : !questions.length} />
            <button type="button" className="btn sm" onClick={downloadCsv} disabled={segmentMode ? !segmentResult : !questions.length}><Icon name="download" size={14} /> Download CSV</button>
          </div>
        </div>
        {segmentMode && <div className="analysis-segment-controls">
          <div className="field">
            <label htmlFor="analysis-segment-by">Break down by answer</label>
            <select id="analysis-segment-by" className="select" value={segmentQuestion?.id ?? ""} onChange={(event) => setSegmentById(event.target.value)}>
              {segmentQuestions.map((question) => <option key={question.id} value={question.id}>{question.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="analysis-segment-outcome">Outcome question</label>
            <select id="analysis-segment-outcome" className="select" value={outcomeQuestion?.id ?? ""} onChange={(event) => setSegmentOutcomeId(event.target.value)} disabled={!outcomeQuestions.length}>
              {outcomeQuestions.map((question) => <option key={question.id} value={question.id}>{question.label}</option>)}
            </select>
          </div>
        </div>}
      </section>

      <p className="muted analysis-result-count" aria-live="polite">{segmentMode
        ? segmentLoading ? "Calculating answer groups…" : `${segmentResult?.segments.length ?? 0} answer groups · ${compareStatuses ? "Invited, in progress, and submitted groups are shown separately" : `${cohortCount} ${cohortCount === 1 ? "person" : "people"} in this cohort`}`
        : `Showing ${questions.length} of ${data.manifest.questions.length} questions · ${compareStatuses ? "Invited, in progress, and submitted groups are shown separately" : `${cohortCount} ${cohortCount === 1 ? "person" : "people"} in this cohort`}`}</p>
      {segmentMode ? <>
        {!segmentQuestions.length && <div className="card empty"><h3>No categorical questions to segment by</h3><p>Add a single-choice, dropdown, checkbox, or scale question to define answer groups.</p></div>}
        {!outcomeQuestion && segmentQuestions.length > 0 && <div className="card empty"><h3>No outcome questions match</h3><p>Change the search or question type filter, or choose a different segmentation question.</p></div>}
        {segmentQuestion?.type === "multi" && <p className="analysis-text-note">This checkbox question can place one person in several answer groups. Group counts and percentages overlap and must not be added together.</p>}
        {segmentLoading && <p className="card analysis-segment-message" role="status">Calculating answer groups…</p>}
        {segmentError && <p className="card analysis-segment-message question-warning" role="alert">{segmentError}</p>}
        {segmentResult && outcomeQuestion && <>
          <p className="analysis-freshness" role="status">Segment analysis completed {fullTime(segmentResult.asOf)} for n={segmentResult.scope.participantCount}. Group summaries share one live scan.</p>
          <SegmentResults question={outcomeQuestion} result={segmentResult} compareStatuses={compareStatuses} display={display} />
        </>}
      </> : groups.length ? groups.map((group) => (
        <section key={group.id} className="stack" style={{ gap: 10 }}>
          <h2 className="section-title">{group.title}</h2>
          <div className="card analysis-question-list">
            {group.questions.map((question) => compareStatuses
              ? <ComparisonQuestion key={question.id} question={question} summaries={{ invited: data.analysis!.summaries.invited[question.id], in_progress: data.analysis!.summaries.in_progress[question.id], submitted: data.analysis!.summaries.submitted[question.id] }} />
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
