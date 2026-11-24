import { exportFilename, longTable, RECORD_HEADER, recordParticipantRows, sortedParticipants, wideTable, type Table } from "./rows";
import type { ExportFile, ExportInput } from "./types";

/** Spreadsheet programs may ignore leading whitespace before formula markers. */
const FORMULA_START = /^[\s\u0000-\u001f]*[=+\-@\t\r\n＝＋－＠]/u;
/** Plain numbers such as "-3" or "4.5" are data, not formulas, so they are left alone. */
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Prefix a leading apostrophe to any cell that could be read as a formula. */
export function neutraliseCell(value: string): string {
  if (!FORMULA_START.test(value)) return value;
  if (PLAIN_NUMBER.test(value.trim())) return value;
  return `'${value}`;
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Encode one RFC 4180 row using the same formula and quoting rules as buffered CSV exports. */
export function encodeCsvRow(row: string[]): string {
  return `${row.map((cell) => quoteCsv(neutraliseCell(cell))).join(",")}\r\n`;
}

/** RFC 4180 CSV with CRLF line ends and a UTF-8 BOM so Excel opens it as UTF-8. */
export function toCsv(table: Table): string {
  const lines = [table.header, ...table.rows].map((row) => row.map((cell) => quoteCsv(neutraliseCell(cell))).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvWide(input: ExportInput): ExportFile {
  return {
    filename: exportFilename(input, "csv-wide"),
    contentType: "text/csv; charset=utf-8",
    body: toCsv(wideTable(input, "created-desc")),
  };
}

export function csvLong(input: ExportInput): ExportFile {
  return {
    filename: exportFilename(input, "csv-long"),
    contentType: "text/csv; charset=utf-8",
    body: toCsv(longTable(input, "created-desc")),
  };
}

export function csvRecords(input: ExportInput): ExportFile {
  return {
    filename: exportFilename(input, "csv-records"),
    contentType: "text/csv; charset=utf-8",
    body: toCsv({ header: [...RECORD_HEADER], rows: sortedParticipants(input, "created-desc").flatMap((person) => recordParticipantRows(input.manifest, person)) }),
  };
}
