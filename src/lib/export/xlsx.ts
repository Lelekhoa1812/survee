import { Workbook, type Worksheet } from "exceljs";
import { evaluateEligibility, isAnswered, progress } from "../format/answers";
import { neutraliseCell } from "./csv";
import { exportFilename, LONG_HEADER, longTable, recordTable, sortedParticipants, wideColumns, wideTable } from "./rows";
import type { ExportFile, ExportInput, ExportParticipant } from "./types";
import { MAX_XLSX_EXPORT_CELLS } from "../participant-limits";
import { XlsxComplexityLimitError } from "./errors";

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

/** Estimate styled cell count without materializing export tables or a workbook. */
export function estimateXlsxCells(input: ExportInput): number {
  const people = input.participants;
  const wideCells = (people.length + 1) * wideColumns(input.manifest, input.surveyVersion).length;
  const summaryCells = (input.manifest.questions.length + 12) * 7;
  const peopleCells = (people.length + 1) * 10;
  const repeatQuestions = new Map(input.manifest.questions.filter((question) => question.type === "repeat").map((question) => [question.id, question]));
  let longRows = 0;
  let recordRows = 0;
  let presentationRows = 0;

  for (const person of people) {
    const eligibility = evaluateEligibility(input.manifest, person.answers, person.recordGroups);
    for (const question of input.manifest.questions) {
      const answer = person.answers[question.id];
      const hasNote = (answer?.note ?? "").trim() !== "";
      if (eligibility[question.id] !== false && !isAnswered(question, person.answers) && !hasNote) continue;
      longRows += 1;
    }
    for (const assignment of person.questionOrderAssignments ?? []) presentationRows += Object.keys(assignment.groups).length;

    const groups = person.recordGroups ?? {};
    const declaredIds = input.manifest.questions.filter((question) => question.type === "repeat" && Object.hasOwn(groups, question.id)).map((question) => question.id);
    const declaredIdSet = new Set(declaredIds);
    const questionIds = [...declaredIds, ...Object.keys(groups).filter((questionId) => !declaredIdSet.has(questionId))];
    for (const questionId of questionIds) {
      const records = groups[questionId] ?? [];
      const fields = repeatQuestions.get(questionId)?.fields ?? [];
      const knownIds = new Set(fields.map((field) => field.id));
      for (const record of records) {
        const unknownFields = Object.keys(record.values).filter((fieldId) => !knownIds.has(fieldId));
        recordRows += fields.length + unknownFields.length;
      }
    }
  }

  const longCells = (longRows + 1) * LONG_HEADER.length;
  const recordCells = recordRows ? (recordRows + 1) * 12 : 0;
  const presentationCells = presentationRows ? (presentationRows + 1) * 7 : 0;
  return summaryCells + wideCells + longCells + peopleCells + recordCells + presentationCells;
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
  const personState = people.map((p) => ({ p, eligibility: evaluateEligibility(input.manifest, p.answers, p.recordGroups) }));
  for (const q of input.manifest.questions) {
    const status = personState.map(({ p, eligibility }) => ({ eligible: eligibility[q.id] !== false, answered: isAnswered(q, p.answers, p.recordGroups) }));
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
    const pr = progress(input.manifest, p.answers, p.recordGroups);
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
  const estimatedCells = estimateXlsxCells(input);
  if (estimatedCells > MAX_XLSX_EXPORT_CELLS) throw new XlsxComplexityLimitError(estimatedCells);
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
