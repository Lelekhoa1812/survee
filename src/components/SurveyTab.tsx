"use client";

import { useCallback, useRef, useState } from "react";
import type { Diagnostic } from "@/lib/diagnostics/types";
import type { Question, Section } from "@/lib/format/schema";
import type { InterviewData } from "./interview-types";
import { PreviewFrame } from "./PreviewFrame";
import { Uploader, type UploadState } from "./Uploader";
import { api, Badge, Icon, Spinner, useToast } from "./ui";
import { fullTime } from "@/lib/time";

interface CandidatePreview {
  ok: true;
  staticValid: true;
  interviewId: string;
  currentVersion: number;
  baseHash: string;
  candidateHash: string;
  compatibilityHash: string;
  compatibilityImpact: boolean;
  previewToken: string;
  previewExpiresAt: string;
  diagnostics: Diagnostic[];
  counts: { error: number; warning: number; info: number };
  report: string;
  changes: {
    questionCountBefore: number;
    questionCountAfter: number;
    questionsBefore: Question[];
    questionsAfter: Question[];
    sectionsBefore: Section[];
    sectionsAfter: Section[];
  };
}
const QUESTION_FIELDS: (keyof Question)[] = ["label", "type", "required", "section", "options", "min", "max", "step", "help", "note", "maxLength", "custom"];
const FIELD_LABELS: Partial<Record<keyof Question, string>> = {
  label: "wording", type: "response type", required: "required status", section: "section",
  options: "response options", min: "minimum", max: "maximum", step: "step", help: "help text",
  note: "note field", maxLength: "text length", custom: "custom response behavior",
};

function sectionSummary(sections: Section[]) {
  return sections.length
    ? sections.map((section) => `${section.title} (${section.id})${section.description ? ` — ${section.description}` : ""}`).join("; ")
    : "none";
}

function summarizeChanges(before: Question[], after: Question[]) {
  const beforeById = new Map(before.map((question) => [question.id, question]));
  const afterById = new Map(after.map((question) => [question.id, question]));
  const added = after.filter((question) => !beforeById.has(question.id));
  const removed = before.filter((question) => !afterById.has(question.id));
  const updated = after.flatMap((question) => {
    const previous = beforeById.get(question.id);
    if (!previous) return [];
    const fields = QUESTION_FIELDS.filter((field) => JSON.stringify(previous[field] ?? null) !== JSON.stringify(question[field] ?? null));
    return fields.length ? [{ question, fields: fields.map((field) => FIELD_LABELS[field] ?? String(field)) }] : [];
  });
  return { added, removed, updated };
}

