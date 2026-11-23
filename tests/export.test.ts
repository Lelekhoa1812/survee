import { describe, expect, it } from "vitest";
import { Workbook } from "exceljs";
import type { Manifest } from "../src/lib/format/schema";
import { csvLong, csvWide, neutraliseCell, toCsv } from "../src/lib/export/csv";
import { exportFilename, longParticipantRows, longTable, recordTable, slugify, wideParticipantRow, wideTable } from "../src/lib/export/rows";
import { jsonExport } from "../src/lib/export/json";
import { escapeInline, markdownExport } from "../src/lib/export/markdown";
import { exportInterview, ExportOutputSizeLimitError, MAX_EXPORT_OUTPUT_BYTES, XlsxComplexityLimitError, type ExportInput } from "../src/lib/export/index";
import { xlsxExport } from "../src/lib/export/xlsx";
import { MAX_XLSX_EXPORT_CELLS } from "../src/lib/participant-limits";

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
  "start | eligibility",
  "start | Start date",
  "role | eligibility",
  "role | Role",
  "tools | eligibility",
  "tools | Tools used",
  "team | eligibility",
  "team | Team",
  "title | eligibility",
  "title | Job title",
  "comments | eligibility",
  "comments | Comments",
  "delta | eligibility",
  "delta | Headcount change",
  "satisfaction | eligibility",
  "satisfaction | Satisfaction",
  "satisfaction | note",
];

