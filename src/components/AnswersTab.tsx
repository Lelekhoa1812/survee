"use client";

import { useMemo, useState } from "react";
import { displayValue, isAnswered } from "@/lib/format/answers";
import type { Question } from "@/lib/format/schema";
import type { InterviewData, PersonRow } from "./interview-types";
import { PreviewFrame } from "./PreviewFrame";
import { Badge, Icon } from "./ui";
import { fullTime } from "@/lib/time";

const STATUS: Record<PersonRow["status"], { label: string; kind: "" | "info" | "ok" }> = { invited: { label: "Not started", kind: "" }, in_progress: { label: "In progress", kind: "info" }, submitted: { label: "Submitted", kind: "ok" } };

function Tally({ q, people }: { q: Question; people: PersonRow[] }) {
  const counts = new Map<string, number>();
  let answered = 0;
  for (const p of people) {
    const v = p.answers[q.id]?.value;
    if (v === undefined || v === null) continue;
    answered++;
    for (const x of Array.isArray(v) ? v : [v]) counts.set(String(x), (counts.get(String(x)) ?? 0) + 1);
  }
  if (!answered) return null;
  let rows: { key: string; label: string; n: number }[] = [];
  if (q.options) rows = q.options.map((o) => ({ key: o.value, label: o.label, n: counts.get(o.value) ?? 0 }));
  else if (q.type === "scale") {
    const lo = q.min ?? 1, hi = q.max ?? 5;
    for (let i = lo; i <= hi; i++) rows.push({ key: String(i), label: String(i), n: counts.get(String(i)) ?? 0 });
  } else return null;
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <div className="tally" aria-label="Answer counts">
      {rows.map((r) => (
        <div key={r.key} className="tally-row">
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.label}>{r.label}</span>
          <div className="bar" aria-hidden="true"><i style={{ width: `${(r.n / max) * 100}%` }} /></div>
          <span className="muted" style={{ textAlign: "right", fontVariantNumeric: "tabular-nums" }}>{r.n}</span>
        </div>
      ))}
    </div>
  );
}

export function AnswersTab({ data }: { data: InterviewData }) {
  const [view, setView] = useState<"question" | "person">(data.interview.mode === "multi" && data.people.length > 1 ? "question" : "person");
  const [only, setOnly] = useState<"all" | "submitted">("all");
  const [viewing, setViewing] = useState<PersonRow | null>(null);
  const people = useMemo(() => data.people.filter((p) => (only === "submitted" ? p.status === "submitted" : true)), [data.people, only]);
  const { questions, sections } = data.manifest;
  const anyAnswers = data.people.some((p) => p.answered > 0);

  const groups = useMemo(() => {
    const out: { id: string; title: string; description?: string; qs: Question[] }[] = [];
    const known = new Set((sections ?? []).map((s) => s.id));
    for (const s of sections ?? []) out.push({ id: s.id, title: s.title, description: s.description, qs: questions.filter((q) => q.section === s.id) });
    const loose = questions.filter((q) => !q.section || !known.has(q.section));
    if (loose.length) out.push({ id: "_", title: sections?.length ? "Other questions" : "Questions", qs: loose });
    return out.filter((g) => g.qs.length);
  }, [questions, sections]);

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
        groups.map((g) => (
          <section key={g.id} className="stack" style={{ gap: 10 }}>
            <div><div className="section-title" style={{ marginBottom: 2 }}>{g.title}</div>{g.description && <p className="muted" style={{ fontSize: 13.5 }}>{g.description}</p>}</div>
            <div className="card">
              {g.qs.map((q) => {
                const answeredBy = people.filter((p) => isAnswered(q, p.answers));
                const noteOnly = people.filter((p) => !isAnswered(q, p.answers) && p.answers[q.id]?.note);
                const missing = people.length - answeredBy.length;
                const nums = q.type === "number" ? answeredBy.map((p) => Number(p.answers[q.id]?.value)).filter((n) => Number.isFinite(n)) : [];
                return (
                  <div key={q.id} className="q-card">
                    <div>
                      <h4>{q.label}</h4>
                      <div className="meta"><span className="code-chip">{q.id}</span><span>{q.type}</span>{q.required && <Badge kind="info" plain>Required</Badge>}<span>{answeredBy.length} of {people.length} answered</span></div>
                    </div>
                    <Tally q={q} people={people} />
                    {nums.length > 1 && <p className="muted" style={{ fontSize: 13.5 }}>Lowest {Math.min(...nums)} · highest {Math.max(...nums)} · average {(nums.reduce((a, b) => a + b, 0) / nums.length).toFixed(1)}</p>}
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
        ))
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
                  <div className="row wrap" style={{ marginBottom: 4 }}>
                    <span className="muted" style={{ fontSize: 13 }}>{p.submittedAt ? `Submitted ${fullTime(p.submittedAt)}` : p.lastSavedAt ? `Last saved ${fullTime(p.lastSavedAt)}` : "Nothing saved yet"}</span>
                    <button className="btn sm right" onClick={() => setViewing(p)}>View in the original layout</button>
                  </div>
                  {questions.map((q) => {
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
                  {p.answered < p.total && <p className="muted" style={{ fontSize: 13 }}>{p.total - p.answered} {p.total - p.answered === 1 ? "question" : "questions"} not answered.</p>}
                </div>
              </details>
            );
          })}
        </div>
      )}

      {viewing && (
        <div className="scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) setViewing(null); }}>
          <div className="modal" style={{ width: "min(1000px, 100%)", padding: 0, gap: 0 }} role="dialog" aria-modal="true" aria-label={`${viewing.name}'s answers`}>
            <div className="card-head"><h2>{viewing.name}</h2><span className="sub">Read only</span><button className="btn ghost sm icon right" onClick={() => setViewing(null)} aria-label="Close"><Icon name="x" size={16} /></button></div>
            <PreviewFrame src={`/api/admin/frame?interview=${data.interview.id}&version=${data.interview.currentVersion}`} questions={questions} answers={viewing.answers} locked name={viewing.name} height={Math.round(typeof window === "undefined" ? 640 : window.innerHeight * 0.72)} />
          </div>
        </div>
      )}
    </div>
  );
}
