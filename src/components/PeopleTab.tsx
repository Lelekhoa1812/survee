"use client";

import { useState } from "react";
import type { InterviewData, PersonRow } from "./interview-types";
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
    if (res.ok) { toast(action === "reopen" ? `${p.name} can edit again.` : "New link created. The old one no longer works."); refresh(); }
    else toast(res.data.error ?? "That did not work.", "err");
  }

  return (
    <div className="stack">
      <div className="row wrap">
        <p className="muted" style={{ flex: 1, minWidth: 240 }}>
          {multi ? "Each person has their own private link. Their answers are kept under their name." : "This interview has one link. Add a name so you recognise the answers."}
        </p>
        {multi && <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add people</button>}
      </div>

      {data.people.length === 0 ? (
        <div className="card empty">
          <div className="ico"><Icon name="users" size={24} /></div>
          <h3>No people yet</h3>
          <p>Add each person who will answer. KQA creates a private link for each one that you can copy and send however you like.</p>
          <button className="btn primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add people</button>
        </div>
      ) : (
        <div className="card table-wrap">
          <table className="t cards">
            <thead><tr><th>Name</th><th>Status</th><th>Progress</th><th>Last saved</th><th>Private link</th><th style={{ width: 1 }} /></tr></thead>
            <tbody>
              {data.people.map((p) => {
                const s = STATUS[p.status];
                const link = origin ? `${origin}/${p.token}` : "";
                const pct = p.total ? Math.round((p.answered / p.total) * 100) : 0;
                return (
                  <tr key={p.id}>
                    <td className="c-main">
                      <div style={{ fontWeight: 600 }}>{p.name}</div>
                      {p.note && <div className="muted" style={{ fontSize: 13, maxWidth: 260 }}>{p.note}</div>}
                    </td>
                    <td className="c-status"><Badge kind={s.kind}>{s.label}</Badge></td>
                    <td className="c-wide" data-label="Progress" style={{ minWidth: 150 }}>
                      <div style={{ display: "grid", gap: 5 }}>
                        <div className="bar" aria-hidden="true"><i style={{ width: `${pct}%` }} /></div>
                        <span className="muted" style={{ fontSize: 12.5 }}>{p.answered} of {p.total} answered{p.status !== "submitted" && p.requiredMissing ? ` · ${p.requiredMissing} required left` : ""}</span>
                      </div>
                    </td>
                    <td className="c-wide muted nowrap" data-label="Last saved" title={fullTime(p.lastSavedAt)}>{p.lastSavedAt ? relTime(p.lastSavedAt) : "Not yet"}</td>
                    <td className="c-wide" data-label="Private link">
                      <div className="link-cell">
                        <code title={link}>{link ? link.replace(/^https?:\/\//, "") : "…"}</code>
                        <CopyButton className="btn sm icon" label="" done="" getText={() => `${window.location.origin}/${p.token}`} />
                        <a className="btn sm icon" href={`/${p.token}`} target="_blank" rel="noreferrer" aria-label={`Open ${p.name}'s link`} title="Open as the respondent"><Icon name="external" size={15} /></a>
                      </div>
                    </td>
                    <td className="c-actions">
                      <div className="row-actions">
                        {p.status === "submitted" ? (
                          <button className="btn sm" disabled={working === p.id + "reopen"} onClick={() => act(p, "reopen")} title="Let them change their answers">
                            {working === p.id + "reopen" ? <Spinner /> : <Icon name="lock" size={14} />} Reopen
                          </button>
                        ) : <span />}
                        <button className="btn sm icon ghost" aria-label={`Edit ${p.name}`} title="Edit name and note" onClick={() => setEditing(p)}><Icon name="edit" size={15} /></button>
                        <button className="btn sm icon ghost" aria-label={`New link for ${p.name}`} title="Create a new link (the old one stops working)" disabled={working === p.id + "token"} onClick={() => act(p, "token")}><Icon name="refresh" size={15} /></button>
                        {multi ? <button className="btn sm icon ghost" aria-label={`Remove ${p.name}`} title="Remove" onClick={() => setRemoving(p)}><Icon name="trash" size={15} /></button> : <span />}
                      </div>
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
  const [rows, setRows] = useState([{ name: "", note: "" }, { name: "", note: "" }]);
  const [busy, setBusy] = useState(false);
  const filled = rows.filter((r) => r.name.trim());
  const set = (i: number, k: "name" | "note", v: string) => setRows((r) => r.map((x, j) => (j === i ? { ...x, [k]: v } : x)));

  function onPaste(i: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text");
    if (!/\n/.test(text.trim())) return;
    e.preventDefault();
    const names = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).slice(0, 100);
    setRows((r) => [...r.slice(0, i), ...names.map((name) => ({ name, note: "" })), ...r.slice(i + 1).filter((x) => x.name || x.note)]);
  }

  async function save() {
    setBusy(true);
    const res = await api(`/api/admin/interviews/${interviewId}/people`, { method: "POST", body: { people: filled } });
    setBusy(false);
    if (res.ok) { toast(`${filled.length} ${filled.length === 1 ? "person" : "people"} added. Their links are ready.`); onDone(); }
    else toast(res.data.error ?? "Could not add them.", "err");
  }

  return (
    <Modal title="Add people" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || filled.length === 0} onClick={save}>{busy && <Spinner />} Add {filled.length || ""} {filled.length === 1 ? "person" : "people"} and create {filled.length === 1 ? "link" : "links"}</button></>}>
      <p className="muted" style={{ marginTop: -6 }}>A name is all you need. Use the note to remember who they are, for example their role or company. Paste a list of names into the first box to add many at once.</p>
      <div className="stack" style={{ gap: 10 }}>
        {rows.map((r, i) => (
          <div key={i} className="row" style={{ alignItems: "stretch" }}>
            <input className="input" style={{ flex: 1.1 }} placeholder="Name" aria-label={`Name ${i + 1}`} value={r.name} maxLength={120} onChange={(e) => set(i, "name", e.target.value)} onPaste={(e) => onPaste(i, e)} />
            <input className="input" style={{ flex: 1.4 }} placeholder="Note (optional)" aria-label={`Note ${i + 1}`} value={r.note} maxLength={1000} onChange={(e) => set(i, "note", e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && i === rows.length - 1) { e.preventDefault(); setRows((x) => [...x, { name: "", note: "" }]); } }} />
          </div>
        ))}
        <button className="btn ghost sm" style={{ justifySelf: "start" }} onClick={() => setRows((x) => [...x, { name: "", note: "" }])}><Icon name="plus" size={15} /> Add another</button>
      </div>
    </Modal>
  );
}

function EditPerson({ person, onClose, onDone }: { person: PersonRow; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(person.name);
  const [note, setNote] = useState(person.note ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await api(`/api/admin/people/${person.id}`, { method: "PATCH", body: { name, note } });
    setBusy(false);
    if (res.ok) { toast("Saved"); onDone(); } else toast(res.data.error ?? "Could not save.", "err");
  }
  return (
    <Modal title="Edit person" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()} onClick={save}>{busy && <Spinner />} Save</button></>}>
      <div className="field"><label htmlFor="pn">Name</label><input id="pn" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label htmlFor="pt">Note</label><textarea id="pt" className="textarea" rows={3} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} /><span className="hint">Only you see this.</span></div>
    </Modal>
  );
}
