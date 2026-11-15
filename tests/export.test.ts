import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import type { Manifest } from "../src/lib/format/schema";
import { csvLong, csvWide, toCsv } from "../src/lib/export/csv";
import { exportFilename, longTable, slugify, wideTable } from "../src/lib/export/rows";
import { jsonExport } from "../src/lib/export/json";
import { escapeInline, markdownExport } from "../src/lib/export/markdown";
import { exportInterview, type ExportInput } from "../src/lib/export/index";
import { xlsxExport } from "../src/lib/export/xlsx";

const T = "2026-11-05T02:00:00.000Z";

const manifest: Manifest = {
  format: "kqa/1",
  title: "Staff pulse 2026",
  sections: [
    { id: "about", title: "About you" },
    { id: "views", title: "Your views", description: "Tell us what you think." },
  ],
  questions: [
    { id: "start", type: "date", label: "Start date", required: true },
    {
      id: "role",
      type: "single",
      label: "Role",
      section: "about",
      required: true,
      options: [
        { value: "P1", label: "Product" },
        { value: "E1", label: "Engineering" },
      ],
    },
    {
      id: "tools",
      type: "multi",
      label: "Tools used",
      section: "about",
      options: [
        { value: "a", label: "Email" },
        { value: "b", label: "Spreadsheets" },
        { value: "c", label: "CRM" },
      ],
    },
    {
      id: "team",
      type: "select",
      label: "Team",
      section: "views",
      options: [
        { value: "north", label: "North" },
        { value: "south", label: "South" },
      ],
    },
    { id: "title", type: "text", label: "Job title", section: "about", maxLength: 80 },
    { id: "comments", type: "longtext", label: "Comments", section: "views" },
    { id: "delta", type: "number", label: "Headcount change", section: "views", min: -100, max: 100 },
    {
      id: "satisfaction",
      type: "scale",
      label: "Satisfaction",
      section: "views",
      min: 1,
      max: 5,
      note: { label: "Why?", placeholder: "Optional" },
    },
  ],
};

const benNote = 'Too slow, "again"\nneeds work';

const input: ExportInput = {
  interview: {
    id: "int-1",
    name: "Staff pulse survey 2026",
    mode: "multi",
    status: "open",
    createdAt: "2026-10-20T00:00:00.000Z",
  },
  manifest,
  surveyVersion: 3,
  generatedAt: "2026-11-13T09:30:00.000Z",
  // Deliberately out of name order to exercise sorting.
  participants: [
    {
      id: "p-ben",
      name: "Ben Okafor",
      note: "Joined late",
      status: "in_progress",
      createdAt: "2026-11-02T00:00:00.000Z",
      lastSavedAt: "2026-11-06T00:00:00.000Z",
      answers: {
        role: { value: "P1", updatedAt: T },
        satisfaction: { note: benNote, updatedAt: T },
        title: { value: "", updatedAt: T },
      },
    },
    {
      id: "p-ana",
      name: "Ana Lopez",
      status: "submitted",
      createdAt: "2026-11-01T00:00:00.000Z",
      lastSavedAt: T,
      submittedAt: T,
      answers: {
        start: { value: "2026-10-01", updatedAt: T },
        role: { value: "E1", updatedAt: T },
        tools: { value: ["a", "c"], updatedAt: T },
        team: { value: "north", updatedAt: T },
        title: { value: "Head of Ops", updatedAt: T },
        comments: { value: 'Good, really.\n"Keep it" going', updatedAt: T },
        delta: { value: -3, updatedAt: T },
        satisfaction: { value: 4, note: "Fine", updatedAt: T },
      },
    },
    {
      id: "p-sum",
      name: "=SUM(A1)",
      status: "invited",
      createdAt: "2026-11-03T00:00:00.000Z",
      answers: {},
    },
  ],
};

const expectedHeader = [
  "Person",
  "Person note",
  "Status",
  "Last saved",
  "Submitted",
  "start | Start date",
  "role | Role",
  "tools | Tools used",
  "team | Team",
  "title | Job title",
  "comments | Comments",
  "delta | Headcount change",
  "satisfaction | Satisfaction",
  "satisfaction | note",
];

