"use client";

import { useMemo, useState } from "react";
import { displayValue, isAnswered } from "@/lib/format/answers";
import type { Question, RepeatField, RepeatRecordRow } from "@/lib/format/schema";
import type { InterviewData, PersonRow } from "./interview-types";
import { PreviewFrame } from "./PreviewFrame";
import { Badge, Icon, Modal } from "./ui";
import { fullTime } from "@/lib/time";
import { summarizeQuestion, type QuestionSummary } from "@/lib/analytics/summary";
import { describeNumericQuantiles, formatPercentage } from "@/lib/analytics/format";

const STATUS: Record<PersonRow["status"], { label: string; kind: "" | "info" | "ok" }> = { invited: { label: "Not started", kind: "" }, in_progress: { label: "In progress", kind: "info" }, submitted: { label: "Submitted", kind: "ok" } };

function Tally({ q, summary }: { q: Question; summary: QuestionSummary }) {
  if (!summary.distribution.length || !summary.distributionDenominator) return null;
  const max = Math.max(1, ...summary.distribution.map((r) => r.count));
  return (
    <div className="tally" role="group" aria-label={`Distribution among ${summary.distributionDenominator} valid responses`}>
      <p className="muted" style={{ fontSize: 12.5 }}>
        Counts and percentages among {summary.distributionDenominator} valid answers
        {q.type === "multi" ? "; each percentage is a share of respondents, so totals can exceed 100%." : "."}
      </p>
      {summary.distribution.map((r) => (
        <div key={r.value} className="tally-row">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
          <div className="bar" aria-hidden="true"><i style={{ width: `${(r.count / max) * 100}%` }} /></div>
          <span className="muted tally-value" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.count} <span>({formatPercentage(r.percent)})</span></span>
        </div>
      ))}
    </div>
  );
}

function fmtNumber(value: number) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(value);
}

function fmtScaleMedianRange(range: QuestionSummary["scaleMedianRange"]) {
  if (!range) return "—";
  return range.lower === range.upper
    ? fmtNumber(range.lower)
    : `${fmtNumber(range.lower)}–${fmtNumber(range.upper)}`;
}

function recordFieldText(field: RepeatField | undefined, value: string | number | undefined): string {
  if (value === undefined || value === null) return "";
  if (field && (field.type === "single" || field.type === "select") && typeof value === "string") {
    return field.options?.find((option) => option.value === value)?.label ?? value;
  }
  return String(value);
}

