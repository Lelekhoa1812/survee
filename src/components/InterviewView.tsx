"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AnswersTab } from "./AnswersTab";
import { AnalyticsTab } from "./AnalyticsTab";
import { ExportTab } from "./ExportTab";
import { InviteActions, PersonEmailEditor } from "./InviteActions";
import type { InterviewData } from "./interview-types";
import { PeopleTab } from "./PeopleTab";
import { SurveyTab } from "./SurveyTab";
import { api, Badge, CopyButton, Icon, Modal, Spinner, useToast } from "./ui";
import { relTime } from "@/lib/time";

type Tab = "overview" | "people" | "answers" | "analysis" | "survey" | "export";

export function useOrigin(): string {
  const [o, setO] = useState("");
  useEffect(() => setO(window.location.origin), []);
  return o;
}

const EVENT_TEXT: Record<string, string> = { open: "opened their link", save: "saved answers", submit: "submitted", reopen: "was reopened by you", created: "Interview created", version: "New survey version uploaded", status: "Status changed", export: "Exported answers", invite: "was emailed their link", mcp: "was updated by an agent" };

export function InterviewView({ data, initialTab, analysisOnly }: { data: InterviewData; initialTab: string; analysisOnly: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const origin = useOrigin();
  const [tab, setTab] = useState<Tab>(initialTab as Tab);
  const { interview, people, versions, events } = data;
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const submitted = people.filter((p) => p.status === "submitted").length;
  const inProgress = people.filter((p) => p.status === "in_progress").length;
  const invited = people.filter((p) => p.status === "invited").length;
  const refresh = () => router.refresh();

  function select(t: Tab) {
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    if (t === "analysis" || analysisOnly) {
      router.push(`${url.pathname}${url.search}`);
      return;
    }
    setTab(t);
    window.history.replaceState(null, "", url);
  }

  async function toggleStatus() {
    setBusy(true);
    const next = interview.status === "open" ? "closed" : "open";
    const res = await api(`/api/admin/interviews/${interview.id}`, { method: "PATCH", body: { status: next } });
    setBusy(false);
    if (res.ok) { toast(next === "closed" ? "Interview closed. Links show a closed message." : "Interview reopened."); refresh(); }
    else toast(res.data.error ?? "Could not change the status.", "err");
  }

  const tabs: [Tab, string, number?][] = [["overview", "Overview"], ["people", interview.mode === "multi" ? "People" : "Respondent", interview.mode === "multi" ? people.length : undefined], ["answers", "Answers", submitted + inProgress || undefined], ["analysis", "Analysis"], ["survey", "Survey"], ["export", "Export"]];

  return (
    <main className="page">
      <Link href="/admin" className="crumb"><Icon name="arrowLeft" size={14} /> Interviews</Link>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <div className="eyebrow">
            <Badge plain>{interview.mode === "multi" ? "Multi-user" : "One person"}</Badge>
            {interview.status === "open" ? <Badge kind="ok">Open</Badge> : <Badge kind="warn">Closed</Badge>}
          </div>
          <h1>{interview.name}</h1>
          {interview.description && <p>{interview.description}</p>}
        </div>
        <div className="right row wrap">
          <button className="btn sm" onClick={() => setRenaming(true)}><Icon name="edit" size={15} /> Edit details</button>
          <button className="btn sm" onClick={toggleStatus} disabled={busy}>
            {busy ? <Spinner /> : <Icon name={interview.status === "open" ? "lock" : "refresh"} size={15} />}
            {interview.status === "open" ? "Close interview" : "Reopen interview"}
          </button>
        </div>
      </div>

      <div className="tabs" role="tablist" aria-label="Interview sections">
        {tabs.map(([k, label, n]) => (
          <button key={k} role="tab" className="tab" aria-selected={tab === k} onClick={() => select(k)}>
            {label}{n !== undefined && n > 0 ? <span className="count">{n}</span> : null}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="stack-lg">
          <div className="stats">
            <div className="stat"><b>{people.length}</b><span>{people.length === 1 ? "Person" : "People"}</span></div>
            <div className="stat"><b>{invited}</b><span>Not started</span></div>
            <div className="stat"><b>{inProgress}</b><span>In progress</span></div>
            <div className="stat"><b>{submitted}</b><span>Submitted</span></div>
          </div>

          {interview.mode === "single" && people[0] && (
            <section className="card">
              <div className="card-head"><h2>Respondent link</h2><span className="sub right">{people[0].status === "submitted" ? "Submitted" : people[0].status === "in_progress" ? "In progress" : "Not started"}</span></div>
              <div className="card-pad stack">
                <div className="row wrap">
                  <div className="link-cell" style={{ flex: 1, minWidth: 220 }}><code style={{ maxWidth: "100%", fontSize: 13.5, padding: "9px 12px" }}>{origin ? `${origin}/${people[0].token}` : "…"}</code></div>
                  <CopyButton className="btn primary" label="Copy link" ariaLabel={`Copy ${people[0].name}'s link`} getText={() => `${window.location.origin}/${people[0].token}`} />
                  <a className="btn" href={`/${people[0].token}`} target="_blank" rel="noreferrer"><Icon name="external" size={15} /> Open</a>
                </div>
                <p className="muted" style={{ fontSize: 13.5 }}>Anyone with this link can answer, so send it only to the person it is meant for. It works on a phone, saves as they go and they can come back to it later.</p>
                <PersonEmailEditor person={people[0]} refresh={refresh} />
                <InviteActions person={people[0]} interviewOpen={interview.status === "open"} publicOrigin={data.publicOrigin} refresh={refresh} />
                {data.publicOrigin && origin && data.publicOrigin !== origin ? <p className="invite-meta">The email uses {data.publicOrigin}, the public address of this app. Copy link uses the address you are looking at.</p> : null}
              </div>
            </section>
          )}

          {interview.mode === "multi" && people.length === 0 && (
            <div className="callout"><Icon name="info" /><div><b>Add the people who will answer.</b> Each person gets their own private link. <button className="btn sm" style={{ marginLeft: 8 }} onClick={() => select("people")}>Add people</button></div></div>
          )}

          <section className="card">
            <div className="card-head"><h2>Recent activity</h2></div>
            {events.length === 0 ? (
              <div className="card-pad muted">Nothing yet. Activity appears here when someone saves an answer or you email a link.</div>
            ) : (
              <div className="list">
                {events.map((e) => (
                  <div key={e.id} className="list-row" style={{ gridTemplateColumns: "1fr auto", padding: "11px 20px" }}>
                    <span>{e.person && ["open", "save", "submit", "reopen", "invite"].includes(e.type) ? <><b>{e.person}</b> {e.type === "invite" && e.meta?.result === "failed" ? "could not be emailed a link" : EVENT_TEXT[e.type]}</> : e.type === "mcp" ? <>An agent used {typeof e.meta?.tool === "string" ? e.meta.tool : "a tool"}</> : (EVENT_TEXT[e.type] ?? e.type)}{e.type === "version" && e.meta?.version ? ` (version ${String(e.meta.version)})` : ""}</span>
                    <span className="muted nowrap" style={{ fontSize: 13 }}>{relTime(e.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="card" style={{ borderColor: "var(--danger-line)" }}>
            <div className="card-head"><h2>Delete this interview</h2></div>
            <div className="card-pad row wrap">
              <p className="muted" style={{ flex: 1, minWidth: 240 }}>Removes the interview, every survey version, the people, their answers, and the invite history. Export first if you need a copy. This cannot be undone.</p>
              <button className="btn danger" onClick={() => setDeleting(true)}><Icon name="trash" size={15} /> Delete interview</button>
            </div>
          </section>
        </div>
      )}

      {tab === "people" && <PeopleTab data={data} origin={origin} refresh={refresh} />}
      {tab === "answers" && <AnswersTab data={data} />}
      {tab === "analysis" && <AnalyticsTab data={data} />}
      {tab === "survey" && <SurveyTab data={data} refresh={refresh} />}
      {tab === "export" && <ExportTab data={data} />}

      {renaming && <EditDetails data={data} onClose={() => setRenaming(false)} onSaved={() => { setRenaming(false); refresh(); }} />}
      {deleting && (
        <DeleteInterview
          name={interview.name}
          onClose={() => setDeleting(false)}
          onConfirm={async (confirmName) => {
            const res = await api(`/api/admin/interviews/${interview.id}`, { method: "DELETE", body: { confirmName } });
            if (res.ok) { toast("Interview deleted"); router.replace("/admin"); router.refresh(); }
            else toast(res.data.error ?? "Could not delete.", "err");
          }}
        />
      )}
      <span className="sr" aria-hidden="true">{versions.length}</span>
    </main>
  );
}

function EditDetails({ data, onClose, onSaved }: { data: InterviewData; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [name, setName] = useState(data.interview.name);
  const [description, setDescription] = useState(data.interview.description ?? "");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const res = await api(`/api/admin/interviews/${data.interview.id}`, { method: "PATCH", body: { name, description } });
    setBusy(false);
    if (res.ok) { toast("Saved"); onSaved(); } else toast(res.data.error ?? "Could not save.", "err");
  }
  return (
    <Modal title="Edit details" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy || !name.trim()} onClick={save}>{busy && <Spinner />} Save</button></>}>
      <div className="field"><label htmlFor="en">Name</label><input id="en" className="input" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></div>
      <div className="field"><label htmlFor="ed">Notes</label><textarea id="ed" className="textarea" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} /></div>
    </Modal>
  );
}

function DeleteInterview({ name, onClose, onConfirm }: { name: string; onClose: () => void; onConfirm: (name: string) => Promise<void> }) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  return (
    <Modal title="Delete this interview?" onClose={onClose} actions={<><button className="btn" onClick={onClose}>Keep it</button><button className="btn danger solid" disabled={typed !== name || busy} onClick={async () => { setBusy(true); await onConfirm(typed); setBusy(false); }}>{busy && <Spinner />} Delete for good</button></>}>
      <p className="muted">All answers are removed and links stop working. To confirm, type the interview name: <b style={{ color: "var(--ink)" }}>{name}</b></p>
      <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} aria-label="Type the interview name to confirm" autoComplete="off" />
    </Modal>
  );
}