describe("wide table", () => {
  it("has one row per participant and one column per question, with notes where enabled", () => {
    const wide = wideTable(input);
    expect(wide.header).toEqual(expectedHeader);
    expect(wide.header).toHaveLength(14);
    expect(wide.rows).toHaveLength(3);
    for (const row of wide.rows) expect(row).toHaveLength(14);
  });

  it("sorts participants by name case-insensitively", () => {
    const names = wideTable(input).rows.map((r) => r[0]);
    expect(names).toEqual(["=SUM(A1)", "Ana Lopez", "Ben Okafor"]);
  });

  it("shows human-readable answers and joins multi values", () => {
    const ana = wideTable(input).rows.find((r) => r[0] === "Ana Lopez")!;
    expect(ana[wideTable(input).header.indexOf("role | Role")]).toBe("Engineering");
    expect(ana[wideTable(input).header.indexOf("tools | Tools used")]).toBe("Email; CRM");
    expect(ana[wideTable(input).header.indexOf("satisfaction | note")]).toBe("Fine");
  });

  it("keeps the note text on a partial participant and leaves unanswered cells empty", () => {
    const header = wideTable(input).header;
    const ben = wideTable(input).rows.find((r) => r[0] === "Ben Okafor")!;
    expect(ben[header.indexOf("satisfaction | note")]).toBe(benNote);
    expect(ben[header.indexOf("satisfaction | Satisfaction")]).toBe("");
    expect(ben[header.indexOf("Person note")]).toBe("Joined late");
  });
});

describe("long table", () => {
  it("has one row per participant and answered or noted question, skipping empty ones", () => {
    const long = longTable(input);
    expect(long.header).toEqual([
      "Person",
      "Person status",
      "Section",
      "Question id",
      "Question",
      "Type",
      "Answer",
      "Answer value",
      "Note",
      "Updated at",
    ]);
    // Ana answered all 8 questions, Ben has role and a note-only satisfaction, the invited person has none.
    expect(long.rows).toHaveLength(10);
    expect(long.rows.filter((r) => r[0] === "Ana Lopez")).toHaveLength(8);
    expect(long.rows.some((r) => r[0] === "=SUM(A1)")).toBe(false);
    // Ben's empty title answer is skipped.
    expect(long.rows.some((r) => r[0] === "Ben Okafor" && r[3] === "title")).toBe(false);
  });

  it("gives raw machine values and display values", () => {
    const long = longTable(input);
    const tools = long.rows.find((r) => r[0] === "Ana Lopez" && r[3] === "tools")!;
    expect(tools[6]).toBe("Email; CRM");
    expect(tools[7]).toBe("a;c");
    const delta = long.rows.find((r) => r[0] === "Ana Lopez" && r[3] === "delta")!;
    expect(delta[7]).toBe("-3");
    const role = long.rows.find((r) => r[0] === "Ana Lopez" && r[3] === "role")!;
    expect(role[2]).toBe("About you");
    expect(role[6]).toBe("Engineering");
    expect(role[7]).toBe("E1");
    const start = long.rows.find((r) => r[0] === "Ana Lopez" && r[3] === "start")!;
    expect(start[2]).toBe("");
  });

  it("keeps the note with its line break on the long row", () => {
    const row = longTable(input).rows.find((r) => r[0] === "Ben Okafor" && r[3] === "satisfaction")!;
    expect(row[8]).toBe(benNote);
  });
});