describe("wide table", () => {
  it("has one row per participant and one column per question, with notes where enabled", () => {
    const wide = wideTable(input);
    expect(wide.header).toEqual(expectedHeader);
    expect(wide.header).toHaveLength(22);
    expect(wide.rows).toHaveLength(3);
    for (const row of wide.rows) expect(row).toHaveLength(22);
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

  it("builds streamed wide rows with the same columns and values as the buffered table", () => {
    const columns = wideTable(input).header;
    for (const participant of input.participants) {
      expect(wideParticipantRow(input.manifest, input.surveyVersion, participant)).toEqual(
        wideTable({ ...input, participants: [participant] }).rows[0],
      );
    }
    expect(columns).toEqual(wideTable(input).header);
  });
});

describe("long table", () => {
  it("builds streamed answer rows with the same values as the buffered table", () => {
    for (const participant of input.participants) {
      expect(longParticipantRows(input.manifest, participant)).toEqual(
        longTable({ ...input, participants: [participant] }).rows,
      );
    }
  });

  it("has one row per participant and answered or noted question, skipping empty ones", () => {
    const long = longTable(input);
    expect(long.header).toEqual([
      "Person",
      "Person status",
      "Section",
      "Question id",
      "Question",
      "Type",
      "Current eligibility",
      "Answer",
      "Answer value",
      "Presented option order",
      "Option order version",
      "Row type",
      "Assignment survey version",
      "Assignment algorithm",
      "Question-order group",
      "Assigned question order",
      "Assignment time",
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
    expect(tools[7]).toBe("Email; CRM");
    expect(tools[8]).toBe("a;c");
    const delta = long.rows.find((r) => r[0] === "Ana Lopez" && r[3] === "delta")!;
    expect(delta[8]).toBe("-3");
    const role = long.rows.find((r) => r[0] === "Ana Lopez" && r[3] === "role")!;
    expect(role[2]).toBe("About you");
    expect(role[7]).toBe("Engineering");
    expect(role[8]).toBe("E1");
    const start = long.rows.find((r) => r[0] === "Ana Lopez" && r[3] === "start")!;
    expect(start[2]).toBe("");
  });

  it("keeps the note with its line break on the long row", () => {
    const row = longTable(input).rows.find((r) => r[0] === "Ben Okafor" && r[3] === "satisfaction")!;
    expect(row[17]).toBe(benNote);
  });
});

describe("routed export eligibility", () => {
  it("labels current inactivity while retaining hidden saved answers", () => {
    const routed: Manifest = {
      ...manifest,
      questions: [
        { id: "eligible", type: "single", label: "Continue?", options: [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }] },
        { id: "details", type: "longtext", label: "Details", when: { all: [{ question: "eligible", operator: "equals", value: "yes" }] } },
      ],
    };
    const routedInput: ExportInput = {
      ...input,
      manifest: routed,
      participants: [{
        id: "p-routed", name: "Routed person", status: "submitted", createdAt: T,
        answers: {
          eligible: { value: "no", updatedAt: T },
          details: { value: "Saved before routing changed", updatedAt: T },
        },
      }],
    };
    const wide = wideTable(routedInput);
    expect(wide.rows[0][wide.header.indexOf("details | eligibility")]).toBe("inactive");
    expect(wide.rows[0][wide.header.indexOf("details | Details")]).toBe("Saved before routing changed");
    const long = longTable(routedInput);
    expect(long.rows.find((row) => row[3] === "details")).toContain("inactive");
    expect(long.rows.find((row) => row[3] === "details")).toContain("Saved before routing changed");
    const json = JSON.parse(jsonExport(routedInput).body as string);
    expect(json.participants[0].eligibility.details).toBe("inactive");
    expect(json.participants[0].answers.details.value).toBe("Saved before routing changed");
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

  it("neutralises formula markers after leading controls or spaces, including full-width forms", () => {
    expect(neutraliseCell(" =SUM(A1)")).toBe("' =SUM(A1)");
    expect(neutraliseCell("\n=SUM(A1)")).toBe("'\n=SUM(A1)");
    expect(neutraliseCell("\0@cmd")).toBe("'\0@cmd");
    expect(neutraliseCell("＝1+1")).toBe("'＝1+1");
    expect(neutraliseCell("  -3  ")).toBe("  -3  ");
  });

  it("writes the wide and long files with quoted notes", () => {
    const wide = csvWide(input);
    expect(wide.contentType).toBe("text/csv; charset=utf-8");
    expect((wide.body as string).startsWith("﻿")).toBe(true);
    expect(wide.body).toContain("'=SUM(A1)");
    expect(wide.body).toContain('"Too slow, ""again""\nneeds work"');
    expect(wide.body).toContain("\r\n");
    expect(wide.filename).toBe("kqa-staff-pulse-survey-2026-20261113-wide.csv");
    expect((wide.body as string).indexOf("'=SUM(A1)")).toBeLessThan((wide.body as string).indexOf("Ben Okafor"));
    expect((wide.body as string).indexOf("Ben Okafor")).toBeLessThan((wide.body as string).indexOf("Ana Lopez"));

    const long = csvLong(input);
    expect(long.filename).toBe("kqa-staff-pulse-survey-2026-20261113-long.csv");
    expect(long.body).toContain("Email; CRM");
    expect((long.body as string).indexOf("'=SUM(A1)")).toBeLessThan((long.body as string).indexOf("Ben Okafor"));
    expect((long.body as string).indexOf("Ben Okafor")).toBeLessThan((long.body as string).indexOf("Ana Lopez"));
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
    expect(ana.progress).toEqual({ answered: 8, total: 8, surveyTotal: 8, inactive: 0, requiredAnswered: 2, requiredTotal: 2 });
    expect(ben.progress).toEqual({ answered: 1, total: 8, surveyTotal: 8, inactive: 0, requiredAnswered: 1, requiredTotal: 2 });
    expect(ana.answers.delta).toEqual({ value: -3, display: "-3", updatedAt: T });
    expect(ana.answers.tools.display).toBe("Email; CRM");
    expect(ana.answers.satisfaction.note).toBe("Fine");
    expect(ben.answers.satisfaction.note).toBe(benNote);
    expect(ben.answers.satisfaction.value).toBeUndefined();
    expect(sum.submittedAt).toBeUndefined();
    expect(doc.participants.every((person: Record<string, unknown>) => !Object.hasOwn(person, "recordGroups"))).toBe(true);
  });

  it("exports complete question-order assignments by version even when a group has no answers", () => {
    const orderedManifest: Manifest = {
      ...manifest,
      questionOrderGroups: [{ id: "about-context", questionIds: ["role", "tools"] }],
    };
    const orderedInput: ExportInput = {
      ...input,
      manifest: orderedManifest,
      participants: input.participants.map((person) => person.id === "p-ben" ? {
        ...person,
        questionOrderAssignments: [
          { surveyVersion: 2, algorithmVersion: "kqa-question-order-v1", groups: { "about-context": ["tools", "role"] }, assignedAt: T },
          { surveyVersion: 3, algorithmVersion: "kqa-question-order-v1", groups: { "about-context": ["role", "tools"] }, assignedAt: T },
        ],
      } : person),
    };
    const ben = JSON.parse(jsonExport(orderedInput).body as string).participants.find((person: { id: string }) => person.id === "p-ben");
    expect(ben.questionOrderAssignments).toHaveLength(2);
    expect(ben.questionOrderAssignments[0].groups["about-context"]).toEqual(["tools", "role"]);
    const metadataRows = longTable(orderedInput).rows.filter((row) => row[0] === "Ben Okafor" && row[11] === "presentation");
    expect(metadataRows.map((row) => [row[12], row[14], row[15]])).toEqual([
      ["2", "about-context", "tools;role"],
      ["3", "about-context", "role;tools"],
    ]);
    expect(wideTable(orderedInput).rows.find((row) => row[0] === "Ben Okafor")?.at(-1)).toBe("role;tools");
  });

  it("adds public repeat rows only when present and omits internal revision counters", () => {
    const repeatManifest: Manifest = {
      ...manifest,
      questions: [...manifest.questions, {
        id: "assets", type: "repeat", label: "Assets", maxRows: 5,
        fields: [
          { id: "asset-name", label: "Asset name", type: "text" },
          { id: "condition", label: "Condition", type: "select", options: [{ value: "good", label: "Good" }, { value: "poor", label: "Poor" }] },
        ],
      }],
    };
    const repeatInput: ExportInput = {
      ...input,
      manifest: repeatManifest,
      participants: input.participants.map((person) => person.id === "p-ben" ? {
        ...person,
        recordGroups: {
          assets: [
            { id: "row-opaque-2", values: { "asset-name": "=HYPERLINK(\"https://example.com\")", condition: "good" }, revision: 4, fieldRevisions: { "asset-name": 3, condition: 4 } },
            { id: "row-opaque-1", values: { "asset-name": "" }, revision: 1, fieldRevisions: { "asset-name": 1 } },
          ],
        },
      } : person),
    };
    const doc = JSON.parse(jsonExport(repeatInput).body as string);
    const ben = doc.participants.find((person: { id: string }) => person.id === "p-ben");
    expect(ben.recordGroups.assets).toEqual([
      { id: "row-opaque-2", values: { "asset-name": "=HYPERLINK(\"https://example.com\")", condition: "good" } },
      { id: "row-opaque-1", values: { "asset-name": "" } },
    ]);
    expect(JSON.stringify(ben.recordGroups)).not.toContain("revision");
  });
});

describe("repeat record exports", () => {
  const repeatManifest: Manifest = {
    ...manifest,
    questions: [...manifest.questions, {
      id: "assets", type: "repeat", label: "Assets", maxRows: 5,
      fields: [
        { id: "asset-name", label: "Asset name", type: "text" },
        { id: "condition", label: "Condition", type: "single", options: [{ value: "good", label: "Good" }, { value: "poor", label: "Poor" }] },
      ],
    }],
  };
  const repeatInput: ExportInput = {
    ...input,
    manifest: repeatManifest,
    participants: [{
      ...input.participants[0],
      recordGroups: {
        assets: [
          { id: "row-1", values: { "asset-name": "=SUM(A1)", condition: "good" }, revision: 2, fieldRevisions: { "asset-name": 1, condition: 2 } },
          { id: "row-2", values: {}, revision: 1, fieldRevisions: {} },
        ],
      },
    }],
  };

  it("uses active repeat rows for routed eligibility and participant progress in every export", async () => {
    const routed: ExportInput = {
      ...repeatInput,
      manifest: { ...repeatManifest, questions: [
        repeatManifest.questions.at(-1)!,
        { id: "followup", type: "text", label: "Follow-up", required: true, when: { all: [{ question: "assets", operator: "answered" }] } },
        { id: "empty", type: "text", label: "No assets", when: { all: [{ question: "assets", operator: "notAnswered" }] } },
      ] },
      participants: [{ ...repeatInput.participants[0], answers: { followup: { value: "Reviewed", updatedAt: T } } }],
    };
    const doc = JSON.parse(jsonExport(routed).body as string);
    expect(doc.participants[0].eligibility).toEqual({ assets: "eligible", followup: "eligible", empty: "inactive" });
    expect(doc.participants[0].progress).toMatchObject({ answered: 2, total: 2, inactive: 1, requiredAnswered: 1, requiredTotal: 1 });
    const wide = wideTable(routed);
    expect(wide.rows[0][wide.header.indexOf("followup | eligibility")]).toBe("eligible");
    expect(wide.rows[0][wide.header.indexOf("empty | eligibility")]).toBe("inactive");
    const long = longTable(routed);
    expect(long.rows.find((row) => row[3] === "followup")?.[6]).toBe("eligible");
    expect(long.rows.find((row) => row[3] === "empty")?.[6]).toBe("inactive");
    expect(markdownExport(routed).body).toContain("| Ben Okafor | in\\_progress | 2/2 |");
    expect(markdownExport(routed).body).toContain("### Assets `assets`");
    expect(markdownExport(routed).body).toContain("=SUM(A1)");
    expect(markdownExport(routed).body).toContain("- **Ben Okafor** (in\\_progress): 2 records");
    const workbook = new Workbook();
    await workbook.xlsx.load((await xlsxExport(routed)).body as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
    const summary = workbook.getWorksheet("Summary")!;
    const summaryRows = summary.getSheetValues() as unknown[][];
    expect(summaryRows.find((row) => row?.[1] === "assets")?.slice(4, 7)).toEqual([1, 0, 1]);
    expect(summaryRows.find((row) => row?.[1] === "followup")?.slice(4, 7)).toEqual([1, 0, 1]);
    expect((workbook.getWorksheet("People")!.getRow(2).values as unknown[]).slice(1, 9)).toEqual(["Ben Okafor", "Joined late", "in_progress", 2, 2, 1, 1, 1]);
  });

  it("treats deleted repeat rows as unanswered when inferring exported routes", () => {
    const routed: ExportInput = {
      ...repeatInput,
      manifest: { ...repeatManifest, questions: [
        repeatManifest.questions.at(-1)!,
        { id: "followup", type: "text", label: "Follow-up", required: true, when: { all: [{ question: "assets", operator: "answered" }] } },
        { id: "empty", type: "text", label: "No assets", when: { all: [{ question: "assets", operator: "notAnswered" }] } },
      ] },
      participants: [{ ...repeatInput.participants[0], answers: {}, recordGroups: { assets: [{ id: "deleted", values: {}, revision: 1, fieldRevisions: {}, deletedAt: T }] } }],
    };
    const person = JSON.parse(jsonExport(routed).body as string).participants[0];
    expect(person.eligibility).toEqual({ assets: "eligible", followup: "inactive", empty: "eligible" });
    expect(person.progress).toMatchObject({ answered: 0, total: 2, inactive: 1, requiredTotal: 0 });
    const wide = wideTable(routed);
    expect(wide.rows[0][wide.header.indexOf("followup | eligibility")]).toBe("inactive");
    expect(wide.rows[0][wide.header.indexOf("empty | eligibility")]).toBe("eligible");
  });

  it("creates one normalized row per declared field, preserving order and value presence", () => {
    const table = recordTable(repeatInput);
    expect(table.header).toEqual(["Person id", "Person", "Person status", "Question id", "Question", "Row id", "Row order", "Field id", "Field", "Field type", "Value present", "Value"]);
    expect(table.rows).toHaveLength(4);
    expect(table.rows[0]).toEqual(["p-ben", "Ben Okafor", "in_progress", "assets", "Assets", "row-1", "1", "asset-name", "Asset name", "text", "true", "=SUM(A1)"]);
    expect(table.rows[2]).toMatchObject(["p-ben", "Ben Okafor", "in_progress", "assets", "Assets", "row-2", "2", "asset-name", "Asset name", "text", "false", ""]);
  });

  it("adds a formula-safe Records sheet only for existing rows and leaves CSV cardinality unchanged", async () => {
    const wide = wideTable(repeatInput);
    const long = longTable(repeatInput);
    expect(wide.rows).toHaveLength(1);
    expect(long.rows).toHaveLength(2);
    expect(csvLong(repeatInput).body).not.toContain("row-1");

    const file = await xlsxExport(repeatInput);
    const workbook = new Workbook();
    await workbook.xlsx.load(file.body as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Wide", "Long", "People", "Records"]);
    const records = workbook.getWorksheet("Records")!;
    expect(records.rowCount).toBe(5);
    expect(records.getCell(2, 12).value).toBe("'=SUM(A1)");
    expect(records.getCell(4, 11).value).toBe("false");

    const legacy = await xlsxExport(input);
    const legacyBook = new Workbook();
    await legacyBook.xlsx.load(legacy.body as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
    expect(legacyBook.worksheets.map((sheet) => sheet.name)).toEqual(["Summary", "Wide", "Long", "People"]);
  });

  it("adds a dedicated Presentations sheet with all versioned assignments", async () => {
    const orderedInput: ExportInput = {
      ...input,
      manifest: { ...manifest, questionOrderGroups: [{ id: "about-context", questionIds: ["role", "tools"] }] },
      participants: input.participants.map((person) => person.id === "p-ben" ? {
        ...person,
        questionOrderAssignments: [{ surveyVersion: 2, algorithmVersion: "kqa-question-order-v1", groups: { "about-context": ["tools", "role"] }, assignedAt: T }],
      } : person),
    };
    const file = await xlsxExport(orderedInput);
    const workbook = new Workbook();
    await workbook.xlsx.load(file.body as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toContain("Presentations");
    const presentations = workbook.getWorksheet("Presentations")!;
    expect(presentations.getRow(2).values).toContain("kqa-question-order-v1");
    expect(presentations.getRow(2).values).toContain("tools;role");
  });
});

describe("full-order rank exports", () => {
  const rankManifest: Manifest = {
    ...manifest,
    questions: [...manifest.questions, {
      id: "priorities",
      type: "rank",
      label: "Order priorities",
      options: [{ value: "quality", label: "Quality" }, { value: "speed", label: "Speed" }, { value: "cost", label: "Cost" }],
    }],
  };
  const rankInput: ExportInput = {
    ...input,
    manifest: rankManifest,
    participants: [{
      id: "p-rank", name: "Rank respondent", status: "submitted", createdAt: T,
      answers: { priorities: { value: ["cost", "quality", "speed"], updatedAt: T } },
    }],
  };

  it("preserves the selected permutation in human-readable and raw JSON/CSV values", () => {
    const wide = wideTable(rankInput);
    const rankCell = wide.rows[0][wide.header.indexOf("priorities | Order priorities")];
    expect(rankCell).toBe("1. Cost; 2. Quality; 3. Speed");
    const longRow = longTable(rankInput).rows.find((row) => row[3] === "priorities")!;
    expect(longRow[7]).toBe("1. Cost; 2. Quality; 3. Speed");
    expect(longRow[8]).toBe("cost;quality;speed");
    const json = JSON.parse(jsonExport(rankInput).body as string);
    expect(json.participants[0].answers.priorities).toMatchObject({ value: ["cost", "quality", "speed"], display: "1. Cost; 2. Quality; 3. Speed" });
    expect(csvWide(rankInput).body).toContain("1. Cost; 2. Quality; 3. Speed");
    expect(csvLong(rankInput).body).toContain("cost;quality;speed");
  });

  it("retains the complete rank order in XLSX wide and long sheets", async () => {
    const file = await xlsxExport(rankInput);
    const workbook = new Workbook();
    await workbook.xlsx.load(file.body as unknown as Parameters<Workbook["xlsx"]["load"]>[0]);
    const wide = workbook.getWorksheet("Wide")!;
    const wideHeaders = (wide.getRow(1).values as unknown[]).slice(1);
    const answerColumn = wideHeaders.indexOf("priorities | Order priorities") + 1;
    expect(wide.getRow(2).getCell(answerColumn).value).toBe("1. Cost; 2. Quality; 3. Speed");
    const long = workbook.getWorksheet("Long")!;
    const dataRow = Array.from({ length: long.rowCount - 1 }, (_, index) => long.getRow(index + 2)).find((row) => row.getCell(4).value === "priorities")!;
    expect(dataRow.getCell(8).value).toBe("1. Cost; 2. Quality; 3. Speed");
    expect(dataRow.getCell(9).value).toBe("cost;quality;speed");
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
    expect(questionHeader?.getCell(7).value).toBe("Share of eligible with stored answer");
    const roleSummary = summaryRows.find((row) => row.getCell(1).value === "role");
    expect(roleSummary?.getCell(4).value).toBe(3);
    expect(roleSummary?.getCell(5).value).toBe(0);
    expect(roleSummary?.getCell(6).value).toBe(2);
    expect(roleSummary?.getCell(7).value).toBeCloseTo(2 / input.participants.length);
    const metricNote = summaryRows.find((row) => row.getCell(1).value === "Metric note");
    expect(metricNote?.getCell(2).value).toContain("record historical display");
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

  it("includes repeat-group records as escaped, readable per-person lists", () => {
    const repeatInput: ExportInput = {
      ...input,
      manifest: {
        ...manifest,
        questions: [...manifest.questions, {
          id: "assets",
          type: "repeat",
          label: "Asset inventory",
          section: "views",
          maxRows: 3,
          fields: [
            { id: "name", label: "Asset name", type: "text" },
            { id: "condition", label: "Condition", type: "single", options: [{ value: "ready", label: "Ready" }, { value: "repair", label: "Needs repair" }] },
          ],
        }],
      },
      participants: [
        { ...input.participants[1], recordGroups: { assets: [{ id: "row-1", values: { name: "Old chair | `blue`\nNeeds repair", condition: "repair" }, revision: 1, fieldRevisions: {} }] } },
        { ...input.participants[0], recordGroups: { assets: [] } },
      ],
    };
    const md = markdownExport(repeatInput).body as string;
    expect(md).toContain("### Asset inventory `assets`");
    expect(md).toContain("- **Ana Lopez** (submitted): 1 record");
    expect(md).toContain("  - Record 1");
    expect(md).toContain("**Asset name:** Old chair \\| \\`blue\\` Needs repair");
    expect(md).toContain("**Condition:** Needs repair (repair)");
    expect(md).toContain("- **Ben Okafor** (in\\_progress): no records");
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

  it("rejects a buffered export whose serialized file exceeds the output budget", async () => {
    const oversized = {
      ...input,
      participants: [{
        id: "large", name: "Large answer", status: "submitted" as const, createdAt: T,
        answers: { role: { value: "x".repeat(MAX_EXPORT_OUTPUT_BYTES + 128), updatedAt: T } },
      }],
    };

    await expect(exportInterview(oversized, "json")).rejects.toBeInstanceOf(ExportOutputSizeLimitError);
  });

  it("rejects complex XLSX output before building its workbook", async () => {
    const questions = Array.from({ length: 250 }, (_, index) => ({ id: `q${index}`, type: "text" as const, label: `Question ${index}` }));
    const largeInput: ExportInput = {
      ...input,
      manifest: { format: "kqa/1", title: "Large workbook", questions },
      participants: Array.from({ length: 100 }, (_, personIndex) => ({
        id: `person-${personIndex}`,
        name: `Person ${personIndex}`,
        status: "submitted" as const,
        createdAt: T,
        answers: Object.fromEntries(questions.map((question) => [question.id, { value: "response", updatedAt: T }])),
      })),
    };

    await expect(exportInterview(largeInput, "xlsx")).rejects.toMatchObject({
      name: "XlsxComplexityLimitError",
      limitCells: MAX_XLSX_EXPORT_CELLS,
      estimatedCells: expect.any(Number),
    } satisfies Partial<XlsxComplexityLimitError>);
  });
});
