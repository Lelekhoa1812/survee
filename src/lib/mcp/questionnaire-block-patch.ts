import { parse, parseFragment } from "parse5";
import type { DefaultTreeAdapterMap } from "parse5";
import { LIMITS, ID_RE, questionSchema, type Question } from "../format/schema";
import { parseJsonWithPositions } from "../diagnostics/jsonpos";

type Node = DefaultTreeAdapterMap["node"];
type Element = DefaultTreeAdapterMap["element"];
type Edit = { start: number; end: number; text: string };
export type QuestionnaireBlockOperation =
  | { op: "add"; question: Question; html: string; beforeQuestionId?: string; afterQuestionId?: string }
  | { op: "update"; questionId: string; question: Question; html: string }
  | { op: "delete"; questionId: string }
  | { op: "move"; questionId: string; section?: string | null; beforeQuestionId?: string; afterQuestionId?: string };
export type QuestionnaireBlockSummary = { op: "add" | "update" | "delete" | "move"; questionId: string; section?: string };

const isElement = (n: Node): n is Element => "tagName" in n;
const kids = (n: Node): Node[] => "childNodes" in n ? n.childNodes as Node[] : [];
const attr = (e: Element, name: string) => e.attrs.find(a => a.name === name)?.value;
const hasOnlyKeys = (value: object, allowed: readonly string[]) => Object.keys(value).every(key => allowed.includes(key));
function walk(root: Node, fn: (e: Element) => void) {
  if (isElement(root)) fn(root);
  kids(root).forEach(n => walk(n, fn));
  const content = (root as unknown as { content?: Node }).content;
  if (isElement(root) && root.tagName === "template" && content) walk(content, fn);
}
function edit(source: string, edits: Edit[]): string {
  edits.sort((a, b) => b.start - a.start);
  for (const e of edits) source = source.slice(0, e.start) + e.text + source.slice(e.end);
  return source;
}
function safeFragment(fragment: string, id: string): { start: number; end: number } | null {
  const doc = parseFragment(fragment, { sourceCodeLocationInfo: true });
  const roots = kids(doc).filter(n => isElement(n));
  if (roots.length !== 1 || kids(doc).some(n => !isElement(n) && "value" in n && String((n as { value?: string }).value).trim())) return null;
  let bad = false, markerCount = 0;
  walk(doc, e => {
    if (e.tagName === "script" || e.attrs.some(a => /^on/i.test(a.name))) bad = true;
    if (attr(e, "data-kqa-question-id") !== undefined) markerCount++;
  });
  const root = roots[0] as Element;
  if (bad || markerCount !== 1 || attr(root, "data-kqa-question-id") !== id) return null;
  const loc = root.sourceCodeLocation;
  return loc ? { start: loc.startOffset, end: loc.endOffset } : null;
}

