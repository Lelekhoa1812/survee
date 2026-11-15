import { parse } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { ID_RE } from "../format/schema";
import { parseJsonWithPositions } from "../diagnostics/jsonpos";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];

export interface RequiredQuestionChange {
  questionId: string;
  required: boolean;
}

export interface RequiredQuestionChangeSummary extends RequiredQuestionChange {
  beforeRequired: boolean;
}

type Edit = { start: number; end: number; replacement: string };

function isElement(node: Node): node is Element {
  return "tagName" in node;
}

function children(node: Node): Node[] {
  return "childNodes" in node ? node.childNodes as Node[] : [];
}

function attribute(element: Element, name: string): string | undefined {
  return element.attrs.find((item) => item.name === name)?.value;
}

function findManifestScripts(root: Node): Element[] {
  const found: Element[] = [];
  const visit = (node: Node) => {
    if (isElement(node)) {
      if (node.tagName === "script" && attribute(node, "id") === "kqa-manifest") found.push(node);
    }
    for (const child of children(node)) visit(child);
    const content = (node as unknown as { content?: Node }).content;
    if (isElement(node) && node.tagName === "template" && content) visit(content);
  };
  visit(root);
  return found;
}

function propertyInsertion(source: string, objectStart: number, objectEnd: number, keyOffset: number, value: boolean): { offset: number; replacement: string } | null {
  if (source[objectStart] !== "{" || source[objectEnd - 1] !== "}") return null;
  const close = objectEnd - 1;
  const inner = source.slice(objectStart + 1, close);
  const trailing = /[\t \r\n]*$/.exec(inner)?.[0] ?? "";
  const bodyEnd = close - trailing.length;
  const hasProperties = source.slice(objectStart + 1, bodyEnd).trim().length > 0;
  if (!hasProperties) return { offset: close, replacement: `"required": ${String(value)}` };

  const newline = source.includes("\r\n") ? "\r\n" : "\n";
  const keyLineStart = source.lastIndexOf("\n", keyOffset - 1) + 1;
  const keyIndent = source.slice(keyLineStart, keyOffset);
  if (/^[\t ]*$/.test(keyIndent) && inner.includes("\n")) {
    return { offset: bodyEnd, replacement: `,${newline}${keyIndent}"required": ${String(value)}` };
  }
  const spaceAfterComma = inner.includes(", ") ? " " : "";
  return { offset: bodyEnd, replacement: `,${spaceAfterComma}"required": ${String(value)}` };
}

/** Edit only the targeted JSON boolean tokens, preserving every other HTML and manifest byte. */
export function patchRequiredQuestions(
  html: string,
  changes: readonly RequiredQuestionChange[],
): { ok: true; html: string; changes: RequiredQuestionChangeSummary[] } | { ok: false; error: string } {
  if (changes.length === 0 || changes.length > 500) return { ok: false, error: "Provide between 1 and 500 required changes." };
  const seen = new Set<string>();
  for (const change of changes) {
    if (!ID_RE.test(change.questionId)) return { ok: false, error: `Invalid question id: ${change.questionId}.` };
    if (typeof change.required !== "boolean") return { ok: false, error: `required for ${change.questionId} must be true or false.` };
    if (seen.has(change.questionId)) return { ok: false, error: `Question ${change.questionId} appears more than once.` };
    seen.add(change.questionId);
  }

  const document = parse(html, { sourceCodeLocationInfo: true });
  const scripts = findManifestScripts(document);
  if (scripts.length !== 1) return { ok: false, error: "The stored questionnaire must have exactly one kqa-manifest script." };
  const script = scripts[0];
  if (attribute(script, "type")?.toLowerCase() !== "application/json") {
    return { ok: false, error: "The stored kqa-manifest script must use type=application/json." };
  }
  const location = script.sourceCodeLocation;
  const start = location?.startTag?.endOffset;
  const end = location?.endTag?.startOffset;
  if (start === undefined || end === undefined || end < start) {
    return { ok: false, error: "The stored kqa-manifest script has no editable source range." };
  }
  const source = html.slice(start, end);
  const parsed = parseJsonWithPositions(source);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || Array.isArray(parsed.value)) {
    return { ok: false, error: "The stored kqa-manifest is not valid JSON." };
  }
  const root = parsed.value as { questions?: unknown };
  if (!Array.isArray(root.questions)) return { ok: false, error: "The stored kqa-manifest has no questions list." };

  const questionIndexes = new Map<string, number>();
  root.questions.forEach((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return;
    const id = (raw as { id?: unknown }).id;
    if (typeof id === "string") questionIndexes.set(id, index);
  });

  const edits: Edit[] = [];
  const summaries: RequiredQuestionChangeSummary[] = [];
  for (const change of changes) {
    const index = questionIndexes.get(change.questionId);
    if (index === undefined) return { ok: false, error: `Question ${change.questionId} was not found in the current version.` };
    const question = root.questions[index] as Record<string, unknown>;
    const beforeRequired = question.required === true;
    if (beforeRequired === change.required) return { ok: false, error: `Question ${change.questionId} is already ${change.required ? "required" : "optional"}.` };

    const questionPath = `questions[${index}]`;
    if (Object.prototype.hasOwnProperty.call(question, "required")) {
      const valueStart = parsed.starts.get(`${questionPath}.required`);
      const valueEnd = parsed.ends.get(`${questionPath}.required`);
      if (valueStart === undefined || valueEnd === undefined) return { ok: false, error: `Could not locate the required setting for ${change.questionId}.` };
      edits.push({ start: start + valueStart, end: start + valueEnd, replacement: String(change.required) });
    } else {
      const objectStart = parsed.starts.get(questionPath);
      const objectEnd = parsed.ends.get(questionPath);
      const idKeyOffset = parsed.keyStarts.get(`${questionPath}.id`);
      if (objectStart === undefined || objectEnd === undefined || idKeyOffset === undefined) {
        return { ok: false, error: `Could not locate the question manifest entry for ${change.questionId}.` };
      }
      const insertion = propertyInsertion(source, objectStart, objectEnd, idKeyOffset, change.required);
      if (insertion === null) return { ok: false, error: `Could not safely add a required setting for ${change.questionId}.` };
      const point = start + insertion.offset;
      edits.push({ start: point, end: point, replacement: insertion.replacement });
    }
    summaries.push({ ...change, beforeRequired });
  }

  edits.sort((a, b) => b.start - a.start);
  let candidate = html;
  for (const edit of edits) candidate = candidate.slice(0, edit.start) + edit.replacement + candidate.slice(edit.end);
  return { ok: true, html: candidate, changes: summaries };
}
