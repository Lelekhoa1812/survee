"use client";

import type { InterviewData } from "./interview-types";
import { Icon } from "./ui";

const FORMATS = [
  { id: "xlsx", name: "Excel workbook", ext: ".xlsx", note: "Summary, Wide, Long and People sheets; a Records sheet is added when repeat-group data exists." },
  { id: "csv-wide", name: "CSV, one row per person", ext: ".csv", note: "Each question is a column. Opens in Excel, Numbers and Google Sheets." },
  { id: "csv-long", name: "CSV, one row per answer", ext: ".csv", note: "Person, question, answer and note on separate rows. Best for pivot tables and analysis." },
  { id: "md", name: "Markdown report", ext: ".md", note: "A readable write-up of question answers by section, including repeat-group records." },
  { id: "json", name: "JSON", ext: ".json", note: "The full structured record including question definitions, for developers and automation." },
] as const;

export function ExportTab({ data }: { data: InterviewData }) {
  const done = data.people.filter((p) => p.status === "submitted").length;
  const hasRecordRows = data.people.some((person) => Object.values(person.recordGroups ?? {}).some((rows) => rows.length > 0));
  return (
    <div className="stack">
      <div className="callout">
        <Icon name="info" />
        <div>Exports use survey version {data.interview.currentVersion} and include all {data.people.length} {data.people.length === 1 ? "person" : "people"}: {done} submitted, {data.people.length - done} still in progress or not started. Each file records its status.</div>
      </div>
      <div className="callout warn">
        <Icon name="info" />
        <div>Exports contain person-level information such as names, statuses, notes, answers, and free text. Share only with authorized people. Review the contents before uploading a file to an AI tool or another service.</div>
      </div>
      {hasRecordRows && <div className="callout warn"><Icon name="info" /><div>The wide and long CSV files do not include repeat-group record rows. Download Excel for a normalized Records sheet, or JSON for the complete structured record data.</div></div>}
      <div className="choice-grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))" }}>
        {FORMATS.map((f) => (
          <div key={f.id} className="card card-pad stack" style={{ gap: 10, alignContent: "space-between" }}>
            <div>
              <div className="row" style={{ justifyContent: "space-between" }}><b>{f.name}</b><span className="code-chip">{f.ext}</span></div>
              <p className="muted" style={{ fontSize: 13.5, marginTop: 6 }}>{f.note}</p>
            </div>
            <a className="btn" href={`/api/admin/interviews/${data.interview.id}/export?format=${f.id}`} download><Icon name="download" size={15} /> Download</a>
          </div>
        ))}
      </div>
    </div>
  );
}
