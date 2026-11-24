"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Report } from "@/lib/diagnostics/types";
import { mergeDiagnostics, toAgentMarkdown } from "@/lib/diagnostics/report";
import { LIMITS } from "@/lib/format/schema";
import { runProbe } from "@/lib/probeClient";
import { CheckerPanel } from "./CheckerPanel";
import { api, Icon } from "./ui";

export interface UploadState {
  fileName?: string;
  html?: string;
  report?: Report;
  markdown?: string;
  /** Static checks finished and the live check finished (or could not run). */
  settled: boolean;
  /** No errors anywhere: safe to save. */
  ok: boolean;
}

export function Uploader({ interviewId, onChange, compact, disabled = false, initialState, generatedFile, resetKey }: { interviewId?: string; onChange?: (s: UploadState) => void; compact?: boolean; disabled?: boolean; initialState?: UploadState; generatedFile?: File; resetKey?: number }) {
  const [state, setState] = useState<UploadState>(initialState ?? { settled: false, ok: false });
  const [phase, setPhase] = useState<"idle" | "static" | "live">("idle");
  const [error, setError] = useState("");
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const run = useRef(0);

  useEffect(() => { onChange?.(state); }, [state, onChange]);

  useEffect(() => {
    if (resetKey === undefined) return;
    run.current++;
    setState({ settled: false, ok: false });
    setPhase("idle");
    setError("");
    if (input.current) input.current.value = "";
  }, [resetKey]);

  const handle = useCallback(async (file: File) => {
    const id = ++run.current;
    setError("");
    setState({ settled: false, ok: false });
    setPhase("idle");
    if (input.current) input.current.value = "";
    if (!/\.html?$/i.test(file.name)) { setError("That is not an HTML file. Upload a file that ends in .html."); return; }
    if (file.size > LIMITS.maxFileBytes) { setError(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${LIMITS.maxFileBytes / 1048576} MB.`); return; }
    const html = await file.text();
    setState({ fileName: file.name, html, settled: false, ok: false });
    setPhase("static");
    const res = await api<{ report: Report; markdown: string }>("/api/admin/check", { method: "POST", body: { html, fileName: file.name, interviewId } });
    if (id !== run.current) return;
    if (!res.data.report) {
      setPhase("idle");
      setError(res.data.error ?? "The checker could not run. Try again.");
      setState({ settled: true, ok: false, fileName: file.name, html });
      return;
    }
    let report = res.data.report;
    let markdown = res.data.markdown;
    if (!report.ok || !report.manifest) {
      setState({ fileName: file.name, html, report, markdown, settled: true, ok: false });
      setPhase("idle");
      return;
    }
    setState({ fileName: file.name, html, report, markdown, settled: false, ok: false });
    setPhase("live");
    const extra = await runProbe(html, report.manifest.questions);
    if (id !== run.current) return;
    if (extra.length) {
      report = mergeDiagnostics(report, extra);
      markdown = toAgentMarkdown(report);
    }
    setState({ fileName: file.name, html, report, markdown, settled: true, ok: report.ok });
    setPhase("idle");
  }, [interviewId]);

  useEffect(() => { if (generatedFile) void handle(generatedFile); }, [generatedFile, handle]);

  const reset = () => { run.current++; setState({ settled: false, ok: false }); setPhase("idle"); setError(""); if (input.current) input.current.value = ""; };

  return (
    <div className="stack">
      <input ref={input} type="file" accept=".html,.htm,text/html" className="sr" tabIndex={-1} disabled={disabled} onChange={(e) => { const f = e.target.files?.[0]; if (f) void handle(f); }} />
      {!state.fileName ? (
        <div
          className={`dropzone ${over ? "over" : ""}`}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onClick={() => { if (!disabled) input.current?.click(); }}
          onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); input.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); if (disabled) return; const f = e.dataTransfer.files?.[0]; if (f) void handle(f); }}
          style={compact ? { padding: "22px 16px" } : undefined}
        >
          <div className="ico"><Icon name="upload" size={20} /></div>
          <strong>Drop the questionnaire file here, or choose one</strong>
          <span className="muted" style={{ fontSize: 13.5 }}>A single .html file in the survee format, up to {LIMITS.maxFileBytes / 1048576} MB. It is checked the moment you add it.</span>
        </div>
      ) : (
        <div className="file-pill">
          <div className="ico"><Icon name="file" size={18} /></div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{state.fileName}</div>
            <div className="muted" style={{ fontSize: 13 }}>{state.html ? `${Math.max(1, Math.round(state.html.length / 1024))} KB` : ""}</div>
          </div>
          <button className="btn sm" disabled={disabled} onClick={() => input.current?.click()}>Replace file</button>
          <button className="btn ghost sm icon" disabled={disabled} onClick={reset} aria-label="Remove file"><Icon name="x" size={16} /></button>
        </div>
      )}
      {error && <div className="callout err" role="alert"><Icon name="alert" /><span>{error}</span></div>}
      {phase === "static" && !state.report && (
        <div className="verdict run" role="status"><div className="dot"><Icon name="clock" size={18} /></div><div><h3>Checking the file</h3><p>Reading the manifest and matching every question to its controls.</p></div></div>
      )}
      {state.report && <CheckerPanel report={state.report} markdown={state.markdown ?? ""} running={phase === "live"} />}
    </div>
  );
}
