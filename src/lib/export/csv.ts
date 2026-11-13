import { exportFilename, longTable, wideTable, type Table } from "./rows";
import type { ExportFile, ExportInput } from "./types";

/** Cells starting with these characters can run as formulas in Excel and Sheets. */
const FORMULA_START = /^[=+\-@\t\r]/;
/** Plain numbers such as "-3" or "4.5" are data, not formulas, so they are left alone. */
const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** Prefix a leading apostrophe to any cell that could be read as a formula. */
export function neutraliseCell(value: string): string {
  if (!FORMULA_START.test(value)) return value;
  if (PLAIN_NUMBER.test(value)) return value;
  return `'${value}`;
}

function quoteCsv(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
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
    body: toCsv(wideTable(input)),
  };
}

export function csvLong(input: ExportInput): ExportFile {
  return {
    filename: exportFilename(input, "csv-long"),
    contentType: "text/csv; charset=utf-8",
    body: toCsv(longTable(input)),
  };
}