export function SurveyTab({ data, refresh }: { data: InterviewData; refresh: () => void }) {
  const toast = useToast();
  const [width, setWidth] = useState<0 | 390>(0);
  const [replacing, setReplacing] = useState(false);
  const [upload, setUpload] = useState<UploadState>({ settled: false, ok: false });
  const [preview, setPreview] = useState<CandidatePreview | null>(null);
  const [ackCompatibility, setAckCompatibility] = useState(false);
  const [reviewedCandidate, setReviewedCandidate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uploaderKey, setUploaderKey] = useState(0);
  const uploadRevision = useRef(0);
  const current = data.versions.find((v) => v.version === data.interview.currentVersion);
  const answered = data.people.reduce((n, p) => n + p.answered, 0);
  const endpoint = `/api/admin/interviews/${data.interview.id}/versions`;
  const compatibilityFindings = preview?.diagnostics.filter((diagnostic) => diagnostic.category === "compat") ?? [];
  const changes = preview ? summarizeChanges(preview.changes.questionsBefore, preview.changes.questionsAfter) : null;
  const sectionsChanged = !!preview && JSON.stringify(preview.changes.sectionsBefore) !== JSON.stringify(preview.changes.sectionsAfter);
  const canPreview = upload.ok && upload.settled && !busy;
  const canPublish = !!preview && reviewedCandidate && (!preview.compatibilityImpact || ackCompatibility) && !busy;

  const onUploadChange = useCallback((next: UploadState) => {
    uploadRevision.current += 1;
    setUpload(next);
    setPreview(null);
    setAckCompatibility(false);
    setReviewedCandidate(false);
  }, []);

  async function previewCandidate() {
    if (!upload.html || !canPreview) return;
    const revision = uploadRevision.current;
    const html = upload.html;
    const fileName = upload.fileName;
    setBusy(true);
    setPreview(null);
    setAckCompatibility(false);
    setReviewedCandidate(false);
    const res = await api<CandidatePreview>(endpoint, { method: "POST", body: { action: "preview", html, fileName } });
    setBusy(false);
    if (revision !== uploadRevision.current) return;
    if (!res.ok || !res.data.previewToken) {
      toast(res.data.error ?? "Could not prepare a safe preview. Check the file and try again.", "err");
      return;
    }
    setPreview(res.data);
  }

  async function publishCandidate() {
    if (!upload.html || !preview || !canPublish) return;
    const revision = uploadRevision.current;
    const html = upload.html;
    const fileName = upload.fileName;
    setBusy(true);
    const res = await api<{ version: number; code?: string }>(endpoint, {
      method: "POST",
      body: {
        action: "apply",
        html,
        fileName,
        expectedVersion: preview.currentVersion,
        baseHash: preview.baseHash,
        candidateHash: preview.candidateHash,
        compatibilityHash: preview.compatibilityHash,
        previewToken: preview.previewToken,
        acknowledgeCompatibilityImpact: ackCompatibility,
      },
    });
    setBusy(false);
    if (revision !== uploadRevision.current) return;
    if (res.ok) {
      toast(`Version ${res.data.version} is live for everyone.`);
      setReplacing(false);
      setPreview(null);
      setAckCompatibility(false);
      setReviewedCandidate(false);
      setUpload({ settled: false, ok: false });
      setUploaderKey((key) => key + 1);
      refresh();
    } else {
      if (["stale_preview", "preview_required", "preview_expired", "candidate_changed", "invalid_preview"].includes(res.data.code ?? "")) {
        setPreview(null);
        setAckCompatibility(false);
        setReviewedCandidate(false);
      }
      toast(res.data.error ?? "Could not publish the new version.", "err");
    }
  }

  function cancelReplacement() {
    uploadRevision.current += 1;
    setReplacing(false);
    setUpload({ settled: false, ok: false });
    setPreview(null);
    setAckCompatibility(false);
    setReviewedCandidate(false);
    setUploaderKey((key) => key + 1);
  }

  const previewSizeControls = (
    <div className="seg right" role="group" aria-label="Preview size">
      <button type="button" aria-pressed={width === 0} onClick={() => setWidth(0)}>Desktop</button>
      <button type="button" aria-pressed={width === 390} onClick={() => setWidth(390)}>Phone</button>
    </div>
  );

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head">
          <h2>Current file</h2>
          <Badge kind="ok">Version {data.interview.currentVersion}</Badge>
          <span className="right" />
          {!replacing && <button type="button" className="btn sm" onClick={() => setReplacing(true)}><Icon name="upload" size={15} /> Upload a new version</button>}
        </div>
        <div className="card-pad row wrap" style={{ gap: 28 }}>
          <div><div className="muted" style={{ fontSize: 12.5 }}>File</div><div style={{ fontWeight: 600 }}>{current?.fileName ?? data.manifest.title}</div></div>
          <div><div className="muted" style={{ fontSize: 12.5 }}>Questions</div><div style={{ fontWeight: 600 }}>{data.manifest.questions.length}</div></div>
          <div><div className="muted" style={{ fontSize: 12.5 }}>Uploaded</div><div style={{ fontWeight: 600 }}>{fullTime(current?.createdAt)}</div></div>
          <div><div className="muted" style={{ fontSize: 12.5 }}>Checker</div><div style={{ fontWeight: 600 }}>{current ? `${current.check.errors} errors, ${current.check.warnings} warnings` : ""}</div></div>
        </div>
      </section>

      {replacing && (
        <section className="card" aria-busy={busy}>
          <div className="card-head"><h2>Review a new version</h2><span className="right" /><button type="button" className="btn ghost sm" disabled={busy} onClick={cancelReplacement}>Cancel</button></div>
          <div className="card-pad stack">
            <div className="callout"><Icon name="info" /><div>The candidate is checked and previewed before it can go live. Publishing replaces the questionnaire for everyone; saved answers remain attached to matching question IDs{answered ? ` (${answered} answers so far)` : ""}.</div></div>
            <Uploader key={uploaderKey} interviewId={data.interview.id} onChange={onUploadChange} compact disabled={busy} />
            {!preview && (
              <div className="row" style={{ justifyContent: "flex-end" }}>
                <button type="button" className="btn accent" disabled={!canPreview} onClick={() => void previewCandidate()}>
                  {busy && <Spinner />} Preview candidate changes
                </button>
              </div>
            )}

            {preview && changes && upload.html && (
              <section className="candidate-review stack" aria-labelledby="candidate-review-title">
                <div className="candidate-review-head">
                  <div>
                    <h3 id="candidate-review-title">Candidate preview</h3>
                    <p className="muted" role="status">Version {preview.currentVersion + 1} after version {preview.currentVersion}. This signed preview expires {new Date(preview.previewExpiresAt).toLocaleTimeString()}.</p>
                  </div>
                  {previewSizeControls}
                </div>
                <div className="candidate-changes">
                  <h4>Question and section changes</h4>
                  {changes.added.length + changes.removed.length + changes.updated.length === 0 && !sectionsChanged ? (
                    <p className="muted">No question or section definitions changed. Review the rendered theme and layout below.</p>
                  ) : (
                    <ul>
                      {changes.added.map((question) => <li key={`added-${question.id}`}><strong>Added {question.id}:</strong> {question.label} <span className="muted">({question.type})</span></li>)}
                      {changes.removed.map((question) => <li key={`removed-${question.id}`}><strong>Removed {question.id}:</strong> {question.label}</li>)}
                      {changes.updated.map(({ question, fields }) => <li key={`updated-${question.id}`}><strong>Updated {question.id}:</strong> {question.label} <span className="muted">({fields.join(", ")})</span></li>)}
                      {sectionsChanged && <li><strong>Sections changed:</strong> before: {sectionSummary(preview.changes.sectionsBefore)}; after: {sectionSummary(preview.changes.sectionsAfter)}.</li>}
                    </ul>
                  )}
                  <p className="muted">{preview.changes.questionCountBefore} questions before · {preview.changes.questionCountAfter} after · {preview.counts.warning} checker warnings · {preview.counts.info} notes</p>
                </div>
                {compatibilityFindings.length > 0 && (
                  <div className="callout warn candidate-compatibility" role="alert">
                    <div>
                      <strong>Saved answers may no longer fit this version.</strong>
                      <ul>{compatibilityFindings.map((finding, index) => <li key={`${finding.code}-${finding.questionId ?? ""}-${index}`}><b>{finding.title}:</b> {finding.message}</li>)}</ul>
                    </div>
                  </div>
                )}
                <div className="candidate-frame">
                  <PreviewFrame html={upload.html} questions={preview.changes.questionsAfter} width={width || undefined} height={680} title="Candidate questionnaire preview" />
                </div>
                <label className="callout candidate-confirm" style={{ cursor: "pointer", alignItems: "center" }}>
                  <input type="checkbox" checked={reviewedCandidate} onChange={(event) => setReviewedCandidate(event.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                  <span>I reviewed the candidate preview and the question changes. I understand this version will be live for everyone.</span>
                </label>
                {preview.compatibilityImpact && (
                  <label className="callout warn candidate-confirm" style={{ cursor: "pointer", alignItems: "center" }}>
                    <input type="checkbox" checked={ackCompatibility} onChange={(event) => setAckCompatibility(event.target.checked)} style={{ width: 18, height: 18, accentColor: "var(--accent)" }} />
                    <span>I read the saved-answer compatibility warnings and accept this impact.</span>
                  </label>
                )}
                <div className="row wrap" style={{ justifyContent: "space-between" }}>
                  <button type="button" className="btn sm" disabled={busy} onClick={() => { setPreview(null); setAckCompatibility(false); setReviewedCandidate(false); }}>Preview again</button>
                  <button type="button" className="btn accent" disabled={!canPublish} onClick={() => void publishCandidate()}>
                    {busy && <Spinner />} Make this version live
                  </button>
                </div>
              </section>
            )}
          </div>
        </section>
      )}

      <section className="card">
        <div className="card-head">
          <h2>Current live preview</h2>
          <span className="sub">How respondents see it. Nothing you type here is saved.</span>
          {previewSizeControls}
        </div>
        <div style={{ background: "var(--surface-3)", padding: width ? "16px 0" : 0 }}>
          <PreviewFrame key={data.interview.currentVersion} src={`/api/admin/frame?interview=${data.interview.id}&version=${data.interview.currentVersion}`} questions={data.manifest.questions} width={width || undefined} height={680} title="Current live questionnaire preview" />
        </div>
      </section>

      <section className="card">
        <div className="card-head"><h2>Version history</h2></div>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th scope="col">Version</th><th scope="col">File</th><th scope="col">Questions</th><th scope="col">Uploaded</th><th scope="col">Checker</th><th scope="col">Status</th></tr></thead>
            <tbody>
              {data.versions.map((version) => (
                <tr key={version.version}>
                  <td><b>v{version.version}</b></td>
                  <td>{version.fileName ?? "Untitled"}</td>
                  <td>{version.questions}</td>
                  <td className="muted nowrap">{fullTime(version.createdAt)}</td>
                  <td className="muted">{version.check.errors} errors · {version.check.warnings} warnings</td>
                  <td>{version.version === data.interview.currentVersion ? <Badge kind="ok">Live</Badge> : <a className="btn sm" href={`/api/admin/frame?interview=${data.interview.id}&version=${version.version}`} target="_blank" rel="noreferrer">View</a>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
