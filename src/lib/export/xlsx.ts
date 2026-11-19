import { Workbook, type Worksheet } from "exceljs";
import { evaluateEligibility, isAnswered, progress } from "../format/answers";
import { neutraliseCell } from "./csv";
import { exportFilename, longTable, recordTable, sortedParticipants, wideColumns, wideTable } from "./rows";
import type { ExportFile, ExportInput, ExportParticipant } from "./types";

const FONT_NAME = "Calibri";
const FONT_SIZE = 11;
const HEADER_FILL = "FF0B2A42";
const MAX_WIDTH = 60;
const MIN_WIDTH = 10;

type CellValue = string | number;

interface SheetSpec {
  name: string;
  header: string[];
  rows: CellValue[][];
  /** Zero-based columns whose text wraps. */
  wrap: Set<number>;
  filter: boolean;
}

function longestLine(text: string): number {
  return text.split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0);
}

function applyBodyStyle(ws: Worksheet, rowCount: number, colCount: number, wrap: Set<number>): void {
  for (let r = 2; r <= rowCount; r++) {
    for (let c = 1; c <= colCount; c++) {
      const cell = ws.getCell(r, c);
      cell.font = { name: FONT_NAME, size: FONT_SIZE };
      cell.alignment = { vertical: "top", wrapText: wrap.has(c - 1) };
    }
  }
}

function styleHeader(ws: Worksheet, rowNum: number, colCount: number): void {
  for (let c = 1; c <= colCount; c++) {
    const cell = ws.getCell(rowNum, c);
    cell.font = { name: FONT_NAME, size: FONT_SIZE, bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEADER_FILL } };
    cell.alignment = { vertical: "middle" };
  }
}

function setWidths(ws: Worksheet, header: string[], rows: CellValue[][]): void {
  header.forEach((h, i) => {
    let longest = longestLine(h);
    for (const r of rows) longest = Math.max(longest, longestLine(String(r[i] ?? "")));
    ws.getColumn(i + 1).width = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, longest + 2));
  });
}

function writeTable(wb: Workbook, spec: SheetSpec): void {
  const ws = wb.addWorksheet(spec.name);
  const neutral = (v: CellValue) => (typeof v === "string" ? neutraliseCell(v) : v);
  ws.addRow(spec.header.map(neutraliseCell));
  for (const r of spec.rows) ws.addRow(r.map(neutral));
  setWidths(ws, spec.header, spec.rows);
  applyBodyStyle(ws, spec.rows.length + 1, spec.header.length, spec.wrap);
  styleHeader(ws, 1, spec.header.length);
  ws.views = [{ state: "frozen", ySplit: 1, topLeftCell: "A2" }];
  if (spec.filter) {
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: spec.rows.length + 1, column: spec.header.length },
    };
  }
}

function indexesWhere<T>(items: T[], test: (item: T) => boolean): Set<number> {
  return new Set(items.flatMap((item, i) => (test(item) ? [i] : [])));
}

