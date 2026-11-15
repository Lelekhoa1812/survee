"use client";

import { useMemo, useState } from "react";
import { summarizeQuestion, type QuestionSummary } from "@/lib/analytics/summary";
import { formatPercentage } from "@/lib/analytics/format";
import { buildAnalyticsCsv } from "@/lib/analytics/export";
import type { Question, QuestionType } from "@/lib/format/schema";
import type { InterviewData, PersonRow } from "./interview-types";
import { Badge, CopyButton, Icon } from "./ui";

type Cohort = "everyone" | "submitted";
type Display = "chart" | "table";

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

function selectedPeople(people: PersonRow[], cohort: Cohort) {
  return cohort === "submitted" ? people.filter((person) => person.status === "submitted") : people;
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
    <div className="analysis-chart" role="list" aria-label={`Answer distribution for ${question.label}`}>
      {summary.distribution.map((option) => (
        <div className="analysis-bar-row" role="listitem" key={option.value}>
          <span className="analysis-bar-label" title={option.label}>{option.label}</span>
          <div className="bar" aria-hidden="true"><i style={{ width: `${Math.min(100, option.percent)}%` }} /></div>
          <span className="analysis-bar-value">{option.count} <span className="muted">({formatPercentage(option.percent)})</span></span>
        </div>
      ))}
    </div>
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
          <thead><tr><th scope="col">Valid n</th><th scope="col">Minimum</th><th scope="col">Median</th><th scope="col">Mean</th><th scope="col">Maximum</th></tr></thead>
          <tbody><tr><td>{stats.n}</td><td>{formatNumber(stats.min)}</td><td>{formatNumber(stats.median)}</td><td>{formatNumber(stats.mean)}</td><td>{formatNumber(stats.max)}</td></tr></tbody>
        </table>
      </div>
    );
  }
  return (
    <dl className="analysis-stat-grid">
      <div><dt>Valid n</dt><dd>{stats.n}</dd></div>
      <div><dt>Minimum</dt><dd>{formatNumber(stats.min)}</dd></div>
      <div><dt>Median</dt><dd>{formatNumber(stats.median)}</dd></div>
      <div><dt>Mean</dt><dd>{formatNumber(stats.mean)}</dd></div>
      <div><dt>Maximum</dt><dd>{formatNumber(stats.max)}</dd></div>
    </dl>
  );
}

function QuestionAnalysis({ question, summary, display }: { question: Question; summary: QuestionSummary; display: Display }) {
  const hasDistribution = summary.distribution.length > 0;
  return (
    <article className="analysis-question">
      <div className="analysis-question-head">
        <div>
          <h3>{question.label}</h3>
          <div className="analysis-meta">
            <span className="code-chip">{question.id}</span>
            <span>{TYPE_LABELS[question.type]}</span>
            {question.required && <Badge kind="info" plain>Required</Badge>}
          </div>
        </div>
        <p className="analysis-response-count"><b>{summary.answeredCount}</b> of {summary.eligibleCount} answered</p>
      </div>

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

export function AnalyticsTab({ data }: { data: InterviewData }) {
  const [cohort, setCohort] = useState<Cohort>("everyone");
  const [display, setDisplay] = useState<Display>("chart");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<QuestionType | "all">("all");
  const cohortLabel = cohort === "submitted" ? "Submitted only" : "Everyone";
  const people = useMemo(() => selectedPeople(data.people, cohort), [data.people, cohort]);
  const questions = useMemo(() => {
    const normalizedSearch = search.trim().toLocaleLowerCase();
    return data.manifest.questions.filter((question) => {
      const matchesType = typeFilter === "all" || question.type === typeFilter;
      const matchesSearch = !normalizedSearch || `${question.id} ${question.label}`.toLocaleLowerCase().includes(normalizedSearch);
      return matchesType && matchesSearch;
    });
  }, [data.manifest.questions, search, typeFilter]);
  const summaries = useMemo(() => new Map(questions.map((question) => [question.id, summarizeQuestion(question, people)])), [questions, people]);
  const exportItems = useMemo(() => questions.map((question) => ({ question, summary: summaries.get(question.id)! })), [questions, summaries]);
  const csv = useMemo(() => buildAnalyticsCsv(exportItems, cohortLabel), [exportItems, cohortLabel]);
  const submitted = people.filter((person) => person.status === "submitted").length;
  const inProgress = people.filter((person) => person.status === "in_progress").length;

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
            <p>Descriptive summaries for the current survey version. Earlier wording is not separated from current wording.</p>
          </div>
          <Badge kind="info" plain>Version {data.interview.currentVersion}</Badge>
        </div>
        <p className="analysis-caveat">Everyone includes people who have not started. Each question shows answered and eligible counts; distribution percentages use valid answers. Checkbox percentages can total more than 100%. Free-text answers and notes are excluded.</p>
      </section>

      <div className="stats analysis-stats">
        <div className="stat"><b>{people.length}</b><span>{cohortLabel} in cohort</span></div>
        <div className="stat"><b>{submitted}</b><span>Submitted</span></div>
        <div className="stat"><b>{inProgress}</b><span>In progress</span></div>
        <div className="stat"><b>{questions.length}</b><span>Questions shown</span></div>
      </div>

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
          <div className="seg" role="group" aria-label="Response cohort">
            <button type="button" aria-pressed={cohort === "everyone"} onClick={() => setCohort("everyone")}>Everyone</button>
            <button type="button" aria-pressed={cohort === "submitted"} onClick={() => setCohort("submitted")}>Submitted only</button>
          </div>
          <div className="seg" role="group" aria-label="Display format">
            <button type="button" aria-pressed={display === "chart"} onClick={() => setDisplay("chart")}>Chart</button>
            <button type="button" aria-pressed={display === "table"} onClick={() => setDisplay("table")}>Table</button>
          </div>
          <div className="row wrap analysis-export-actions">
            <CopyButton className="btn sm" label="Copy CSV" done="Copied" getText={() => csv} disabled={!questions.length} />
            <button type="button" className="btn sm" onClick={downloadCsv} disabled={!questions.length}><Icon name="download" size={14} /> Download CSV</button>
          </div>
        </div>
      </section>

      <p className="muted analysis-result-count" aria-live="polite">Showing {questions.length} of {data.manifest.questions.length} questions · {people.length} {people.length === 1 ? "person" : "people"} in this cohort</p>
      {groups.length ? groups.map((group) => (
        <section key={group.id} className="stack" style={{ gap: 10 }}>
          <h2 className="section-title">{group.title}</h2>
          <div className="card analysis-question-list">
            {group.questions.map((question) => <QuestionAnalysis key={question.id} question={question} summary={summaries.get(question.id)!} display={display} />)}
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
