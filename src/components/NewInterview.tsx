"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Uploader, type UploadState } from "./Uploader";
import { api, Icon, Spinner, useToast } from "./ui";

export function NewInterview() {
  const router = useRouter();
  const toast = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [mode, setMode] = useState<"single" | "multi">("single");
  const [upload, setUpload] = useState<UploadState>({ settled: false, ok: false });
  const [busy, setBusy] = useState(false);

  const ready = name.trim().length > 0 && upload.ok && upload.settled && !busy;
  const why = !name.trim() ? "Add a name" : !upload.html ? "Add the questionnaire file" : !upload.settled ? "Waiting for the checks to finish" : !upload.ok ? "Fix the errors in the file" : "";

  async function create() {
    if (!ready || !upload.html) return;
    setBusy(true);
    const res = await api<{ id: string }>("/api/admin/interviews", { method: "POST", body: { name, description, mode, html: upload.html, fileName: upload.fileName } });
    if (res.ok) {
      toast("Interview created");
      router.push(`/admin/interviews/${res.data.id}${mode === "multi" ? "?tab=people" : ""}`);
    } else {
      toast(res.data.error ?? "Could not create the interview.", "err");
      setBusy(false);
    }
  }

  return (
    <div className="stack-lg">
      <section className="card">
        <div className="card-head"><h2>1. Details</h2></div>
        <div className="card-pad stack">
          <div className="field">
            <label htmlFor="name">Interview name</label>
            <input id="name" className="input" value={name} maxLength={120} placeholder="For example, Investor scouting scope, Singapore" onChange={(e) => setName(e.target.value)} autoFocus />
            <span className="hint">Only you see this. Respondents see the title inside the questionnaire.</span>
          </div>
          <div className="field">
            <label htmlFor="desc">Notes <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
            <textarea id="desc" className="textarea" rows={2} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Who is this for and what is it about?" />
          </div>
          <div className="field">
            <span className="label" id="mode-label">Who is answering?</span>
            <div className="choice-grid" role="radiogroup" aria-labelledby="mode-label">
              <label className="choice">
                <input type="radio" name="mode" checked={mode === "single"} onChange={() => setMode("single")} />
                <strong>One person</strong>
                <span>A single private link. Best when one client answers for their whole team.</span>
              </label>
              <label className="choice">
                <input type="radio" name="mode" checked={mode === "multi"} onChange={() => setMode("multi")} />
                <strong>Multi-user</strong>
                <span>A separate link for each person you add, with their name and notes, so you know who answered what.</span>
              </label>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        <div className="card-head">
          <h2>2. Questionnaire file</h2>
          <span className="right" />
          <a className="btn ghost sm" href="/api/docs/template/starter.kqa.html" download><Icon name="download" size={15} /> Starter template</a>
          <Link className="btn ghost sm" href="/admin/docs">Format guide</Link>
        </div>
        <div className="card-pad"><Uploader onChange={setUpload} /></div>
      </section>

      <div className="row wrap" style={{ justifyContent: "flex-end" }}>
        {why && <span className="muted" style={{ fontSize: 13.5 }}>{why}</span>}
        <Link href="/admin" className="btn">Cancel</Link>
        <button className="btn accent lg" disabled={!ready} onClick={create}>{busy && <Spinner />} Create interview</button>
      </div>
    </div>
  );
}