describe("CSV", () => {
  it("writes a BOM and CRLF line ends, and quotes fields with commas, quotes or line breaks", () => {
    const csv = toCsv({ header: ["a", "b"], rows: [['he said "hi", ok\nnext', "plain"]] });
    expect(csv).toBe('﻿a,b\r\n"he said ""hi"", ok\nnext",plain\r\n');
  });

  it("neutralises formula-like cells but leaves plain numbers alone", () => {
    const csv = toCsv({
      header: ["x"],
      rows: [["=SUM(A1)"], ["+1+1"], ["@cmd"], ["-"], ["\tlead"], ["-3"], ["4.5"]],
    });
    const lines = csv.slice(1).split("\r\n");
    expect(lines[1]).toBe("'=SUM(A1)");
    expect(lines[2]).toBe("'+1+1");
    expect(lines[3]).toBe("'@cmd");
    expect(lines[4]).toBe("'-");
    expect(lines[5]).toBe("'\tlead");
    expect(lines[6]).toBe("-3");
    expect(lines[7]).toBe("4.5");
    expect(csv).not.toContain("'-3");
  });

  it("writes the wide and long files with quoted notes", () => {
    const wide = csvWide(input);
    expect(wide.contentType).toBe("text/csv; charset=utf-8");
    expect((wide.body as string).startsWith("﻿")).toBe(true);
    expect(wide.body).toContain("'=SUM(A1)");
    expect(wide.body).toContain('"Too slow, ""again""\nneeds work"');
    expect(wide.body).toContain("\r\n");
    expect(wide.filename).toBe("kqa-staff-pulse-survey-2026-20261113-wide.csv");

    const long = csvLong(input);
    expect(long.filename).toBe("kqa-staff-pulse-survey-2026-20261113-long.csv");
    expect(long.body).toContain("Email; CRM");
  });
});

describe("JSON", () => {
  it("has no token field and includes progress and display values", () => {
    const file = jsonExport(input);
    expect(file.contentType).toBe("application/json");
    expect(file.body).not.toMatch(/token/i);

    const doc = JSON.parse(file.body as string);
    expect(doc.exportVersion).toBe(1);
    expect(doc.generatedAt).toBe(input.generatedAt);
    expect(doc.survey.version).toBe(3);
    expect(doc.survey.questions).toHaveLength(8);
    expect(doc.interview.name).toBe("Staff pulse survey 2026");

    const [sum, ana, ben] = doc.participants;
    expect(sum.name).toBe("=SUM(A1)");
    expect(ana.progress).toEqual({ answered: 8, total: 8, requiredAnswered: 2, requiredTotal: 2 });
    expect(ben.progress).toEqual({ answered: 1, total: 8, requiredAnswered: 1, requiredTotal: 2 });
    expect(ana.answers.delta).toEqual({ value: -3, display: "-3", updatedAt: T });
    expect(ana.answers.tools.display).toBe("Email; CRM");
    expect(ana.answers.satisfaction.note).toBe("Fine");
    expect(ben.answers.satisfaction.note).toBe(benNote);
    expect(ben.answers.satisfaction.value).toBeUndefined();
    expect(sum.submittedAt).toBeUndefined();
  });
});

describe("XLSX", () => {
  it("writes four sheets with the expected headers and frozen header rows", async () => {
    const file = await xlsxExport(input);
    expect(file.contentType).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(file.filename).toBe("kqa-staff-pulse-survey-2026-20261113.xlsx");
    expect(Buffer.isBuffer(file.body)).toBe(true);

    const wb = new Workbook();
    await wb.xlsx.load(file.body as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "Wide", "Long", "People"]);

    const wide = wb.getWorksheet("Wide")!;
    const wideHeader = (wide.getRow(1).values as unknown[]).slice(1);
    expect(wideHeader).toEqual(expectedHeader);
    expect(wide.views?.[0]?.state).toBe("frozen");
    expect((wide.views?.[0] as { ySplit?: number } | undefined)?.ySplit).toBe(1);
    expect(wide.autoFilter).toBeTruthy();
    // Formula-like names are neutralised in string cells.
    expect(wide.getCell(2, 1).value).toBe("'=SUM(A1)");

    const long = wb.getWorksheet("Long")!;
    expect((long.getRow(1).values as unknown[]).slice(1)).toEqual(longTable(input).header);
    expect(long.views?.[0]?.state).toBe("frozen");
    expect(long.rowCount).toBe(11);

    const people = wb.getWorksheet("People")!;
    expect((people.getRow(1).values as unknown[]).slice(1)[0]).toBe("Person");
    expect(people.views?.[0]?.state).toBe("frozen");
    expect(people.rowCount).toBe(4);

    const summary = wb.getWorksheet("Summary")!;
    const labels = summary.getColumn(1).values as unknown[];
    expect(labels).toContain("People");
    expect(labels).toContain("Question id");
    const summaryRows = Array.from({ length: summary.rowCount }, (_, index) => summary.getRow(index + 1));
    const questionHeader = summaryRows.find((row) => row.getCell(1).value === "Question id");
    expect(questionHeader?.getCell(5).value).toBe("Share with stored answer");
    const roleSummary = summaryRows.find((row) => row.getCell(1).value === "role");
    expect(roleSummary?.getCell(4).value).toBe(2);
    expect(roleSummary?.getCell(5).value).toBeCloseTo(2 / input.participants.length);
    const metricNote = summaryRows.find((row) => row.getCell(1).value === "Metric note");
    expect(metricNote?.getCell(2).value).toContain("not an item response rate");
  });
});

