import { displayValue, evaluateEligibility, isAnswered } from "../format/answers";
import { noteConfig, type AnswerValue, type Manifest, type Question } from "../format/schema";
import type { ExportInput, ExportParticipant } from "./types";

/** A rectangular table of text cells. The first row of `header` names the columns. */
export interface Table {
  header: string[];
  rows: string[][];
}

export interface WideColumn {
  header: string;
  kind: "fixed" | "answer" | "note" | "eligibility" | "presentation-order";
  cell: (p: ExportParticipant) => string;
}

/** Participants sorted by name (case-insensitive), then by creation time. */
export function sortedParticipants(input: ExportInput): ExportParticipant[] {
  return [...input.participants].sort((a, b) => {
    const byName = a.name.localeCompare(b.name, "en", { sensitivity: "base" });
    if (byName !== 0) return byName;
    const byCreated = a.createdAt.localeCompare(b.createdAt);
    if (byCreated !== 0) return byCreated;
    return a.id.localeCompare(b.id);
  });
}

function answerDisplay(q: Question, p: ExportParticipant): string {
  const a = p.answers[q.id];
  return a ? displayValue(q, a.value) : "";
}

/** The columns of the wide table, in order. Shared with the XLSX writer so both agree on layout. */
export function wideColumns(manifest: Manifest, surveyVersion: number): WideColumn[] {
  const eligibilityByParticipant = new WeakMap<ExportParticipant, Record<string, boolean>>();
  const currentEligibility = (p: ExportParticipant, questionId: string) => {
    let eligibility = eligibilityByParticipant.get(p);
    if (!eligibility) {
      eligibility = evaluateEligibility(manifest, p.answers, p.recordGroups);
      eligibilityByParticipant.set(p, eligibility);
    }
    return eligibility[questionId] !== false;
  };
  const cols: WideColumn[] = [
    { header: "Person", kind: "fixed", cell: (p) => p.name },
    { header: "Person note", kind: "fixed", cell: (p) => p.note ?? "" },
    { header: "Status", kind: "fixed", cell: (p) => p.status },
    { header: "Last saved", kind: "fixed", cell: (p) => p.lastSavedAt ?? "" },
    { header: "Submitted", kind: "fixed", cell: (p) => p.submittedAt ?? "" },
  ];
  for (const q of manifest.questions) {
    cols.push({ header: `${q.id} | eligibility`, kind: "eligibility", cell: (p) => currentEligibility(p, q.id) ? "eligible" : "inactive" });
    cols.push({ header: `${q.id} | ${q.label}`, kind: "answer", cell: (p) => answerDisplay(q, p) });
    if (q.randomizeOptions) cols.push({ header: `${q.id} | presented option order`, kind: "presentation-order", cell: (p) => p.answers[q.id]?.presentedOptionOrder?.join(";") ?? "" });
    if (noteConfig(q).enabled) {
      cols.push({ header: `${q.id} | note`, kind: "note", cell: (p) => p.answers[q.id]?.note ?? "" });
    }
  }
  for (const group of manifest.questionOrderGroups ?? []) {
    cols.push({
      header: `${group.id} | assigned question order (survey v${surveyVersion})`,
      kind: "presentation-order",
      cell: (p) => p.questionOrderAssignments?.find((assignment) => assignment.surveyVersion === surveyVersion)?.groups[group.id]?.join(";") ?? "",
    });
  }
  return cols;
}

/** One row per participant; one answer column per question, plus a note column where notes are enabled. */
export function wideTable(input: ExportInput): Table {
  const cols = wideColumns(input.manifest, input.surveyVersion);
  return {
    header: cols.map((c) => c.header),
    rows: sortedParticipants(input).map((p) => cols.map((c) => c.cell(p))),
  };
}

export const LONG_HEADER = [
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
];

/** The raw machine value as text: option values joined with ";", numbers as plain text. */
export function rawValue(value: AnswerValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.join(";");
  return String(value);
}

