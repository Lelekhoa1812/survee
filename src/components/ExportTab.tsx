"use client";

import { useState } from "react";
import type { InterviewData } from "./interview-types";
import { Icon, Spinner, useToast } from "./ui";
import { MAX_PARTICIPANTS_PER_READ } from "@/lib/participant-limits";

const FORMATS = [
  { id: "xlsx", name: "Excel workbook", ext: ".xlsx", note: "Summary, Wide, Long and People sheets; a Records sheet is added when repeat-group data exists." },
  { id: "csv-wide", name: "CSV, one row per person", ext: ".csv", note: "Each question is a column. Opens in Excel, Numbers and Google Sheets." },
  { id: "csv-long", name: "CSV, one row per answer", ext: ".csv", note: "Person, question, answer and note on separate rows. Best for pivot tables and analysis." },
  { id: "md", name: "Markdown report", ext: ".md", note: "A readable write-up of question answers by section, including repeat-group records." },
  { id: "json", name: "JSON", ext: ".json", note: "The full structured record including question definitions, for developers and automation." },
] as const;

export function ExportTab({ data }: { data: InterviewData }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState<string | null>(null);
  const total = data.counts.people;
  const done = data.counts.submitted;
  const tooLarge = total > MAX_PARTICIPANTS_PER_READ;
  const hasRepeatQuestions = data.manifest.questions.some((question) => question.type === "repeat");
  async function downloadCsv(format: "csv-wide" | "csv-long") {
    setDownloading(format);
    try {
      const response = await fetch(`/api/admin/interviews/${data.interview.id}/export?format=${format}`);
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(typeof body?.error === "string" ? body.error : "The CSV export could not be created.");
      }
      // Buffer only the bounded (64 MiB maximum) final response in the browser.
      // If the server ends an over-limit stream, no partial download is saved.
      let blob: Blob;
      try {
        blob = await response.blob();
      } catch {
        throw new Error("The CSV download was interrupted or exceeded its 64 MiB limit. No partial file was saved.");
      }
      const disposition = response.headers.get("content-disposition") ?? "";
      const filename = disposition.match(/filename="([^"]+)"/i)?.[1] ?? `interview-${format}.csv`;
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      toast(error instanceof Error ? error.message : "The CSV export was interrupted. No partial file was saved.", "err");
    } finally {
      setDownloading(null);
    }
  }
  return (
    <div className="stack">
      <div className="callout">
        <Icon name="info" />
        <div>Exports use survey version {data.interview.currentVersion} and include all {total} {total === 1 ? "person" : "people"}: {done} submitted, {total - done} still in progress or not started. Each file records its status.</div>
      </div>
      {tooLarge && <div className="callout warn" role="status"><Icon name="info" /><div>CSV exports sort people in creation order and stream participant data in bounded pages. Excel, Markdown and JSON exports support up to {MAX_PARTICIPANTS_PER_READ} people per file.</div></div>}
      <div className="callout" role="note"><Icon name="info" /><div>CSV downloads stream up to 64 MiB. If a file exceeds the limit or the connection is interrupted, the download fails without saving a partial file.</div></div>
      <div className="callout warn">
        <Icon name="info" />
        <div>Exports contain person-level information such as names, statuses, notes, answers, and free text. Share only with authorized people. Review the contents before uploading a file to an AI tool or another service.</div>
      </div>
      {hasRepeatQuestions && <div className="callout warn"><Icon name="info" /><div>The wide and long CSV files do not include repeat-group record rows. Download Excel for a normalized Records sheet, or JSON for the complete structured record data.</div></div>}
      <div className="choice-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {FORMATS.map((f) => (
          <div key={f.id} className="card card-pad stack" style={{ gap: 10, alignContent: "space-between" }}>
            <div>
              <div className="row" style={{ justifyContent: "space-between" }}><b>{f.name}</b><span className="code-chip">{f.ext}</span></div>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>{f.note}</p>
            </div>
            {f.id === "csv-wide" || f.id === "csv-long"
              ? <button className="btn" data-export-format={f.id} type="button" disabled={downloading !== null} onClick={() => void downloadCsv(f.id)}>{downloading === f.id ? <><Spinner /> Preparing CSV…</> : <><Icon name="download" size={15} /> Download</>}</button>
              : tooLarge
              ? <button className="btn" type="button" disabled><Icon name="download" size={15} /> Export limit reached</button>
              : <a className="btn" href={`/api/admin/interviews/${data.interview.id}/export?format=${f.id}`} download><Icon name="download" size={15} /> Download</a>}
          </div>
        ))}
      </div>
    </div>
  );
}
