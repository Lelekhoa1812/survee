"use client";

import { useState } from "react";
import type { InterviewData } from "./interview-types";
import { PreviewFrame } from "./PreviewFrame";
import { Uploader, type UploadState } from "./Uploader";
import { api, Badge, Icon, Spinner, useToast } from "./ui";
import { fullTime } from "@/lib/time";

export function SurveyTab({ data, refresh }: { data: InterviewData; refresh: () => void }) {
  const toast = useToast();
  const [width, setWidth] = useState<0 | 390>(0);
  const [replacing, setReplacing] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ settled: false, ok: false });
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploaderKey, setUploaderKey] = useState(0);
  const current = data.versions.find((v) => v.version === data.interview.currentVersion);
  const compat = upload.report?.diagnostics.filter((d) => d.category === "compat") ?? [];
  const needsAck = compat.some((d) => d.severity === "warning");
  const canSave = upload.ok && upload.settled && (!needsAck || ack) && !busy;
  const answered = data.people.reduce((n, p) => n + p.answered, 0);

  async function save() {
    if (!upload.html) return;
    setBusy(true);
    const res = await api<{ version: number }>(`/api/admin/interviews/${data.interview.id}/versions`, { method: "POST", body: { html: upload.html, fileName: upload.fileName } });
    setBusy(false);
    if (res.ok) {
      toast(`Version ${res.data.version} is live for everyone.`);
      setReplacing(false); setAck(false); setUpload({ settled: false, ok: false }); setUploaderKey((k) => k + 1);
      refresh();
    } else toast(res.data.error ?? "Could not save the new version.", "err");
  }

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head">
          <h2>Current file</h2>
          <Badge kind="ok">Version {data.interview.currentVersion}</Badge>
          <span className="right" />
          {!replacing && <button className="btn sm" onClick={() => setReplacing(true)}><Icon name="upload" size={15} /> Upload a new version</button>}
        </div>
        <div className="card-pad row wrap" style={{ gap: 28 }}>
          <div><div className="muted" style={{ fontSize: 12.5 }}>File</div><div style={{ fontWeight: 600 }}>{current?.fileName ?? data.manifest.title}</div></div>
          <div><div className="muted" style={{ fontSize: 12.5 }}>Questions</div><div style={{ fontWeight: 600 }}>{data.manifest.questions.length}</div></div>
          <div><div className="muted" style={{ fontSize: 12.5 }}>Uploaded</div><div style={{ fontWeight: 600 }}>{fullTime(current?.createdAt)}</div></div>
          <div><div className="muted" style={{ fontSize: 12.5 }}>Checker</div><div style={{ fontWeight: 600 }}>{current ? `${current.check.errors} errors, ${current.check.warnings} warnings` : ""}</div></div>
        </div>
      </section>

      {replacing && (
        <section className="card">
          <div className="card-head"><h2>Upload a new version</h2><span className="right" /><button className="btn ghost sm" onClick={() => { setReplacing(false); setUpload({ settled: false, ok: false }); setUploaderKey((k) => k + 1); }}>Cancel</button></div>
          <div className="card-pad stack">
            <div className="callout"><Icon name="info" /><div>The new file replaces the current one for everybody straight away. Answers already saved stay safe, matched by question id{answered ? ` (${answered} answers so far)` : ""}. KQA tells you below if any would no longer fit.</div></div>
            <Uploader key={uploaderKey} interviewId={data.interview.id} onChange={setUpload} compact />
            {needsAck && upload.ok && (
              <label className="callout warn" style={{ cursor: "pointer", alignItems: "center" }}>
                <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                <span>I have read the compatibility warnings and still want to replace the current version.</span>
              </label>
            )}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button className="btn accent" disabled={!canSave} onClick={save}>{busy && <Spinner />} Make this the live version</button>
            </div>
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Preview</h2>
          <span className="sub">How people see it. Nothing you type here is saved.</span>
          <div className="seg right" role="group" aria-label="Preview size">
            <button aria-pressed={width === 0} onClick={() => setWidth(0)}>Desktop</button>
            <button aria-pressed={width === 390} onClick={() => setWidth(390)}>Phone</button>
          </div>
        </div>
        <div style={{ background: "var(--surface-3)", padding: width ? "16px 0" : 0 }}>
          <PreviewFrame key={data.interview.currentVersion} src={`/api/admin/frame?interview=${data.interview.id}&version=${data.interview.currentVersion}`} questions={data.manifest.questions} width={width || undefined} height={680} />
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Version history</h2></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Version</th><th>File</th><th>Questions</th><th>Uploaded</th><th>Checker</th><th /></tr></thead>
            <tbody>
              {data.versions.map((v) => (
                <tr key={v.version}>
                  <td><b>v{v.version}</b></td>
                  <td>{v.fileName ?? "Untitled"}</td>
                  <td>{v.questions}</td>
                  <td className="muted nowrap">{fullTime(v.createdAt)}</td>
                  <td className="muted">{v.check.errors} errors · {v.check.warnings} warnings</td>
                  <td>{v.version === data.interview.currentVersion ? <Badge kind="ok">Live</Badge> : <a className="btn sm" href={`/api/admin/frame?interview=${data.interview.id}&version=${v.version}`} target="_blank" rel="noreferrer">View</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