function RecordEntries({ fields, records }: { fields: RepeatField[]; records: RepeatRecordRow[] }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {records.map((record, index) => {
        const fieldById = new Map(fields.map((field) => [field.id, field]));
        const extraFieldIds = Object.keys(record.values).filter((fieldId) => !fieldById.has(fieldId)).sort();
        return (
          <div key={record.id} className="ans" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
            <div className="who" style={{ fontWeight: 600 }}>Entry {index + 1}<span className="code-chip" style={{ marginLeft: 8 }}>{record.id}</span></div>
            <div className="stack" style={{ gap: 6 }}>
              {[...fields.map((field) => field.id), ...extraFieldIds].map((fieldId) => {
                const field = fieldById.get(fieldId);
                const present = Object.prototype.hasOwnProperty.call(record.values, fieldId);
                const value = present ? recordFieldText(field, record.values[fieldId]) : "";
                return (
                  <div key={fieldId}>
                    <div className="who" style={{ fontWeight: 500, color: "var(--ink-2)" }}>{field?.label ?? fieldId}</div>
                    <div className="val">{present ? value : <span className="muted">No value saved</span>}</div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
      {records.length === 0 && <p className="muted" style={{ fontSize: 13.5 }}>No records saved.</p>}
    </div>
  );
}

export function AnswersTab({ data }: { data: InterviewData }) {
  const [view, setView] = useState<"question" | "person">(data.interview.mode === "multi" && data.people.length > 1 ? "question" : "person");
  const [only, setOnly] = useState<"all" | "submitted">("all");
  const [viewing, setViewing] = useState<PersonRow | null>(null);
  const people = useMemo(() => data.people.filter((p) => (only === "submitted" ? p.status === "submitted" : true)), [data.people, only]);
  const { questions, sections } = data.manifest;
  const anyAnswers = data.people.some((p) => p.answered > 0 || Object.values(p.answers).some((answer) => !!answer.note?.trim()) || Object.values(p.recordGroups ?? {}).some((records) => records.length > 0));
  const summaries = useMemo(() => new Map(questions.filter((q) => q.type !== "repeat").map((q) => [q.id, summarizeQuestion(q, people)])), [questions, people]);

  const groups = useMemo(() => {
    const out: { id: string; title: string; description?: string; qs: Question[] }[] = [];
    const known = new Set((sections ?? []).map((s) => s.id));
    for (const s of sections ?? []) out.push({ id: s.id, title: s.title, description: s.description, qs: questions.filter((q) => q.section === s.id) });
    const loose = questions.filter((q) => !q.section || !known.has(q.section));
    if (loose.length) out.push({ id: "_", title: sections?.length ? "Other questions" : "Questions", qs: loose });
    return out.filter((g) => g.qs.length);
  }, [questions, sections]);
  const currentRepeatIds = useMemo(() => new Set(questions.filter((q) => q.type === "repeat").map((q) => q.id)), [questions]);
  const retainedRepeatIds = useMemo(() => [...new Set(people.flatMap((p) => Object.entries(p.recordGroups ?? {})
    .filter(([questionId, records]) => records.length > 0 && !currentRepeatIds.has(questionId))
    .map(([questionId]) => questionId)))].sort(), [people, currentRepeatIds]);

  if (!anyAnswers) {
    return (
      <div className="card empty">
        <div className="ico"><Icon name="inbox" size={24} /></div>
        <h3>No answers yet</h3>
        <p>Answers appear here the moment someone saves them, so you can watch an interview fill in live.</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row wrap">
        <div className="seg" role="group" aria-label="Group answers">
          <button aria-pressed={view === "question"} onClick={() => setView("question")}>By question</button>
          <button aria-pressed={view === "person"} onClick={() => setView("person")}>By person</button>
        </div>
        <div className="seg" role="group" aria-label="Which people">
          <button aria-pressed={only === "all"} onClick={() => setOnly("all")}>Everyone</button>
          <button aria-pressed={only === "submitted"} onClick={() => setOnly("submitted")}>Submitted only</button>
        </div>
        <span className="muted right" style={{ fontSize: 13 }}>{people.length} {people.length === 1 ? "person" : "people"}</span>
      </div>

      {view === "question" ? (
        <>
        {groups.map((g) => (
          <section key={g.id} className="stack" style={{ gap: 10 }}>
            <div><div className="section-title" style={{ marginBottom: 2 }}>{g.title}</div>{g.description && <p className="muted" style={{ fontSize: 13.5 }}>{g.description}</p>}</div>
            <div className="card">
              {g.qs.map((q) => {
                if (q.type === "repeat") {
                  const rowCount = people.reduce((sum, p) => sum + (p.recordGroups?.[q.id]?.length ?? 0), 0);
                  return (
                    <div key={q.id} className="q-card">
                      <div>
                        <h4>{q.label}</h4>
                        <div className="meta"><span className="code-chip">{q.id}</span><span>Repeat group</span><span>{rowCount} {rowCount === 1 ? "record" : "records"}</span></div>
                        {q.help && <p className="muted" style={{ fontSize: 13.5 }}>{q.help}</p>}
                      </div>
                      <div className="stack" style={{ gap: 10 }}>
                        {people.map((p) => (
                          <div key={p.id} className="ans" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                            <div className="who">{p.name}{p.status !== "submitted" && <span className="muted" style={{ fontWeight: 400 }}> · draft</span>}</div>
                            <RecordEntries fields={q.fields ?? []} records={p.recordGroups?.[q.id] ?? []} />
                          </div>
                        ))}
                        {people.length === 0 && <p className="muted">No people in this view.</p>}
                      </div>
                    </div>
                  );
                }
                const summary = summaries.get(q.id)!;
                const answeredBy = people.filter((p) => isAnswered(q, p.answers));
                const noteOnly = people.filter((p) => !isAnswered(q, p.answers) && p.answers[q.id]?.note);
                const missing = people.length - answeredBy.length;
                return (
                  <div key={q.id} className="q-card">
                    <div>
                      <h4>{q.label}</h4>
                      <div className="meta"><span className="code-chip">{q.id}</span><span>{q.type}</span>{q.required && <Badge kind="info" plain>Required</Badge>}<span>{answeredBy.length} of {people.length} answered</span></div>
                    </div>
                    <Tally q={q} summary={summary} />
                    {summary.numeric && <p className="question-stats">Numeric summary for n={summary.numeric.n}: minimum {fmtNumber(summary.numeric.min)} · median {fmtNumber(summary.numeric.median)} · mean {fmtNumber(summary.numeric.mean)} · maximum {fmtNumber(summary.numeric.max)}. Descriptive only. {describeNumericQuantiles(summary.numeric)}</p>}
                    {summary.scaleMedianRange !== null && <p className="question-stats">{summary.scaleMedianRange.lower === summary.scaleMedianRange.upper ? "Median category" : "Median categories"}: {fmtScaleMedianRange(summary.scaleMedianRange)} · valid n={summary.distributionDenominator}. These are observed ordinal categories; codes are not averaged and no mean is calculated.</p>}
                    {summary.unmappedResponseCount > 0 && <p className="question-warning">{summary.unmappedResponseCount} stored {summary.unmappedResponseCount === 1 ? "answer does" : "answers do"} not match this survey version's options or range and {summary.unmappedResponseCount === 1 ? "is" : "are"} excluded from the summary.</p>}
                    <div className="stack" style={{ gap: 8 }}>
                      {[...answeredBy, ...noteOnly].map((p) => {
                        const a = p.answers[q.id];
                        return (
                          <div key={p.id} className="ans">
                            <div className="who">{p.name}{p.status !== "submitted" && <span className="muted" style={{ fontWeight: 400 }}> · draft</span>}</div>
                            <div>
                              {a?.value !== undefined && <div className="val">{displayValue(q, a.value)}</div>}
                              {a?.note && <div className="note">{a.note}</div>}
                            </div>
                          </div>
                        );
                      })}
                      {missing > 0 && answeredBy.length > 0 && <p className="muted" style={{ fontSize: 13 }}>{missing} {missing === 1 ? "person has" : "people have"} not answered this yet.</p>}
                      {answeredBy.length === 0 && noteOnly.length === 0 && <p className="muted" style={{ fontSize: 13.5 }}>No answers yet.</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
        {retainedRepeatIds.length > 0 && (
          <section className="stack" style={{ gap: 10 }}>
            <div className="section-title" style={{ marginBottom: 2 }}>Retained records from earlier questionnaire versions</div>
            <div className="card">
              {retainedRepeatIds.map((questionId) => (
                <div key={questionId} className="q-card">
                  <div><h4>Retained repeat group</h4><div className="meta"><span className="code-chip">{questionId}</span></div></div>
                  <div className="stack" style={{ gap: 10 }}>
                    {people.map((p) => {
                      const records = p.recordGroups?.[questionId] ?? [];
                      if (!records.length) return null;
                      return <div key={p.id} className="ans" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}><div className="who">{p.name}{p.status !== "submitted" && <span className="muted" style={{ fontWeight: 400 }}> · draft</span>}</div><RecordEntries fields={[]} records={records} /></div>;
                    })}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}
        </>
      ) : (
        <div className="card">
          {people.length === 0 && <div className="card-pad muted">Nobody has submitted yet.</div>}
          {people.map((p, idx) => {
            const s = STATUS[p.status];
            const pct = p.total ? Math.round((p.answered / p.total) * 100) : 0;
            return (
              <details key={p.id} className="person-card" open={people.length === 1 || (idx === 0 && people.length < 3)}>
                <summary>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    {p.note && <div className="muted" style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.note}</div>}
                  </div>
                  <div><Badge kind={s.kind}>{s.label}</Badge></div>
                  <div style={{ display: "grid", gap: 4 }}><div className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div><span className="muted" style={{ fontSize: 12.5 }}>{p.answered} of {p.total}</span></div>
                  <Icon name="chevron" size={16} className="muted" />
                </summary>
                <div className="body">
                  {(p.questionOrderAssignments ?? []).filter((assignment) => assignment.surveyVersion === data.interview.currentVersion).map((assignment) => (
                    <section key={`${p.id}-${assignment.surveyVersion}`} className="card-pad" aria-label="Assigned question order" style={{ border: "1px solid var(--line)", borderRadius: 10, marginBottom: 10 }}>
                      <div className="who" style={{ marginBottom: 6 }}>Assigned question order · survey v{assignment.surveyVersion}</div>
                      <p className="muted" style={{ fontSize: 12.5, margin: "0 0 8px" }}>Assignment records the order delivered by survee; it does not confirm that every question was viewed.</p>
                      {Object.entries(assignment.groups).map(([groupId, ids]) => (
                        <div key={groupId} className="val" style={{ marginTop: 4 }}>
                          <span className="code-chip">{groupId}</span>{" "}
                          {ids.map((id) => data.manifest.questions.find((question) => question.id === id)?.label ?? id).join(" → ")}
                        </div>
                      ))}
                    </section>
                  ))}
                  <div className="row wrap" style={{ marginBottom: 4 }}>
                    <span className="muted" style={{ fontSize: 13 }}>{p.submittedAt ? `Submitted ${fullTime(p.submittedAt)}` : p.lastSavedAt ? `Last saved ${fullTime(p.lastSavedAt)}` : "Nothing saved yet"}</span>
                    <button className="btn sm right" onClick={() => setViewing(p)}>View in the original layout</button>
                  </div>
                  {questions.map((q) => {
                    if (q.type === "repeat") {
                      return (
                        <div key={q.id} className="ans" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                          <div className="who" style={{ fontWeight: 500, color: "var(--ink-2)" }}>{q.label}<span className="code-chip" style={{ marginLeft: 8 }}>{q.id}</span></div>
                          <RecordEntries fields={q.fields ?? []} records={p.recordGroups?.[q.id] ?? []} />
                        </div>
                      );
                    }
                    const a = p.answers[q.id];
                    const has = isAnswered(q, p.answers);
                    if (!has && !a?.note) return null;
                    return (
                      <div key={q.id} className="ans" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                        <div className="who" style={{ fontWeight: 500, color: "var(--ink-2)" }}>{q.label}</div>
                        <div>
                          {has && <div className="val" style={{ fontWeight: 500 }}>{displayValue(q, a?.value)}</div>}
                          {a?.note && <div className="note">{a.note}</div>}
                        </div>
                      </div>
                    );
                  })}
                  {retainedRepeatIds.map((questionId) => (
                    <div key={questionId} className="ans" style={{ gridTemplateColumns: "minmax(0, 1fr)" }}>
                      <div className="who" style={{ fontWeight: 500, color: "var(--ink-2)" }}>Retained repeat group <span className="code-chip" style={{ marginLeft: 8 }}>{questionId}</span></div>
                      <RecordEntries fields={[]} records={p.recordGroups?.[questionId] ?? []} />
                    </div>
                  ))}
                  {p.answered < p.total && <p className="muted" style={{ fontSize: 13 }}>{p.total - p.answered} {p.total - p.answered === 1 ? "question" : "questions"} not answered.</p>}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {viewing && (
        <Modal title={`${viewing.name}'s answers`} onClose={() => setViewing(null)} className="answers-modal" style={{ width: "min(1000px, 100%)", padding: 0, gap: 0 }}>
          <div className="card-head"><span className="sub">Read only</span><button className="btn ghost sm icon right" onClick={() => setViewing(null)} aria-label="Close"><Icon name="x" size={16} /></button></div>
          <PreviewFrame src={`/api/admin/frame?interview=${data.interview.id}&version=${data.interview.currentVersion}`} questions={questions} answers={viewing.answers} locked name={viewing.name} height={Math.round(typeof window === "undefined" ? 640 : window.innerHeight * 0.72)} />
        </Modal>
      )}
    </div>
  );
}