function writeSummary(wb: Workbook, input: ExportInput, people: ExportParticipant[]): void {
  const ws = wb.addWorksheet("Summary");
  const count = (status: ExportParticipant["status"]) => people.filter((p) => p.status === status).length;
  const details: [string, CellValue][] = [
    ["Interview", input.interview.name],
    ["Mode", input.interview.mode],
    ["Status", input.interview.status],
    ["Survey version", input.surveyVersion],
    ["Generated at", input.generatedAt],
  ];
  const counts: [string, CellValue][] = [
    ["People", people.length],
    ["Submitted", count("submitted")],
    ["In progress", count("in_progress")],
    ["Invited", count("invited")],
  ];
  for (const [label, value] of [...details, ...counts]) {
    const row = ws.addRow([label, typeof value === "string" ? neutraliseCell(value) : value]);
    row.getCell(1).font = { name: FONT_NAME, size: FONT_SIZE, bold: true };
  }
  ws.addRow([]);

  const tableHeaderRow = ws.rowCount + 1;
  const header = ["Question id", "Question", "Type", "Eligible", "Inactive", "Answered", "Share of eligible with stored answer"];
  ws.addRow(header);
  const personState = people.map((p) => ({ p, eligibility: evaluateEligibility(input.manifest, p.answers) }));
  for (const q of input.manifest.questions) {
    const status = personState.map(({ p, eligibility }) => ({ eligible: eligibility[q.id] !== false, answered: isAnswered(q, p.answers) }));
    const eligible = status.filter((item) => item.eligible).length;
    const inactive = status.length - eligible;
    const answered = status.filter((item) => item.eligible && item.answered).length;
    const share = eligible ? answered / eligible : 0;
    const row = ws.addRow([q.id, neutraliseCell(q.label), q.type, eligible, inactive, answered, share]);
    row.getCell(7).numFmt = "0%";
  }
  ws.addRow([
    "Metric note",
    "Eligibility and inactivity are inferred from the current manifest rules and saved answers; they do not record historical display. Share of eligible with stored answer = eligible people with a stored answer divided by eligible people. Stored answers to currently inactive questions remain in the Wide and Long sheets.",
  ]);

  const widths = [28, 60, 14, 12, 12, 12, 36];
  widths.forEach((w, i) => (ws.getColumn(i + 1).width = w));
  applyBodyStyle(ws, ws.rowCount, header.length, new Set([1]));
  styleHeader(ws, tableHeaderRow, header.length);
}

function writePeople(wb: Workbook, input: ExportInput, people: ExportParticipant[]): void {
  const header = [
    "Person",
    "Person note",
    "Status",
    "Answered",
    "Eligible questions",
    "Inactive questions",
    "Required answered",
    "Required questions",
    "Last saved",
    "Submitted",
  ];
  const rows: CellValue[][] = people.map((p) => {
    const pr = progress(input.manifest, p.answers);
    return [
      p.name,
      p.note ?? "",
      p.status,
      pr.answered,
      pr.total,
      pr.inactive,
      pr.requiredAnswered,
      pr.requiredTotal,
      p.lastSavedAt ?? "",
      p.submittedAt ?? "",
    ];
  });
  writeTable(wb, { name: "People", header, rows, wrap: new Set([1]), filter: false });
}

/** Styled workbook: Summary, Wide, Long and People sheets, plus Records when repeat data exists. */
export async function xlsxExport(input: ExportInput): Promise<ExportFile> {
  const wb = new Workbook();
  const people = sortedParticipants(input);

  writeSummary(wb, input, people);

  const wide = wideTable(input);
  const cols = wideColumns(input.manifest, input.surveyVersion);
  writeTable(wb, {
    name: "Wide",
    header: wide.header,
    rows: wide.rows,
    wrap: indexesWhere(cols, (c) => c.kind !== "fixed" || c.header === "Person note"),
    filter: true,
  });

  const long = longTable(input);
  writeTable(wb, {
    name: "Long",
    header: long.header,
    rows: long.rows,
    wrap: indexesWhere(long.header, (h) => h === "Answer" || h === "Note"),
    filter: true,
  });

  writePeople(wb, input, people);

  const records = recordTable(input);
  if (records.rows.length) {
    writeTable(wb, {
      name: "Records",
      header: records.header,
      rows: records.rows,
      wrap: indexesWhere(records.header, (header) => header === "Question" || header === "Field" || header === "Value"),
      filter: true,
    });
  }

  const presentationRows: CellValue[][] = [];
  for (const person of sortedParticipants(input)) {
    for (const assignment of person.questionOrderAssignments ?? []) {
      for (const [groupId, questionIds] of Object.entries(assignment.groups)) {
        presentationRows.push([person.id, person.name, assignment.surveyVersion, assignment.algorithmVersion, groupId, questionIds.join(";"), assignment.assignedAt]);
      }
    }
  }
  if (presentationRows.length) {
    writeTable(wb, {
      name: "Presentations",
      header: ["Person id", "Person", "Survey version", "Assignment algorithm", "Question-order group", "Assigned question order", "Assigned at"],
      rows: presentationRows,
      wrap: new Set([1, 4, 5]),
      filter: true,
    });
  }

  const buffer = await wb.xlsx.writeBuffer();
  return {
    filename: exportFilename(input, "xlsx"),
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    body: Buffer.from(buffer),
  };
}
