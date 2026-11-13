"use client";

import { useMemo, useState } from "react";
import type { Diagnostic, Report } from "@/lib/diagnostics/types";
import { CopyButton, Icon } from "./ui";

type Filter = "all" | "error" | "warning" | "info";

const SEV_LABEL = { error: "Error", warning: "Warning", info: "Note" } as const;
const SEV_BADGE = { error: "err", warning: "warn", info: "info" } as const;

function DiagItem({ d, open }: { d: Diagnostic; open: boolean }) {
  const where = [d.location ? `Line ${d.location.line}, column ${d.location.column}` : "", d.questionId ? `Question ${d.questionId}` : "", d.path ?? ""].filter(Boolean).join("  ·  ");
  return (
    <details className={`diag ${d.severity}`} open={open}>
      <summary>
        <Icon name="chevron" size={14} className="chev" />
        <span className={`badge ${SEV_BADGE[d.severity]}`}>{SEV_LABEL[d.severity]}</span>
        <span className="title">{d.title}</span>
        <span className="code-chip">{d.code}</span>
      </summary>
      <div className="diag-body">
        {where && <div className="muted mono" style={{ fontSize: 12.5 }}>{where}</div>}
        <dl style={{ margin: 0, display: "grid", gap: 12 }}>
          <div><dt>What is wrong</dt><dd style={{ whiteSpace: "pre-wrap" }}>{d.message}</dd></div>
          <div><dt>How to fix it</dt><dd>{d.fix}</dd></div>
        </dl>
        {d.context && <pre className="src"><code>{d.context}</code></pre>}
      </div>
    </details>
  );
}

export function CheckerPanel({ report, markdown, running, runningLabel }: { report: Report; markdown: string; running?: boolean; runningLabel?: string }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [showMd, setShowMd] = useState(false);
  const list = useMemo(() => report.diagnostics.filter((d) => filter === "all" || d.severity === filter), [report, filter]);
  const { error, warning, info } = report.counts;
  const clean = report.diagnostics.length === 0;
  const blocked = error > 0;
  const fileName = (report.fileName ?? "questionnaire").replace(/\.html?$/i, "");

  return (
    <div className="stack">
      <div className={`verdict ${running ? "run" : blocked ? "fail" : "pass"}`} role="status">
        <div className="dot"><Icon name={running ? "clock" : blocked ? "x" : "check"} size={18} /></div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h3>
            {running ? "Running the live check" : blocked ? `Not ready: ${error} ${error === 1 ? "error" : "errors"} to fix` : clean ? "All checks passed" : "Ready to use, with a few notes"}
          </h3>
          <p>
            {running
              ? runningLabel ?? "Opening the file in a sandboxed frame and trying every control."
              : blocked
                ? "KQA cannot read or save answers from this file yet. Copy the report below to the AI agent that wrote it."
                : `${report.stats.questions} ${report.stats.questions === 1 ? "question" : "questions"} found and bound to the answer store.${warning || info ? ` ${warning} ${warning === 1 ? "warning" : "warnings"} and ${info} ${info === 1 ? "note" : "notes"} are worth a look.` : ""}`}
          </p>
        </div>
      </div>

      <div className="stats" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))" }}>
        <div className="stat"><b>{report.stats.questions}</b><span>Questions</span></div>
        <div className="stat"><b>{report.stats.boundQuestions}</b><span>Bound controls</span></div>
        <div className="stat"><b>{report.stats.requiredQuestions}</b><span>Required</span></div>
        <div className="stat"><b>{Math.max(1, Math.round(report.stats.bytes / 1024))} KB</b><span>File size</span></div>
      </div>

      {!clean && (
        <>
          <div className="row wrap">
            <div className="seg" role="group" aria-label="Filter findings">
              {([["all", `All ${report.diagnostics.length}`], ["error", `Errors ${error}`], ["warning", `Warnings ${warning}`], ["info", `Notes ${info}`]] as [Filter, string][]).map(([k, label]) => (
                <button key={k} aria-pressed={filter === k} onClick={() => setFilter(k)}>{label}</button>
              ))}
            </div>
            <div className="right row">
              <CopyButton className="btn primary sm" label="Copy for AI agent" done="Copied for agent" text={markdown} />
              <button
                className="btn sm"
                onClick={() => {
                  const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${fileName}-kqa-report.md`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 1000);
                }}
              >
                <Icon name="download" size={15} /> Download .md
              </button>
            </div>
          </div>
          <div className="stack" style={{ gap: 10 }}>
            {list.map((d, i) => (
              <DiagItem key={`${d.code}-${i}-${d.location?.line ?? ""}-${d.questionId ?? ""}`} d={d} open={d.severity === "error" && i < 3} />
            ))}
            {list.length === 0 && <p className="muted">Nothing in this category.</p>}
          </div>
          <div className="agent-box">
            <button type="button" className="btn ghost sm" style={{ margin: 8 }} onClick={() => setShowMd((s) => !s)} aria-expanded={showMd}>
              <Icon name="sparkle" size={15} /> {showMd ? "Hide" : "Preview"} what the AI agent receives
            </button>
            {showMd && <pre>{markdown}</pre>}
          </div>
        </>
      )}
    </div>
  );
}