/** One row per participant and question that has an answer or a note. Empty questions are skipped. */
export function longTable(input: ExportInput): Table {
  const sectionTitles = new Map((input.manifest.sections ?? []).map((s) => [s.id, s.title]));
  const rows: string[][] = [];
  for (const p of sortedParticipants(input)) {
    const eligibility = evaluateEligibility(input.manifest, p.answers, p.recordGroups);
    for (const q of input.manifest.questions) {
      const a = p.answers[q.id];
      const note = a?.note ?? "";
      const hasNote = note.trim() !== "";
      const answered = isAnswered(q, p.answers);
      const eligible = eligibility[q.id] !== false;
      if (eligible && !answered && !hasNote) continue;
      rows.push([
        p.name,
        p.status,
        q.section ? (sectionTitles.get(q.section) ?? "") : "",
        q.id,
        q.label,
        q.type,
        eligible ? "eligible" : "inactive",
        answered ? displayValue(q, a?.value) : "",
        answered ? rawValue(a?.value) : "",
        a?.presentedOptionOrder?.join(";") ?? "",
        a?.optionOrderVersion === undefined ? "" : String(a.optionOrderVersion),
        "answer",
        "",
        "",
        "",
        "",
        "",
        note,
        a?.updatedAt ?? "",
      ]);
    }
    for (const assignment of p.questionOrderAssignments ?? []) {
      for (const [groupId, ids] of Object.entries(assignment.groups)) {
        rows.push([
          p.name, p.status, "", "", "", "presentation-order", "", "", "", "", "",
          "presentation", String(assignment.surveyVersion), assignment.algorithmVersion, groupId, ids.join(";"), assignment.assignedAt, "", "",
        ]);
      }
    }
  }
  return { header: [...LONG_HEADER], rows };
}

/** Normalized, lossless row/field view for repeat-group answers. Existing question tables remain unchanged. */
export function recordTable(input: ExportInput): Table {
  const header = [
    "Person id", "Person", "Person status", "Question id", "Question", "Row id", "Row order",
    "Field id", "Field", "Field type", "Value present", "Value",
  ];
  const rows: string[][] = [];
  for (const person of sortedParticipants(input)) {
    const groups = person.recordGroups ?? {};
    const declaredQuestionIds = input.manifest.questions.filter((question) => question.type === "repeat" && Object.hasOwn(groups, question.id)).map((question) => question.id);
    const declaredIdSet = new Set(declaredQuestionIds);
    const questionIds = [...declaredQuestionIds, ...Object.keys(groups).filter((questionId) => !declaredIdSet.has(questionId)).sort()];
    for (const questionId of questionIds) {
      const records = groups[questionId] ?? [];
      const question = input.manifest.questions.find((candidate) => candidate.id === questionId && candidate.type === "repeat");
      for (const [rowIndex, record] of records.entries()) {
        const declared = question?.fields ?? [];
        const knownIds = new Set(declared.map((field) => field.id));
        const fields = [
          ...declared,
          ...Object.keys(record.values).filter((fieldId) => !knownIds.has(fieldId)).sort().map((id) => ({ id, label: "", type: "unknown" })),
        ];
        for (const field of fields) {
          const present = Object.prototype.hasOwnProperty.call(record.values, field.id);
          const value = present ? record.values[field.id] : undefined;
          rows.push([
            person.id,
            person.name,
            person.status,
            questionId,
            question?.label ?? "",
            record.id,
            String(rowIndex + 1),
            field.id,
            field.label,
            field.type,
            present ? "true" : "false",
            value === undefined ? "" : String(value),
          ]);
        }
      }
    }
  }
  return { header, rows };
}

/** Kinds of export file, used for filenames. */
export type ExportFileKind = "json" | "csv" | "xlsx" | "md" | "csv-wide" | "csv-long";

const EXTENSIONS: Record<ExportFileKind, string> = {
  json: ".json",
  csv: ".csv",
  xlsx: ".xlsx",
  md: ".md",
  "csv-wide": "-wide.csv",
  "csv-long": "-long.csv",
};

/** Lowercase ASCII slug of at most `max` characters, with no leading or trailing hyphen. */
export function slugify(name: string, max = 40): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || "interview";
}

function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10).replaceAll("-", "");
}

/** kqa-<interview slug>-<yyyymmdd of generatedAt, UTC>.<ext>, with -wide or -long before .csv for the CSV variants. */
export function exportFilename(input: ExportInput, kind: ExportFileKind): string {
  return `kqa-${slugify(input.interview.name)}-${utcDay(input.generatedAt)}${EXTENSIONS[kind]}`;
}
