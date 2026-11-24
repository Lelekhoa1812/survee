"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Uploader, type UploadState } from "./Uploader";
import { BasicQuestionnaireBuilder } from "./BasicQuestionnaireBuilder";
import { api, Icon, Spinner, useToast } from "./ui";
import { clearClientOperationId, clientOperationId } from "@/lib/client-idempotency";

export function NewInterview() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [upload, setUpload] = useState<UploadState>({ settled: false, ok: false });
  const [busy, setBusy] = useState(false);
  const [building, setBuilding] = useState(false);
  const [generatedFile, setGeneratedFile] = useState<File>();
  const [restoreReady, setRestoreReady] = useState(false);
  const [recoveryPending, setRecoveryPending] = useState(false);
  const [draftRevision, setDraftRevision] = useState(0);
  const [draftStatus, setDraftStatus] = useState<"loading" | "saved" | "saving" | "conflict" | "error">("loading");
  const [draftUpdatedAt, setDraftUpdatedAt] = useState<string>();
  const revisionRef = useRef(0);
  const skipNextSave = useRef(false);
  const [resetKey, setResetKey] = useState(0);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const saveTimer = useRef<number | undefined>(undefined);
  const discarding = useRef(false);
  const completed = useRef(false);

  async function restoreDraft() {
    const res = await api<{ draft: null | { revision: number; name: string; description: string; mode: "single" | "multi"; html?: string; fileName?: string; updatedAt: string } }>("/api/admin/campaign-draft");
    if (!res.ok) {
      setDraftStatus("error");
      return;
    } else if (res.data.draft) {
      const draft = res.data.draft;
      setDraftRevision(draft.revision);
      revisionRef.current = draft.revision;
      setName(draft.name);
      setDescription(draft.description);
      setMode(draft.mode);
      setDraftUpdatedAt(draft.updatedAt);
      if (draft.html) { setRecoveryPending(true); setGeneratedFile(new File([draft.html], draft.fileName || "questionnaire.html", { type: "text/html" })); }
      else { setRecoveryPending(false); setGeneratedFile(undefined); setResetKey((value) => value + 1); }
      setDraftStatus("saved");
    } else {
      revisionRef.current = 0;
      setDraftRevision(0);
      setRecoveryPending(false);
      setGeneratedFile(undefined);
      setResetKey((value) => value + 1);
      setDraftStatus("saved");
    }
    setRestoreReady(true);
  }

  useEffect(() => { void restoreDraft(); }, []);

  useEffect(() => {
    if (!restoreReady || completed.current || discarding.current || (recoveryPending && !upload.html)) return;
    if (skipNextSave.current) { skipNextSave.current = false; return; }
    if (!name.trim() && !description.trim() && !upload.html) return;
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = undefined;
      if (discarding.current || completed.current) return;
      const draft = { name, description, mode, ...(upload.html ? { html: upload.html, fileName: upload.fileName ?? "questionnaire.html" } : {}) };
      setDraftStatus("saving");
      saveQueue.current = saveQueue.current.then(async () => {
        if (completed.current) return;
        const res = await api<{ revision: number; updatedAt: string }>("/api/admin/campaign-draft", { method: "PUT", body: { expectedRevision: revisionRef.current, draft } });
        if (res.ok) {
          revisionRef.current = res.data.revision;
          setDraftRevision(res.data.revision);
          setDraftUpdatedAt(res.data.updatedAt);
          setDraftStatus("saved");
        } else {
          setDraftStatus(res.status === 409 ? "conflict" : "error");
        }
      }).catch(() => setDraftStatus("error"));
    }, 850);
    return () => {
      if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
      saveTimer.current = undefined;
    };
  }, [restoreReady, recoveryPending, name, description, mode, upload.html, upload.fileName]);

  const ready = name.trim().length > 0 && upload.ok && upload.settled && !busy;
  const why = !name.trim() ? "Add a name" : !upload.html ? "Add the questionnaire file" : !upload.settled ? "Waiting for the checks to finish" : !upload.ok ? "Fix the errors in the file" : "";

  async function create() {
    if (!ready || !upload.html) return;
    setBusy(true);
    const body = { name, description, mode, html: upload.html, fileName: upload.fileName };
    const operation = await clientOperationId("create-interview", body);
    const res = await api<{ id: string }>("/api/admin/interviews", { method: "POST", headers: { "Idempotency-Key": operation.operationId }, body });
    if (res.ok) {
      clearClientOperationId("create-interview", operation.fingerprint);
      completed.current = true;
      await saveQueue.current;
      let cleanupFailed = false;
      if (revisionRef.current > 0) {
        const cleanup = await api("/api/admin/campaign-draft", { method: "DELETE", body: { expectedRevision: revisionRef.current } });
        cleanupFailed = !cleanup.ok;
      }
      toast(cleanupFailed ? "Interview created. The saved draft could not be cleared and may appear again." : "Interview created", cleanupFailed ? "err" : undefined);
      router.push(`/admin/interviews/${res.data.id}${mode === "multi" ? "?tab=people" : ""}`);
    } else {
      toast(res.data.error ?? "Could not create the interview.", "err");
      setBusy(false);
    }
  }

  async function discardDraft() {
    discarding.current = true;
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current);
    saveTimer.current = undefined;
    await saveQueue.current;
    if (revisionRef.current > 0) {
      const res = await api("/api/admin/campaign-draft", { method: "DELETE", body: { expectedRevision: revisionRef.current } });
      if (!res.ok) {
        discarding.current = false;
        setDraftStatus(res.status === 409 ? "conflict" : "error");
        return;
      }
    }
    skipNextSave.current = true;
    setRecoveryPending(false);
    setName(""); setDescription(""); setMode("single"); setGeneratedFile(undefined); setUpload({ settled: false, ok: false });
    revisionRef.current = 0; setDraftRevision(0); setDraftUpdatedAt(undefined); setDraftStatus("saved"); setResetKey((value) => value + 1);
    discarding.current = false;
  }

  return (
    <div className="stack-lg">
      <div className="row wrap" role="status" style={{ justifyContent: "space-between", fontSize: 13 }}>
        <span className="muted">{draftStatus === "loading" ? "Checking for a saved draft…" : draftStatus === "saving" ? "Saving draft…" : draftStatus === "saved" ? `Draft saved${draftUpdatedAt ? ` · ${new Date(draftUpdatedAt).toLocaleString()}` : ""}` : draftStatus === "conflict" ? "This draft changed in another tab. Reload the saved version to continue." : "Draft could not be saved. Your current work is still here."}</span>
        <span className="row wrap">
          {draftStatus === "conflict" && <button className="btn sm" type="button" onClick={() => { setRestoreReady(false); setDraftStatus("loading"); void restoreDraft(); }}>Reload saved draft</button>}
          {draftStatus === "error" && !restoreReady && <button className="btn sm" type="button" onClick={() => { setDraftStatus("loading"); void restoreDraft(); }}>Retry draft recovery</button>}
          <button className="btn ghost sm" type="button" disabled={draftStatus === "loading" || (draftRevision === 0 && !name && !description && !upload.html)} onClick={() => void discardDraft()}>Discard draft</button>
        </span>
      </div>
      <section className="card">
        <div className="card-head"><h2>1. Details</h2></div>
        <div className="card-pad stack">
          <div className="field">
            <label htmlFor="name">Interview name</label>
            <input id="name" className="input" disabled={!restoreReady} value={name} maxLength={120} placeholder="For example, Investor scouting scope, Singapore" onChange={(e) => setName(e.target.value)} autoFocus />
            <span className="hint">Only you see this. Respondents see the title inside the questionnaire.</span>
          </div>
          <div className="field">
            <label htmlFor="desc">Notes <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
            <textarea id="desc" className="textarea" disabled={!restoreReady} rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who is this for and what is it about?" />
          </div>
          <div className="field">
            <span className="label" id="mode-label">Who is answering?</span>
            <div className="choice-grid" role="radiogroup" aria-labelledby="mode-label">
              <label className="choice">
                <input type="radio" name="mode" disabled={!restoreReady} checked={mode === "single"} onChange={() => setMode("single")} />
                <strong>One person</strong>
                <span>A single private link you can email or copy. Best when one client answers for their whole team.</span>
              </label>
              <label className="choice">
                <input type="radio" name="mode" disabled={!restoreReady} checked={mode === "multi"} onChange={() => setMode("multi")} />
                <strong>Multi-user</strong>
                <span>A separate link for each person, with their name, optional email and notes, so you know who answered what.</span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>2. Questionnaire file</h2>
          <span className="right" />
          <button className="btn sm" type="button" disabled={!restoreReady} onClick={() => setBuilding((open) => !open)}>{building ? "Hide builder" : generatedFile ? "Edit questionnaire" : "Build from scratch"}</button>
          <a className="btn ghost sm" href="/api/docs/template/starter.kqa.html" download><Icon name="download" size={15} /> Starter template</a>
          <Link className="btn ghost sm" href="/admin/docs">Format guide</Link>
        </div>
        <div className="card-pad" hidden={!building}><BasicQuestionnaireBuilder onUse={(html) => {
          const safeName = (name.trim() || "questionnaire").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase() || "questionnaire";
          setGeneratedFile(new File([html], `${safeName}.html`, { type: "text/html" }));
          setBuilding(false);
        }} /></div>
        <div className="card-pad"><Uploader generatedFile={generatedFile} resetKey={resetKey} disabled={!restoreReady} onChange={(next) => { setUpload(next); if (recoveryPending && next.html) setRecoveryPending(false); }} /></div>
      </section>

      <div className="row wrap" style={{ justifyContent: "flex-end" }}>
        {why && <span className="muted" style={{ fontSize: 13.5 }}>{why}</span>}
        <Link href="/admin" className="btn">Cancel</Link>
        <button className="btn accent lg" disabled={!restoreReady || !ready} onClick={create}>{busy && <Spinner />} Create interview</button>
      </div>
    </div>
  );
}
