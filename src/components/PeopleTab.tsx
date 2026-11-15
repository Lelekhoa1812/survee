"use client";

import { useState } from "react";
import { parseEmail, parsePersonLine } from "@/lib/mail/address";
import type { InterviewData, PersonRow } from "./interview-types";
import { InviteActions } from "./InviteActions";
import { api, Badge, CopyButton, Icon, Modal, Spinner, useToast } from "./ui";
import { fullTime, relTime } from "@/lib/time";

const STATUS: Record<PersonRow["status"], { label: string; kind: "" | "info" | "ok" }> = { invited: { label: "Not started", kind: "" }, in_progress: { label: "In progress", kind: "info" }, submitted: { label: "Submitted", kind: "ok" } };

export function PeopleTab({ data, origin, refresh }: { data: InterviewData; origin: string; refresh: () => void }) {
  const toast = useToast();
  const multi = data.interview.mode === "multi";
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonRow | null>(null);
  const [removing, setRemoving] = useState<PersonRow | null>(null);
  const [working, setWorking] = useState<string>("");

  async function act(p: PersonRow, action: "reopen" | "token") {
    setWorking(p.id + action);
    const res = await api(`/api/admin/people/${p.id}/${action}`, { method: "POST", body: {} });
    setWorking("");
    if (res.ok) { toast(action === "reopen" ? `${p.name} can edit again.` : "New link created. The old one no longer works. Send the new link if you already emailed it."); refresh(); }
    else toast(res.data.error ?? "That did not work.", "err");
  }

  return (
    <div className="stack">
      <div className="row wrap">
        <p className="muted" style={{ flex: 1, minWidth: 240 }}>
          {multi ? "Each person has their own private link. Add an email to send it, or copy the link." : "This interview has one link. Add their name and, if you have it, an email so you can send the link."}
        </p>
        {multi && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add people</button>}
      </div>

      {data.people.length === 0 ? (
        <div className="card empty">
          <div className="ico"><Icon name="users" size={24} /></div>
          <h3>No people yet</h3>
          <p>Add each person who will answer. KQA creates a private link, and you can email it from here or copy it.</p>
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add people</button>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="t cards people-list">
            <caption className="sr">Respondent status, invitation delivery, and actions</caption>
            <thead><tr><th>Person</th><th>Status and progress</th><th>Invitation and delivery</th><th><span className="sr">Actions</span></th></tr></thead>
            <tbody>
              {data.people.map((p) => {
                const s = STATUS[p.status];
                const pct = p.total ? Math.round((p.answered / p.total) * 100) : 0;
                const respondentLink = origin ? `${origin}/${p.token}` : "";
                return (
                  <tr key={p.id}>
                    <td className="c-main person-cell">
                      <div className="person-name">{p.name}</div>
                      <div className="person-contact">
                        {p.email ? <span>{p.email}</span> : <span className="muted">No email</span>}
                        {p.note && <span className="muted person-note">{p.note}</span>}
                      </div>
                    </td>
                    <td className="person-state-cell" data-label="Interview progress">
                      <div className="person-status-summary">
                        <Badge kind={s.kind}>{s.label}</Badge>
                        <span>{p.answered} of {p.total} answered</span>
                      </div>
                      <div className="person-progress-bar"><div className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div><span>{pct}%</span></div>
                      {p.status !== "submitted" && p.requiredMissing > 0 && <p className="person-required-left">{p.requiredMissing} required {p.requiredMissing === 1 ? "answer" : "answers"} left</p>}
                      <p className="person-last-saved" title={p.lastSavedAt ? fullTime(p.lastSavedAt) : undefined}>{p.lastSavedAt ? `Last saved ${relTime(p.lastSavedAt)}` : "No answers saved yet"}</p>
                    </td>
                    <td className="c-wide person-invite-cell" data-label="Invitation and delivery">
                      <InviteActions person={p} interviewOpen={data.interview.status === "open"} publicOrigin={data.publicOrigin} refresh={refresh} />
                    </td>
                    <td className="c-actions person-actions-cell">
                      <details className="person-more-actions">
                        <summary className="btn sm" aria-label={`More actions for ${p.name}`}>More actions <Icon className="person-more-chevron" name="chevron" size={14} /></summary>
                        <div className="person-action-menu" role="group" aria-label={`Actions for ${p.name}`}>
                          <CopyButton className="btn sm" label="Copy private link" done="Copied" ariaLabel={`Copy ${p.name}'s link`} getText={() => respondentLink || `${window.location.origin}/${p.token}`} />
                          <a className="btn sm" href={`/${p.token}`} target="_blank" rel="noreferrer"><Icon name="external" size={14} /> Open as respondent</a>
                        {p.status === "submitted" ? (
                          <button className="btn sm" type="button" disabled={working === p.id + "reopen"} onClick={() => act(p, "reopen")} title="Let them change their answers">
                            {working === p.id + "reopen" ? <Spinner /> : <Icon name="lock" size={14} />} Reopen answers
                          </button>
                        ) : null}
                          <button className="btn sm" type="button" onClick={() => setEditing(p)}><Icon name="edit" size={14} /> Edit person</button>
                          <div className="person-action-item">
                            <button className="btn sm" type="button" disabled={working === p.id + "token"} onClick={() => act(p, "token")}>{working === p.id + "token" ? <Spinner /> : <Icon name="refresh" size={14} />} Replace private link</button>
                            <span className="hint">The old link stops working.</span>
                          </div>
                          {multi && <button className="btn sm danger" type="button" onClick={() => setRemoving(p)}><Icon name="trash" size={14} /> Remove person</button>}
                        </div>
                      </details>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && <AddPeople interviewId={data.interview.id} onClose={() => setAdding(false)} onDone={() => { setAdding(false); refresh(); }} />}
      {editing && <EditPerson person={editing} onClose={() => setEditing(null)} onDone={() => { setEditing(null); refresh(); }} />}
      {removing && (
        <Modal title={`Remove ${removing.name}?`} onClose={() => setRemoving(null)} actions={<>
          <button className="btn" onClick={() => setRemoving(null)}>Keep</button>
          <button className="btn danger solid" onClick={async () => { const res = await api(`/api/admin/people/${removing.id}`, { method: "DELETE" }); if (res.ok) { toast("Removed"); setRemoving(null); refresh(); } else toast(res.data.error ?? "Could not remove.", "err"); }}>Remove and delete answers</button>
        </>}>
          <p className="muted">Their link stops working and the {removing.answered} {removing.answered === 1 ? "answer" : "answers"} they gave are deleted. Export first if you need a copy.</p>
        </Modal>
      )}
    </div>
  );
}

function AddPeople({ interviewId, onClose, onDone }: { interviewId: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const blank = () => ({ name: "", email: "", note: "" });
  const [rows, setRows] = useState([blank(), blank()]);
  const [busy, setBusy] = useState(false);
  const parsed = rows.map((r) => ({ ...r, emailResult: r.email.trim() ? parseEmail(r.email) : { ok: true as const, email: null } }));
  const filled = parsed.filter((r) => r.name.trim());
  const invalid = filled.some((r) => !r.emailResult.ok);
  const set = (i: number, k: "name" | "email" | "note", v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  function onPaste(i: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!/\n/.test(text.trim())) return;
    e.preventDefault();
    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 100);
    const next = lines.map((line) => {
      const parsedLine = parsePersonLine(line);
      if (!parsedLine.ok) return { name: parsedLine.name || line, email: parsedLine.emailRaw, note: "" };
      if (!parsedLine.person) return { name: "", email: "", note: "" };
      return { name: parsedLine.person.name, email: parsedLine.person.email ?? "", note: "" };
    });
    setRows((r) => [...r.slice(0, i), ...next.filter((row) => row.name || row.email), ...r.slice(i + 1).filter((x) => x.name || x.email || x.note)]);
  }

  async function save() {
    if (invalid || filled.length === 0) return;
    setBusy(true);
    const people = filled.map((r) => ({ name: r.name.trim(), email: r.emailResult.ok ? r.emailResult.email ?? undefined : undefined, note: r.note.trim() || undefined }));
    const res = await api(`/api/admin/interviews/${interviewId}/people`, { method: "POST", body: { people } });
    setBusy(false);
    if (res.ok) { toast(`${filled.length} ${filled.length === 1 ? "person" : "people"} added. Their links are ready.`); onDone(); }
    else toast(res.data.error ?? "Could not add them.", "err");
  }

  return (
    <Modal title="Add people" onClose={onClose} actions={<><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" disabled={busy || filled.length === 0 || invalid} onClick={() => void save()}>{busy && <Spinner />} {filled.length === 0 ? "Add people" : <>Add {filled.length} {filled.length === 1 ? "person" : "people"} and create {filled.length === 1 ? "a link" : "links"}</>}</button></>}>
      <p className="muted" style={{ marginTop: -6 }}>A name is enough. Email is optional. Paste one person per line: a name, Name, email, or Name &lt;email&gt;.</p>
      <div className="stack" style={{ gap: 10 }}>
        {parsed.map((r, i) => (
          <div key={i} className="stack" style={{ gap: 4 }}>
            <div className={`person-grid${i === 0 ? "" : " continued"}`}>
              <label className="label" htmlFor={`add-name-${i}`}>Name</label>
              <label className="label" htmlFor={`add-email-${i}`}>Email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
              <input id={`add-name-${i}`} className="input" aria-label={`Name ${i + 1}`} value={r.name} maxLength={120} onChange={(e) => set(i, "name", e.target.value)} onPaste={(e) => onPaste(i, e)} />
              <input id={`add-email-${i}`} className={`input${!r.emailResult.ok ? " error" : ""}`} type="text" inputMode="email" autoComplete="off" aria-label={`Email ${i + 1}, optional`} aria-invalid={!r.emailResult.ok} aria-describedby={!r.emailResult.ok ? `add-email-${i}-error` : undefined} value={r.email} maxLength={254} onChange={(e) => set(i, "email", e.target.value)} />
            </div>
            {!r.emailResult.ok ? <span id={`add-email-${i}-error`} className="field-error">{r.emailResult.error}</span> : null}
            <input className="input" aria-label={`Note ${i + 1}, optional`} placeholder="Note (optional)" value={r.note} maxLength={1000} onChange={(e) => set(i, "note", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && i === rows.length - 1) { e.preventDefault(); setRows((x) => [...x, blank()]); } }} />
          </div>
        ))}
        <button className="btn ghost sm" type="button" style={{ justifySelf: "start" }} onClick={() => setRows((x) => [...x, blank()])}><Icon name="plus" size={15} /> Add another</button>
      </div>
    </Modal>
  );
}

function EditPerson({ person, onClose, onDone }: { person: PersonRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(person.name);
  const [email, setEmail] = useState(person.email ?? "");
  const [note, setNote] = useState(person.note ?? "");
  const [busy, setBusy] = useState(false);
  const parsed = parseEmail(email);
  async function save() {
    if (!parsed.ok) return;
    setBusy(true);
    const res = await api(`/api/admin/people/${person.id}`, { method: "PATCH", body: { name, email, note } });
    setBusy(false);
    if (res.ok) { toast("Saved"); onDone(); } else toast(res.data.error ?? "Could not save.", "err");
  }
  return (
    <Modal title="Edit person" onClose={onClose} actions={<><button className="btn" type="button" onClick={onClose}>Cancel</button><button className="btn primary" type="button" disabled={busy || !name.trim() || !parsed.ok} onClick={() => void save()}>{busy && <Spinner />} Save</button></>}>
      <div className="field"><label htmlFor="pn">Name</label><input id="pn" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field">
        <label htmlFor="pe">Email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
        <input id="pe" className={`input${!parsed.ok ? " error" : ""}`} type="text" inputMode="email" autoComplete="off" spellCheck={false} value={email} maxLength={254} aria-invalid={!parsed.ok} aria-describedby="pe-note" onChange={(e) => setEmail(e.target.value)} onBlur={() => { if (parsed.ok) setEmail(parsed.email ?? ""); }} />
        {!parsed.ok ? <span id="pe-note" className="field-error">{parsed.error}</span> : <span id="pe-note" className="hint">Leave blank if you will copy the link. Changing it means the last email no longer counts as sent.</span>}
      </div>
      <div className="field"><label htmlFor="pt">Note</label><textarea id="pt" className="textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /><span className="hint">Only you see this.</span></div>
    </Modal>
  );
}