/** Patch only question manifest entries and their explicitly marked HTML blocks. */
export function patchQuestionnaireBlocks(html: string, operations: readonly QuestionnaireBlockOperation[]):
  { ok: true; html: string; changes: QuestionnaireBlockSummary[] } | { ok: false; error: string } {
  if (!Array.isArray(operations) || operations.length < 1 || operations.length > 50) return { ok: false, error: "Provide between 1 and 50 question operations." };
  if (typeof html !== "string") return { ok: false, error: "The questionnaire HTML must be a string." };
  if (Buffer.byteLength(html, "utf8") > LIMITS.maxFileBytes) return { ok: false, error: "The questionnaire exceeds the file size limit." };
  const seen = new Set<string>();
  const needsOrdering = operations.some(op => op?.op === "move" || (op?.op === "add" && (op.beforeQuestionId !== undefined || op.afterQuestionId !== undefined)));
  let markupBytes = 0;
  for (const op of operations) {
    if (!op || !["add", "update", "delete", "move"].includes(op.op)) return { ok: false, error: "Each operation must be add, update, delete, or move." };
    const q: Question | undefined = op.op === "add" || op.op === "update" ? op.question : undefined;
    const id = op.op === "add" ? q?.id : op.questionId;
    if (typeof id !== "string" || !ID_RE.test(id)) return { ok: false, error: "Each operation needs a valid question id." };
    if (seen.has(id)) return { ok: false, error: `Question ${id} appears more than once.` };
    seen.add(id);
    const before = op.op === "add" || op.op === "move" ? op.beforeQuestionId : undefined;
    const after = op.op === "add" || op.op === "move" ? op.afterQuestionId : undefined;
    if (before !== undefined && after !== undefined) return { ok: false, error: `Question ${id} cannot be placed both before and after another question.` };
    if ((before !== undefined && (typeof before !== "string" || !ID_RE.test(before) || before === id)) || (after !== undefined && (typeof after !== "string" || !ID_RE.test(after) || after === id))) {
      return { ok: false, error: `Question ${id} needs a valid, different insertion target.` };
    }
    if (op.op === "move" && op.section !== undefined && op.section !== null && !ID_RE.test(op.section)) return { ok: false, error: `Question ${id} needs a valid target section.` };
    if (op.op !== "move" && "section" in op && op.section !== undefined) return { ok: false, error: `Only move operations can set a target section.` };
    if (op.op !== "add" && op.op !== "move" && (("beforeQuestionId" in op && op.beforeQuestionId !== undefined) || ("afterQuestionId" in op && op.afterQuestionId !== undefined))) {
      return { ok: false, error: `Only add and move operations can set an insertion target.` };
    }
    if (q) {
      if (op.op === "update" && q.id !== op.questionId) return { ok: false, error: `Question ${op.questionId} cannot change its id.` };
      const valid = questionSchema.strict().safeParse(q);
      if (!valid.success) return { ok: false, error: `Question ${id} is invalid: ${valid.error.issues[0]?.message ?? "invalid shape"}.` };
      if (q.options?.some(option => !hasOnlyKeys(option, ["value", "label"]))) return { ok: false, error: `Question ${id} has an option with unknown fields.` };
      if (q.note && typeof q.note === "object" && !hasOnlyKeys(q.note, ["label", "placeholder", "maxLength"])) return { ok: false, error: `Question ${id} has a note with unknown fields.` };
      if (q.custom) return { ok: false, error: `Custom question ${id} cannot be targeted.` };
      if (typeof op.html !== "string" || !safeFragment(op.html, id)) return { ok: false, error: `Question ${id} needs one safe HTML root marked with its question id.` };
      markupBytes += Buffer.byteLength(op.html, "utf8");
      if (markupBytes > LIMITS.maxFileBytes) return { ok: false, error: "The question markup exceeds the file size limit." };
    }
  }
  const tree = parse(html, { sourceCodeLocationInfo: true });
  const manifests: Element[] = [], lists: Element[] = [], blocks = new Map<string, Element[]>();
  walk(tree, e => {
    if (e.tagName === "script" && attr(e, "id") === "kqa-manifest") manifests.push(e);
    if (e.attrs.some(a => a.name === "data-kqa-question-list")) lists.push(e);
    const id = attr(e, "data-kqa-question-id");
    if (id !== undefined) blocks.set(id, [...(blocks.get(id) ?? []), e]);
  });
  if (manifests.length !== 1) return { ok: false, error: "The questionnaire must have exactly one kqa-manifest script." };
  const manifest = manifests[0]!;
  if (attr(manifest, "type")?.toLowerCase() !== "application/json") return { ok: false, error: "The kqa-manifest must use type=application/json." };
  const ml = manifest.sourceCodeLocation, ms = ml?.startTag?.endOffset, me = ml?.endTag?.startOffset;
  if (ms === undefined || me === undefined) return { ok: false, error: "The kqa-manifest has no editable source range." };
  const json = html.slice(ms, me), parsed = parseJsonWithPositions(json);
  if (!parsed.ok || !parsed.value || typeof parsed.value !== "object" || !Array.isArray((parsed.value as { questions?: unknown }).questions)) return { ok: false, error: "The kqa-manifest questions list is invalid." };
  const qs = (parsed.value as { questions: unknown[] }).questions;
  const ids = new Map<string, number>();
  let duplicateManifestId = false;
  qs.forEach((q, i) => {
    if (!q || typeof q !== "object" || typeof (q as { id?: unknown }).id !== "string") return;
    const id = (q as { id: string }).id;
    if (ids.has(id)) duplicateManifestId = true;
    ids.set(id, i);
  });
  if (duplicateManifestId) return { ok: false, error: "The current manifest contains duplicate question IDs." };
  function insertionPosition(section: string, beforeQuestionId: string | undefined, afterQuestionId: string | undefined, questionId: string): { ok: true; position: number } | { ok: false; error: string } {
    if (beforeQuestionId || afterQuestionId) {
      const targetId = beforeQuestionId ?? afterQuestionId!;
      if (seen.has(targetId)) return { ok: false, error: `Question ${questionId} cannot target ${targetId} because it also appears in this operation batch.` };
      const targetIndex = ids.get(targetId);
      const targetQuestion = targetIndex === undefined ? null : qs[targetIndex] as Question;
      if (!targetQuestion) return { ok: false, error: `Insertion target ${targetId} was not found.` };
      if (!questionSchema.safeParse(targetQuestion).success) return { ok: false, error: `Insertion target ${targetId} is invalid in the current manifest.` };
      const targetSection = targetQuestion.section ?? "";
      if (targetSection !== section) return { ok: false, error: `Insertion target ${targetId} must be in section ${section || "(default)"}.` };
      if (lists.filter(l => attr(l, "data-kqa-question-list") === section).length !== 1) return { ok: false, error: `Section ${section || "(default)"} must have exactly one marked question list.` };
      if ((blocks.get(targetId)?.length ?? 0) !== 1) return { ok: false, error: `Insertion target ${targetId} must have exactly one marked HTML block.` };
      const targetBlock = blocks.get(targetId)![0]!;
      const targetLoc = targetBlock.sourceCodeLocation;
      const targetParent = targetBlock.parentNode;
      if (!targetLoc || !targetParent || !isElement(targetParent) || attr(targetParent, "data-kqa-question-list") !== section) {
        return { ok: false, error: `Insertion target ${targetId} is not a direct child of its marked question list.` };
      }
      return { ok: true, position: beforeQuestionId ? targetLoc.startOffset : targetLoc.endOffset };
    }
    const matchedLists = lists.filter(l => attr(l, "data-kqa-question-list") === section);
    if (matchedLists.length !== 1) return { ok: false, error: `Section ${section || "(default)"} must have exactly one marked question list.` };
    const endTag = matchedLists[0]!.sourceCodeLocation?.endTag;
    if (!endTag) return { ok: false, error: `Section ${section || "(default)"} list has no editable end tag.` };
    return { ok: true, position: endTag.startOffset };
  }
  const edits: Edit[] = [], summaries: QuestionnaireBlockSummary[] = [];
  const deleted = new Set<number>();
  const additions: { question: Question; html: string; section: string; listPosition: number; insertionPosition: number }[] = [];
  for (const op of operations) {
    const q = op.op === "add" || op.op === "update" ? op.question : undefined;
    const id = op.op === "add" ? q!.id : op.questionId;
    const index = ids.get(id);
    if (op.op === "add" ? index !== undefined : index === undefined) return { ok: false, error: op.op === "add" ? `Question ${id} already exists.` : `Question ${id} was not found.` };
    if (op.op === "add") {
      const section = q!.section ?? "";
      const target = insertionPosition(section, op.beforeQuestionId, op.afterQuestionId, id);
      if (!target.ok) return target;
      if (blocks.has(id)) return { ok: false, error: `Question ${id} already has a marked HTML block.` };
      const fragment = safeFragment(op.html, id)!;
      additions.push({ question: q!, html: op.html.slice(fragment.start, fragment.end), section, listPosition: target.position, insertionPosition: target.position });
      summaries.push({ op: "add", questionId: id, section: q!.section });
    } else {
      const old = qs[index!] as Question;
      if (!questionSchema.safeParse(old).success) return { ok: false, error: `Question ${id} is invalid in the current manifest.` };
      if (old.custom) return { ok: false, error: `Custom question ${id} cannot be targeted.` };
      if (op.op === "update" && old.section !== q!.section) return { ok: false, error: `Question ${id} cannot change section.` };
      if ((blocks.get(id)?.length ?? 0) !== 1) return { ok: false, error: `Question ${id} must have exactly one marked HTML block.` };
      const block = blocks.get(id)![0]!, loc = block.sourceCodeLocation;
      const parent = block.parentNode;
      if (!loc || !parent || !isElement(parent) || attr(parent, "data-kqa-question-list") === undefined) return { ok: false, error: `Question ${id} is not a direct child of a marked question list.` };
      const expected = old.section ?? "";
      if (lists.filter(l => attr(l, "data-kqa-question-list") === expected).length !== 1) return { ok: false, error: `Section ${expected || "(default)"} must have exactly one marked question list.` };
      if (attr(parent, "data-kqa-question-list") !== expected) return { ok: false, error: `Question ${id} is in the wrong question list.` };
      if (op.op === "delete") {
        const scriptRef = (e: Element) => e.tagName === "script" && e !== manifest && html.slice(e.sourceCodeLocation?.startOffset ?? 0, e.sourceCodeLocation?.endOffset ?? 0).includes(id);
        let referenced = false; walk(tree, e => { if (scriptRef(e)) referenced = true; });
        if (referenced) return { ok: false, error: `Question ${id} is referenced by an inline script and cannot be deleted safely.` };
      }
      if (op.op === "update") {
        const fragment = safeFragment(op.html, id)!;
        edits.push({ start: loc.startOffset, end: loc.endOffset, text: op.html.slice(fragment.start, fragment.end) });
      } else {
        edits.push({ start: loc.startOffset, end: loc.endOffset, text: "" });
        deleted.add(index!);
      }
      if (op.op === "update") {
        if (!needsOrdering) {
          const from = parsed.starts.get(`questions[${index}]`), to = parsed.ends.get(`questions[${index}]`);
          if (from === undefined || to === undefined) return { ok: false, error: `Could not locate manifest entry for ${id}.` };
          edits.push({ start: ms + from, end: ms + to, text: JSON.stringify(q) });
        }
        summaries.push({ op: "update", questionId: id, section: old.section });
      } else if (op.op === "move") {
        const section = op.section === null ? "" : op.section ?? old.section ?? "";
        const target = insertionPosition(section, op.beforeQuestionId, op.afterQuestionId, id);
        if (!target.ok) return target;
        const movedQuestion: Question = { ...old };
        if (op.section === null) delete movedQuestion.section;
        else if (op.section !== undefined) movedQuestion.section = op.section;
        additions.push({ question: movedQuestion, html: html.slice(loc.startOffset, loc.endOffset), section, listPosition: target.position, insertionPosition: target.position });
        summaries.push({ op: "move", questionId: id, section: movedQuestion.section });
      } else {
        summaries.push({ op: "delete", questionId: id, section: old.section });
      }
    }
  }
  if (qs.length - deleted.size + additions.length < 1) return { ok: false, error: "A questionnaire must keep at least one question." };

  if (needsOrdering) {
    type ManifestEntry = { id: string; question: Question; raw: string };
    const entries: ManifestEntry[] = [];
    for (let index = 0; index < qs.length; index += 1) {
      const question = qs[index] as Question;
      const from = parsed.starts.get(`questions[${index}]`), to = parsed.ends.get(`questions[${index}]`);
      if (from === undefined || to === undefined) return { ok: false, error: `Could not locate manifest entry for ${question.id}.` };
      entries.push({ id: question.id, question, raw: json.slice(from, to) });
    }
    const additionsById = new Map(additions.map((addition) => [addition.question.id, addition]));
    const afterCounts = new Map<string, number>();
    const insertEntry = (entry: ManifestEntry, addition: typeof additions[number], op: (typeof operations)[number]) => {
      const before = op.op === "add" || op.op === "move" ? op.beforeQuestionId : undefined;
      const after = op.op === "add" || op.op === "move" ? op.afterQuestionId : undefined;
      if (before) {
        const index = entries.findIndex((item) => item.id === before);
        entries.splice(index, 0, entry);
      } else if (after) {
        const index = entries.findIndex((item) => item.id === after);
        const count = afterCounts.get(after) ?? 0;
        entries.splice(index + 1 + count, 0, entry);
        afterCounts.set(after, count + 1);
      } else if (op.op === "move") {
        let lastInSection = -1;
        entries.forEach((item, index) => { if ((item.question.section ?? "") === addition.section) lastInSection = index; });
        entries.splice(lastInSection + 1, 0, entry);
      } else {
        entries.push(entry);
      }
    };
    for (const op of operations) {
      const id = op.op === "add" ? op.question.id : op.questionId;
      if (op.op === "update") {
        const index = entries.findIndex((entry) => entry.id === id);
        if (index < 0) return { ok: false, error: `Could not locate manifest entry for ${id}.` };
        entries[index] = { id, question: op.question, raw: JSON.stringify(op.question) };
      } else if (op.op === "delete" || op.op === "move") {
        const index = entries.findIndex((entry) => entry.id === id);
        if (index < 0) return { ok: false, error: `Could not locate manifest entry for ${id}.` };
        const [entry] = entries.splice(index, 1);
        if (op.op === "move") {
          const addition = additionsById.get(id);
          if (!addition) return { ok: false, error: `Could not prepare moved question ${id}.` };
          insertEntry({ id, question: addition.question, raw: JSON.stringify(addition.question) }, addition, op);
        }
      } else {
        const addition = additionsById.get(id);
        if (!addition) return { ok: false, error: `Could not prepare added question ${id}.` };
        insertEntry({ id, question: addition.question, raw: JSON.stringify(addition.question) }, addition, op);
      }
    }
    const start = parsed.starts.get("questions"), end = parsed.ends.get("questions");
    if (start === undefined || end === undefined) return { ok: false, error: "Could not locate manifest questions list." };
    const firstStart = qs.length ? parsed.starts.get("questions[0]") : undefined;
    const lastEnd = qs.length ? parsed.ends.get(`questions[${qs.length - 1}]`) : undefined;
    const prefix = firstStart === undefined ? "" : json.slice(start + 1, firstStart);
    const suffix = lastEnd === undefined ? "" : json.slice(lastEnd, end - 1);
    const separators = qs.slice(0, -1).map((_, index) => {
      const leftEnd = parsed.ends.get(`questions[${index}]`), rightStart = parsed.starts.get(`questions[${index + 1}]`);
      return leftEnd === undefined || rightStart === undefined ? ", " : json.slice(leftEnd, rightStart);
    });
    let manifestQuestions = prefix;
    entries.forEach((entry, index) => {
      if (index > 0) manifestQuestions += separators[index - 1] ?? ", ";
      manifestQuestions += entry.raw;
    });
    manifestQuestions += suffix;
    edits.push({ start: ms + start + 1, end: ms + end - 1, text: manifestQuestions });
  } else {
    // Remove contiguous runs as one source range so adjacent deletions stay valid JSON.
    const deletedIndexes = [...deleted].sort((a, b) => a - b);
    for (let cursor = 0; cursor < deletedIndexes.length;) {
      const first = deletedIndexes[cursor]!;
      let last = first;
      cursor++;
      while (cursor < deletedIndexes.length && deletedIndexes[cursor] === last + 1) last = deletedIndexes[cursor++]!;
      const nextKept = last + 1;
      const from = nextKept < qs.length
        ? parsed.starts.get(`questions[${first}]`)
        : first === 0
          ? parsed.starts.get(`questions[${first}]`)
          : parsed.ends.get(`questions[${first - 1}]`);
      const to = nextKept < qs.length
        ? parsed.starts.get(`questions[${nextKept}]`)
        : parsed.ends.get(`questions[${last}]`);
      if (from === undefined || to === undefined || from > to) return { ok: false, error: "Could not safely locate deleted question entries." };
      edits.push({ start: ms + from, end: ms + to, text: "" });
    }
    if (additions.length) {
      const pos = parsed.starts.get("questions"), end = parsed.ends.get("questions");
      if (pos === undefined || end === undefined) return { ok: false, error: "Could not locate manifest questions list." };
      const close = end - 1, inner = json.slice(pos + 1, close), trail = /\s*$/.exec(inner)?.[0] ?? "", bodyEnd = close - trail.length;
      const keptCount = qs.length - deleted.size;
      const manifestText = `${keptCount ? ", " : ""}${additions.map(({ question }) => JSON.stringify(question)).join(", ")}`;
      edits.push({ start: ms + bodyEnd, end: ms + bodyEnd, text: manifestText });
    }
  }

  let candidate: string;
  if (!needsOrdering) {
    const byListPosition = new Map<number, string[]>();
    for (const addition of additions) byListPosition.set(addition.listPosition, [...(byListPosition.get(addition.listPosition) ?? []), addition.html]);
    for (const [position, fragments] of byListPosition) edits.push({ start: position, end: position, text: `\n${fragments.join("\n")}\n` });
    candidate = edit(html, edits);
  } else {
    const withoutInsertions = edit(html, edits);
    const byPosition = new Map<number, string[]>();
    for (const addition of additions) {
      const shift = edits.reduce((total, item) => item.end <= addition.insertionPosition
        ? total + item.text.length - (item.end - item.start)
        : total, 0);
      const position = addition.insertionPosition + shift;
      byPosition.set(position, [...(byPosition.get(position) ?? []), addition.html]);
    }
    const insertEdits = [...byPosition].map(([position, fragments]) => ({ start: position, end: position, text: `\n${fragments.join("\n")}\n` }));
    candidate = edit(withoutInsertions, insertEdits);
  }
  if (Buffer.byteLength(candidate, "utf8") > LIMITS.maxFileBytes) return { ok: false, error: "The patched questionnaire exceeds the file size limit." };
  return { ok: true, html: candidate, changes: summaries };
}
