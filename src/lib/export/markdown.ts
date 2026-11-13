import { displayValue, isAnswered, progress } from "../format/answers";
import { type Question } from "../format/schema";
import { exportFilename, sortedParticipants } from "./rows";
import type { ExportFile, ExportInput, ExportParticipant } from "./types";

const GENERAL = "General";

/** Escape markdown-significant characters within a line of text. */
export function escapeInline(text: string): string {
  return text.replace(/[\\`*_[\]<>|]/g, "\\$&");
}

/** Escape a line that would otherwise start a heading, list item or ordered list item. */
function escapeLeading(line: string): string {
  return line
    .replace(/^(\s*)#/, "$1\\#")
    .replace(/^(\s*)([-+])(?=\s)/, "$1\\$2")
    .replace(/^(\s*)(\d+)([.)])(?=\s)/, "$1$2\\$3");
}

/** Collapse line breaks so a value fits on one line (headings, table cells). */
function oneLine(text: string): string {
  return text.replace(/\s*\r?\n\s*/g, " ").trim();
}

function cell(text: string): string {
  return escapeInline(oneLine(text));
}

/** Escape each line of a multi-line value, keeping the line breaks. */
function textLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => escapeLeading(escapeInline(line.trimEnd())));
}

interface Group {
  title: string;
  questions: Question[];
}

/** Questions grouped by section in manifest order. Questions without a known section go under "General". */
function groupQuestions(input: ExportInput): Group[] {
  const sections = input.manifest.sections ?? [];
  const questions = input.manifest.questions;
  const groups: Group[] = [];
  const general = questions.filter((q) => !q.section || !sections.some((s) => s.id === q.section));
  if (general.length) groups.push({ title: GENERAL, questions: general });
  for (const s of sections) {
    const inSection = questions.filter((q) => q.section === s.id);
    if (inSection.length) groups.push({ title: s.title, questions: inSection });
  }
  return groups;
}

/** Bullets for one question: one per participant who answered, plus notes, then one "No answer" line. */
function questionBody(q: Question, people: ExportParticipant[]): string[] {
  const bullets: string[] = [];
  const unanswered: string[] = [];
  for (const p of people) {
    const answered = isAnswered(q, p.answers);
    const note = p.answers[q.id]?.note ?? "";
    const hasNote = note.trim() !== "";
    const head = `- **${cell(p.name)}** (${cell(p.status)}): `;
    if (answered) {
      const [first, ...rest] = textLines(displayValue(q, p.answers[q.id]?.value));
      bullets.push(head + first, ...rest.map((l) => `  ${l}`));
    } else {
      unanswered.push(cell(p.name));
      if (hasNote) bullets.push(`${head}_no answer, note only_`);
    }
    if (hasNote) bullets.push(...textLines(note).map((l) => `  > ${l}`));
  }
  const lines: string[] = [];
  if (bullets.length) lines.push(...bullets, "");
  if (unanswered.length) lines.push(`No answer: ${unanswered.join(", ")}`, "");
  return lines;
}

/** A readable report: interview, metadata, one section per survey section, then a people table. */
export function markdownExport(input: ExportInput): ExportFile {
  const people = sortedParticipants(input);
  const submitted = people.filter((p) => p.status === "submitted").length;
  const out: string[] = [];

  out.push(`# ${cell(input.interview.name)}`, "");
  out.push("| Item | Value |", "| --- | --- |");
  out.push(`| Mode | ${cell(input.interview.mode)} |`);
  out.push(`| Status | ${cell(input.interview.status)} |`);
  out.push(`| Survey version | ${input.surveyVersion} |`);
  out.push(`| Generated | ${cell(input.generatedAt)} |`);
  out.push(`| People | ${people.length} |`);
  out.push(`| Submitted | ${submitted} |`, "");

  for (const group of groupQuestions(input)) {
    out.push(`## ${cell(group.title)}`, "");
    for (const q of group.questions) {
      out.push(`### ${cell(q.label)} \`${q.id}\``, "");
      out.push(...questionBody(q, people));
    }
  }

  out.push("## People", "");
  out.push("| Name | Status | Answered | Submitted |", "| --- | --- | --- | --- |");
  for (const p of people) {
    const pr = progress(input.manifest, p.answers);
    out.push(`| ${cell(p.name)} | ${cell(p.status)} | ${pr.answered}/${pr.total} | ${cell(p.submittedAt ?? "")} |`);
  }
  out.push("");

  return {
    filename: exportFilename(input, "md"),
    contentType: "text/markdown; charset=utf-8",
    body: out.join("\n"),
  };
}