describe("Markdown", () => {
  it("contains section headings, the report title and the 'No answer' line", () => {
    const file = markdownExport(input);
    const md = file.body as string;
    expect(file.contentType).toBe("text/markdown; charset=utf-8");
    expect(md.startsWith("# Staff pulse survey 2026")).toBe(true);
    expect(md).toContain("## General");
    expect(md).toContain("## About you");
    expect(md).toContain("## Your views");
    expect(md).toContain("### Role `role`");
    expect(md).toContain("- **Ana Lopez** (submitted): Engineering");
    expect(md).toContain("  > Fine");
    expect(md).toContain('  > Too slow, "again"');
    expect(md).toContain("No answer: =SUM(A1)");
    expect(md).toContain("## People");
    expect(md).toContain("| Ana Lopez | submitted | 8/8 |");
    expect(file.filename).toBe("kqa-staff-pulse-survey-2026-20261113.md");
  });

  it("escapes markdown-significant characters", () => {
    expect(escapeInline("a|b `c` *d* _e_ #")).toBe("a\\|b \\`c\\` \\*d\\* \\_e\\_ #");
  });
});

describe("filenames and dispatch", () => {
  it("builds slugged, dated filenames for each kind", () => {
    expect(exportFilename(input, "json")).toBe("kqa-staff-pulse-survey-2026-20261113.json");
    expect(exportFilename(input, "csv")).toBe("kqa-staff-pulse-survey-2026-20261113.csv");
    expect(exportFilename(input, "csv-wide")).toBe("kqa-staff-pulse-survey-2026-20261113-wide.csv");
    expect(exportFilename(input, "csv-long")).toBe("kqa-staff-pulse-survey-2026-20261113-long.csv");
    expect(exportFilename(input, "md")).toBe("kqa-staff-pulse-survey-2026-20261113.md");
  });

  it("truncates slugs to 40 characters without a trailing hyphen", () => {
    const slug = slugify("Quarterly  Review: Engineering & Operations Leadership Team 2026!");
    expect(slug).toBe("quarterly-review-engineering-operations");
    expect(slug.length).toBeLessThanOrEqual(40);
    expect(slugify("Ünïcode Café")).toBe("unicode-cafe");
    expect(slugify("!!!")).toBe("interview");
  });

  it("uses the UTC date of generatedAt", () => {
    const late = { ...input, generatedAt: "2026-11-13T23:30:00.000Z" };
    expect(exportFilename(late, "json")).toBe("kqa-staff-pulse-survey-2026-20261113.json");
  });

  it("dispatches every format through exportInterview", async () => {
    const formats = ["json", "csv-wide", "csv-long", "xlsx", "md"] as const;
    const files = await Promise.all(formats.map((f) => exportInterview(input, f)));
    expect(files.map((f) => f.filename)).toEqual([
      "kqa-staff-pulse-survey-2026-20261113.json",
      "kqa-staff-pulse-survey-2026-20261113-wide.csv",
      "kqa-staff-pulse-survey-2026-20261113-long.csv",
      "kqa-staff-pulse-survey-2026-20261113.xlsx",
      "kqa-staff-pulse-survey-2026-20261113.md",
    ]);
  });
});
