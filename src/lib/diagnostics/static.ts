/**
 * The static checker. It reads an HTML file the way the server will, without running it, and reports every
 * reason the app could not read the questions or store the answers, in detail and with the fix.
 */
import { parse } from "parse5";
import type { DefaultTreeAdapterMap, ParserError } from "parse5";
import { FORMAT_ID, ID_RE, LIMITS, OPTION_TYPES, OPTION_VALUE_RE, QUESTION_TYPES, isCalendarDate, noteConfig, scaleBounds, type Manifest, type Question } from "../format/schema";
import { entry } from "./catalog";
import { parseJsonWithPositions } from "./jsonpos";
import { CHECKER_VERSION, type CheckStats, type Diagnostic, type Report } from "./types";

type El = DefaultTreeAdapterMap["element"];
type Node = DefaultTreeAdapterMap["node"];

export const ALLOWED_SCRIPT_HOSTS = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com"];
export const ALLOWED_STYLE_HOSTS = ["fonts.googleapis.com", "fonts.gstatic.com", "cdnjs.cloudflare.com"];

const TYPE_HINTS: Record<string, string> = {
  radio: "single", radios: "single", choice: "single", "single-choice": "single", yesno: "single", boolean: "single", bool: "single",
  checkbox: "multi", checkboxes: "multi", multiple: "multi", "multi-choice": "multi", multiselect: "multi",
  dropdown: "select", select: "select",
  input: "text", string: "text", shorttext: "text", "short-text": "text", email: "text",
  textarea: "longtext", paragraph: "longtext", "long-text": "longtext", comment: "longtext", essay: "longtext",
  rating: "scale", likert: "scale", slider: "scale", range: "scale", nps: "scale",
  integer: "number", float: "number", numeric: "number", datetime: "date",
};

function levenshtein(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}
function closest(word: string, candidates: readonly string[]): string | undefined {
  let best: string | undefined;
  let bestD = 3;
  for (const c of candidates) {
    const d = levenshtein(word.toLowerCase(), c.toLowerCase());
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

const QUESTION_KEYS = ["id", "type", "label", "help", "section", "required", "options", "maxSelections", "minSelections", "exclusiveOptions", "randomizeOptions", "fixedOptionValues", "note", "min", "max", "step", "maxLength", "fields", "maxRows", "minRows", "itemLabel", "custom", "when"];
const ROOT_KEYS = ["format", "title", "description", "presentation", "sections", "questionOrderGroups", "questions"];
const SECTION_KEYS = ["id", "title", "description"];
const OPTION_KEYS = ["value", "label"];
const NOTE_KEYS = ["label", "placeholder", "maxLength"];
const WHEN_KEYS = ["all", "any"];
const CONDITION_KEYS = ["question", "operator", "value"];

interface Ctx {
  html: string;
  lineStarts: number[];
  out: Diagnostic[];
}

function offsetToLoc(ctx: Ctx, offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = ctx.lineStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.lineStarts[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - ctx.lineStarts[lo] + 1 };
}

function sourceLine(ctx: Ctx, line: number): string {
  const start = ctx.lineStarts[line - 1] ?? 0;
  const end = ctx.lineStarts[line] !== undefined ? ctx.lineStarts[line] - 1 : ctx.html.length;
  return ctx.html.slice(start, end).replace(/\r$/, "");
}

function contextLines(ctx: Ctx, line: number, radius = 2): string {
  const from = Math.max(1, line - radius);
  const to = Math.min(ctx.lineStarts.length, line + radius);
  const width = String(to).length;
  const rows: string[] = [];
  for (let n = from; n <= to; n++) {
    const text = sourceLine(ctx, n);
    rows.push(`${n === line ? ">" : " "} ${String(n).padStart(width)} | ${text.length > 220 ? text.slice(0, 220) + "…" : text}`);
  }
  return rows.join("\n");
}

interface Extra {
  offset?: number;
  line?: number;
  column?: number;
  path?: string;
  questionId?: string;
  snippet?: string;
}

function add(ctx: Ctx, code: string, message: string, fix: string | undefined, extra: Extra = {}) {
  const e = entry(code);
  let line = extra.line;
  let column = extra.column;
  if (extra.offset !== undefined) ({ line, column } = offsetToLoc(ctx, extra.offset));
  const d: Diagnostic = { code, severity: e.severity, category: e.category, title: e.title, message, fix: fix ?? e.fix };
  if (extra.path) d.path = extra.path;
  if (extra.questionId) d.questionId = extra.questionId;
  if (line !== undefined) {
    const snippet = extra.snippet ?? sourceLine(ctx, line).trim();
    d.location = { line, column: column ?? 1, snippet: snippet.length > 240 ? snippet.slice(0, 240) + "…" : snippet };
    d.context = contextLines(ctx, line);
  }
  ctx.out.push(d);
}

// ------------------------------------------------------------------------------------------------ DOM helpers
const isEl = (n: Node): n is El => "tagName" in n;
const attr = (el: El, name: string): string | undefined => el.attrs.find((a) => a.name === name)?.value;
const hasAttr = (el: El, name: string): boolean => el.attrs.some((a) => a.name === name);
const kids = (n: Node): Node[] => ("childNodes" in n ? (n.childNodes as Node[]) : []);

function textOf(n: Node): string {
  if ("value" in n && typeof (n as { value: unknown }).value === "string") return (n as { value: string }).value;
  return kids(n).map(textOf).join("");
}

interface Found {
  el: El;
  ancestors: El[];
}

function walk(root: Node, visit: (f: Found) => void) {
  const stack: El[] = [];
  const rec = (n: Node) => {
    if (isEl(n)) {
      visit({ el: n, ancestors: [...stack] });
      stack.push(n);
      for (const c of kids(n)) rec(c);
      const content = (n as unknown as { content?: Node }).content;
      if (n.tagName === "template" && content) for (const c of kids(content)) rec(c);
      stack.pop();
    } else for (const c of kids(n)) rec(c);
  };
  rec(root);
}

/** Replace comments and string contents in JavaScript with spaces (keeping line breaks), so keyword scans do not trip over text. */
/** True when a "/" at this point starts a regular expression rather than a division. */
function regexAllowed(before: string): boolean {
  let k = before.length - 1;
  while (k >= 0 && (before[k] === " " || before[k] === "\t")) k--;
  if (k < 0) return true;
  const ch = before[k];
  if ("(,=:[!&|?{};+-*%<>~^".includes(ch) || ch === "\n") return true;
  const word = /([A-Za-z_$][\w$]*)$/.exec(before.slice(Math.max(0, k - 12), k + 1))?.[1];
  return word === "return" || word === "typeof" || word === "case" || word === "in" || word === "of" || word === "void";
}

export function maskJs(src: string): string {
  let out = "";
  let i = 0;
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  while (i < src.length) {
    const c = src[i];
    const n = src[i + 1];
    if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += blank(src.slice(i, stop));
      i = stop;
    } else if (c === "/" && regexAllowed(out)) {
      // a regular expression literal: blank its body so quotes and words inside it are not read as code
      let j = i + 1;
      let inClass = false;
      while (j < src.length && src[j] !== "\n") {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") inClass = true;
        else if (src[j] === "]") inClass = false;
        else if (src[j] === "/" && !inClass) break;
        j++;
      }
      if (src[j] === "/") {
        out += "/" + blank(src.slice(i + 1, j)) + "/";
        i = j + 1;
      } else {
        out += c;
        i++;
      }
    } else if (c === "`") {
      // template literal: the text is blanked, but code inside ${ ... } is kept so calls in it are still seen
      let j = i + 1;
      let o = "`";
      while (j < src.length && src[j] !== "`") {
        if (src[j] === "\\") {
          o += blank(src.slice(j, j + 2));
          j += 2;
        } else if (src[j] === "$" && src[j + 1] === "{") {
          let depth = 1;
          let k = j + 2;
          while (k < src.length && depth > 0) {
            if (src[k] === "{") depth++;
            else if (src[k] === "}") depth--;
            k++;
          }
          o += "  " + maskJs(src.slice(j + 2, k - 1)) + " ";
          j = k;
        } else {
          o += blank(src[j]);
          j++;
        }
      }
      out += o + (src[j] === "`" ? "`" : "");
      i = j + 1;
    } else if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        if (src[j] === "\n") break;
        j++;
      }
      out += c + blank(src.slice(i + 1, j)) + (src[j] === c ? c : "");
      i = j + 1;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

function hostOf(url: string): { host: string; https: boolean } | null {
  try {
    const u = new URL(url, "https://relative.invalid/");
    if (u.hostname === "relative.invalid") return null;
    return { host: u.hostname.toLowerCase(), https: u.protocol === "https:" };
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------ the checker
export interface CheckOptions {
  fileName?: string;
}

export function checkHtml(htmlInput: string, options: CheckOptions = {}): Report {
  const html = htmlInput.replace(/^﻿/, "");
  const lineStarts = [0];
  for (let i = 0; i < html.length; i++) if (html[i] === "\n") lineStarts.push(i + 1);
  const ctx: Ctx = { html, lineStarts, out: [] };
  const bytes = Buffer.byteLength(html, "utf8");
  const stats: CheckStats = {
    bytes, lines: lineStarts.length, questions: 0, sections: 0, boundQuestions: 0, customQuestions: 0, requiredQuestions: 0, scripts: 0, externalResources: [],
  };

  const finish = (manifest?: Manifest): Report => {
    const rank = { error: 0, warning: 1, info: 2 } as const;
    ctx.out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.location?.line ?? 1e9) - (b.location?.line ?? 1e9) || a.code.localeCompare(b.code));
    const counts = { error: 0, warning: 0, info: 0 };
    for (const d of ctx.out) counts[d.severity]++;
    return {
      checkerVersion: CHECKER_VERSION, formatVersion: FORMAT_ID, fileName: options.fileName, checkedAt: new Date().toISOString(),
      ok: counts.error === 0, counts, diagnostics: ctx.out, stats, manifest,
    };
  };

  if (html.trim() === "") {
    add(ctx, "KQA100", "The file has no content.", undefined);
    return finish();
  }
  if (bytes > LIMITS.maxFileBytes) add(ctx, "KQA101", `The file is ${(bytes / 1048576).toFixed(1)} MB; the limit is 3 MB.`, undefined);
  if (html.includes("�")) add(ctx, "KQA102", "The text contains replacement characters (�), so some characters were corrupted before upload.", undefined, { offset: html.indexOf("�") });
  if (!/^\s*<!doctype html/i.test(html)) add(ctx, "KQA103", "The file does not start with <!doctype html>.", undefined, { line: 1 });

  // ---- parse
  const parseErrors: ParserError[] = [];
  const doc = parse(html, { sourceCodeLocationInfo: true, onParseError: (e) => parseErrors.push(e) });
  let eofReported = false;
  let syntaxCount = 0;
  const BENIGN = new Set(["missing-doctype", "control-character-in-input-stream", "noncharacter-in-input-stream", "surrogate-in-input-stream"]);
  const explain: Record<string, string> = {
    "non-void-html-element-start-tag-with-trailing-solidus": "A self-closing slash on an element that cannot self-close (for example <div/>). Browsers ignore the slash, so the element stays open and swallows what follows. Write <div></div>.",
    "end-tag-without-matching-open-element": "A closing tag with no matching opening tag. Remove it or add the opening tag.",
    "duplicate-attribute": "The same attribute appears twice on one tag; the second is ignored.",
    "unexpected-character-in-attribute-name": "A stray character inside a tag (often a missing quote or space).",
    "missing-whitespace-between-attributes": "Two attributes touch each other. A closing quote is probably missing or a space was left out.",
    "unexpected-equals-sign-before-attribute-name": "An equals sign appears where an attribute name should be.",
    "missing-attribute-value": "An attribute has an equals sign but no value.",
    "end-tag-with-attributes": "A closing tag carries attributes.",
    "nested-comment": "A comment opens inside another comment.",
    "incorrectly-closed-comment": "A comment is closed with --!> or similar instead of -->.",
    "abrupt-closing-of-empty-comment": "An empty comment closed too early.",
    "invalid-first-character-of-tag-name": "A < followed by something that is not a tag name. If you meant the symbol, write &lt;.",
    "unexpected-solidus-in-tag": "A stray slash inside a tag.",
  };
  for (const e of parseErrors) {
    if (BENIGN.has(e.code)) continue;
    if (e.code.startsWith("eof-")) {
      if (!eofReported) {
        eofReported = true;
        add(ctx, "KQA112", `The file ends unexpectedly (${e.code.replace(/-/g, " ")}).`, undefined, { line: e.startLine, column: e.startCol });
      }
      continue;
    }
    if (++syntaxCount > 10) continue;
    add(ctx, "KQA110", explain[e.code] ?? `The parser reported "${e.code.replace(/-/g, " ")}".`, undefined, { line: e.startLine, column: e.startCol });
  }
  if (syntaxCount > 10) add(ctx, "KQA110", `${syntaxCount - 10} more HTML syntax problems follow. Fix the ones above first; many are knock-on effects.`, undefined);

  // ---- collect facts from the tree
  const scripts: { el: El; text: string; startLine: number; src?: string; type?: string }[] = [];
  const manifestScripts: El[] = [];
  const dataKqa: Found[] = [];
  const repeatTemplates: Found[] = [];
  const repeatFields: Found[] = [];
  const questionBlocks: Found[] = [];
  const questionLists: Found[] = [];
  const dataNote: Found[] = [];
  const dataStatus: El[] = [];
  const labelsFor = new Map<string, number>();
  const ids = new Map<string, El[]>();
  let htmlEl: El | undefined;
  let hasTitle = false;
  let hasViewport = false;
  let hasH1 = false;
  let hasMain = false;
  const unseenForm: El[] = [];
  const unbound: El[] = [];

  walk(doc, ({ el, ancestors }) => {
    const tag = el.tagName;
    const id = attr(el, "id");
    if (id) ids.set(id, [...(ids.get(id) ?? []), el]);
    if (tag === "html") htmlEl = el;
    if (tag === "title") hasTitle = true;
    if (tag === "h1") hasH1 = true;
    if (tag === "main") hasMain = true;
    if (tag === "meta") {
      if (attr(el, "name")?.toLowerCase() === "viewport") hasViewport = true;
      if (attr(el, "http-equiv")?.toLowerCase() === "refresh") add(ctx, "KQA406", `<meta http-equiv="refresh" content="${attr(el, "content") ?? ""}"> reloads or redirects the page.`, undefined, { offset: el.sourceCodeLocation?.startOffset });
    }
    if (tag === "base") add(ctx, "KQA407", "A <base> element is present.", undefined, { offset: el.sourceCodeLocation?.startOffset });
    if (["iframe", "frame", "object", "embed", "frameset"].includes(tag)) add(ctx, "KQA408", `<${tag}> is not allowed.`, undefined, { offset: el.sourceCodeLocation?.startOffset });
    if (tag === "form") {
      const action = attr(el, "action");
      const method = attr(el, "method")?.toLowerCase();
      if (action || method === "post") add(ctx, "KQA405", `<form${action ? ` action="${action}"` : ""}${method ? ` method="${method}"` : ""}> submits to a URL.`, undefined, { offset: el.sourceCodeLocation?.startOffset });
      else if (!hasAttr(el, "onsubmit")) unseenForm.push(el);
    }
    if (tag === "a") {
      const target = attr(el, "target");
      if (target === "_top" || target === "_parent") add(ctx, "KQA409", `<a target="${target}"> tries to navigate the whole window.`, undefined, { offset: el.sourceCodeLocation?.startOffset });
      const href = (attr(el, "href") ?? "").trim();
      if (href && !href.startsWith("#") && !/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(href)) add(ctx, "KQA409", `<a href="${href}"> points at another page. A questionnaire is a single file, so this opens nothing useful and can lose unsaved input.`, "Link to a section of this page with href=\"#section-id\", or to a full https:// address.", { offset: el.sourceCodeLocation?.startOffset });
      if (hasAttr(el, "download")) add(ctx, "KQA413", "<a download> will do nothing in the frame.", undefined, { offset: el.sourceCodeLocation?.startOffset });
    }
    if (tag === "input" && attr(el, "type")?.toLowerCase() === "file") add(ctx, "KQA415", "An <input type=\"file\"> is present.", undefined, { offset: el.sourceCodeLocation?.startOffset });
    if ((tag === "input" || tag === "option") && !hasAttr(el, "data-kqa") && !hasAttr(el, "data-kqa-repeat-field")) unbound.push(el);
    if (tag === "label") {
      const f = attr(el, "for");
      if (f) labelsFor.set(f, (labelsFor.get(f) ?? 0) + 1);
    }
    if (["img", "video", "audio", "source", "image"].includes(tag)) {
      for (const a of ["src", "srcset", "poster", "href", "xlink:href"]) {
        const v = attr(el, a);
        if (v && /(^|\s)http:\/\//i.test(v)) add(ctx, "KQA411", `<${tag}> loads ${v.trim().split(/\s+/)[0]} over http.`, undefined, { offset: el.sourceCodeLocation?.startOffset });
        else if (v && /(^|\s)(https:)?\/\//i.test(v) && a !== "href" && a !== "xlink:href") add(ctx, "KQA417", `<${tag} ${a}="${v.trim().split(/\s+/)[0].slice(0, 80)}"> loads from the network. Use an embedded image or a stored KQA asset URL.`, undefined, { offset: el.sourceCodeLocation?.startOffset });
        else if (tag === "img" && a === "src" && v && !/^(?:data:image\/|blob:)/i.test(v) && !/^\/api\/assets\/[A-Za-z0-9_-]{43}$/.test(v.trim())) add(ctx, "KQA418", `<img src="${v.slice(0, 100)}"> points at a file that is not stored in KQA.`, undefined, { offset: el.sourceCodeLocation?.startOffset });
      }
    }
    if (tag === "script") {
      const text = textOf(el);
      const loc = el.sourceCodeLocation;
      const startLine = loc?.startTag ? loc.startTag.endLine : 1;
      scripts.push({ el, text, startLine, src: attr(el, "src"), type: attr(el, "type")?.toLowerCase() });
      if (id === "kqa-manifest") manifestScripts.push(el);
    }
    if (tag === "link") {
      const rel = (attr(el, "rel") ?? "").toLowerCase();
      const href = attr(el, "href") ?? "";
      const as = (attr(el, "as") ?? "").toLowerCase();
      const isStyleish = rel.includes("stylesheet") || (rel.includes("preload") && ["style", "font"].includes(as));
      const isScriptish = rel.includes("modulepreload") || (rel.includes("preload") && as === "script");
      if (isStyleish || isScriptish) {
        const h = hostOf(href);
        const allowed = isScriptish ? ALLOWED_SCRIPT_HOSTS : ALLOWED_STYLE_HOSTS;
        if (h) stats.externalResources.push(href);
        if (!h) add(ctx, "KQA401", `<link rel="${rel}" href="${href}"> points at a relative file. The questionnaire must be a single file.`, undefined, { offset: el.sourceCodeLocation?.startOffset });
        else if (!h.https || !allowed.includes(h.host)) add(ctx, "KQA401", `<link href="${href}"> loads from ${h.host}, which is not allowed.`, undefined, { offset: el.sourceCodeLocation?.startOffset });
      }
    }
    if (tag === "style") {
      const css = textOf(el);
      const startLine = el.sourceCodeLocation?.startTag?.endLine ?? 1;
      for (const m of css.matchAll(/@import\s+(?:url\()?\s*['"]?([^'")\s;]+)/gi)) {
        const h = hostOf(m[1]);
        if (h) stats.externalResources.push(m[1]);
        if (!h || !h.https || !ALLOWED_STYLE_HOSTS.includes(h.host)) {
          let nl = 0;
          for (let q = 0; q < (m.index ?? 0); q++) if (css.charCodeAt(q) === 10) nl++;
          const line = startLine + nl;
          add(ctx, "KQA401", `@import "${m[1]}" loads from ${h ? h.host : "a relative path"}, which is not allowed.`, undefined, { line });
        }
      }
      for (const m of css.matchAll(/url\(\s*['"]?(https?:\/\/[^'")\s]+\.(?:png|jpe?g|gif|webp|avif|svg|ico)(?:\?[^'")\s]*)?)/gi)) {
        let nl = 0;
        for (let q = 0; q < (m.index ?? 0); q++) if (css.charCodeAt(q) === 10) nl++;
        add(ctx, "KQA417", `CSS loads an image from ${m[1].slice(0, 80)}. Use a data: URI or a stored KQA asset URL.`, undefined, { line: startLine + nl });
      }
      for (const m of css.matchAll(/@font-face\s*{[^}]*?src\s*:[^;}]*url\(\s*['"]?(https?:[^'")\s]+)/gi)) {
        const h = hostOf(m[1]);
        if (h && !ALLOWED_STYLE_HOSTS.includes(h.host)) {
          const line = startLine + (css.slice(0, m.index).match(/\n/g)?.length ?? 0);
          add(ctx, "KQA401", `A font loads from ${h.host}, which is not allowed. Use Google Fonts or inline a data: font.`, undefined, { line });
        }
      }
    }
    // bindings
    if (hasAttr(el, "data-kqa")) dataKqa.push({ el, ancestors });
    if (hasAttr(el, "data-kqa-repeat-template")) repeatTemplates.push({ el, ancestors });
    if (hasAttr(el, "data-kqa-repeat-field")) repeatFields.push({ el, ancestors });
    if (hasAttr(el, "data-kqa-question-id")) questionBlocks.push({ el, ancestors });
    if (hasAttr(el, "data-kqa-question-list")) questionLists.push({ el, ancestors });
    if (hasAttr(el, "data-kqa-note")) dataNote.push({ el, ancestors });
    if (hasAttr(el, "data-kqa-status")) dataStatus.push(el);
  });

  for (const [id, els] of ids) {
    if (els.length > 1) {
      const first = els[0].sourceCodeLocation?.startOffset;
      for (const el of els.slice(1)) add(ctx, "KQA111", `id="${id}" is used ${els.length} times (first at line ${first !== undefined ? offsetToLoc(ctx, first).line : "?"}).`, undefined, { offset: el.sourceCodeLocation?.startOffset });
    }
  }
  stats.scripts = scripts.filter((s) => s.type !== "application/json").length;

  // ---- scripts: sources and risky APIs
  const jsType = (t?: string) => (t ?? "").split(";")[0].trim();
  const jsScripts = scripts.filter((s) => !jsType(s.type) || ["text/javascript", "application/javascript", "application/x-javascript", "module", "text/babel"].includes(jsType(s.type)));
  for (const s of jsScripts) {
    if (s.src) {
      const h = hostOf(s.src);
      if (h) stats.externalResources.push(s.src);
      if (!h) add(ctx, "KQA400", `<script src="${s.src}"> points at a relative file. The questionnaire must be a single file.`, undefined, { offset: s.el.sourceCodeLocation?.startOffset });
      else if (!h.https || !ALLOWED_SCRIPT_HOSTS.includes(h.host)) add(ctx, "KQA400", `<script src="${s.src}"> loads from ${h.host}, which is not allowed.`, undefined, { offset: s.el.sourceCodeLocation?.startOffset });
      continue;
    }
    const masked = maskJs(s.text);
    // `window.fetch`, `self.location` and `globalThis.alert` are the same calls with a prefix; blank the prefix so the rules below see them
    const bare = masked.replace(/\b(?:window|self|globalThis)\s*\.\s*(?=[A-Za-z_$])/g, (m) => " ".repeat(m.length));
    const starts = [0];
    for (let i = 0; i < masked.length; i++) if (masked[i] === "\n") starts.push(i + 1);
    const lineAt = (idx: number) => {
      let lo = 0;
      let hi = starts.length - 1;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (starts[mid] <= idx) lo = mid;
        else hi = mid - 1;
      }
      return lo;
    };
    const scan = (re: RegExp, code: string, message: (m: RegExpExecArray) => string, text: string = masked) => {
      re.lastIndex = 0;
      const seen = new Set<number>();
      for (let m = re.exec(text); m; m = re.exec(text)) {
        const line = s.startLine + lineAt(m.index);
        if (seen.has(line)) continue;
        seen.add(line);
        if (seen.size > 3) break;
        add(ctx, code, message(m), undefined, { line });
      }
    };
    scan(/(?<![.\w$])(fetch|XMLHttpRequest|WebSocket|EventSource)\b|navigator\s*\.\s*sendBeacon/g, "KQA402", (m) => `The script uses ${m[0]}, which is blocked in the frame.`, bare);
    scan(/\b(localStorage|sessionStorage|indexedDB)\b|document\s*\.\s*cookie/g, "KQA403", (m) => `The script uses ${m[0].replace(/\s+/g, "")}, which is unavailable in the frame.`, bare);
    scan(/(?<![.\w$])(alert|confirm|prompt)\s*\((?!\s*\)\s*\{)/g, "KQA404", (m) => `The script calls ${m[1]}(), which is blocked in the frame.`, bare.replace(/\bfunction\s+(?:alert|confirm|prompt)\b/g, (m2) => " ".repeat(m2.length)));
    scan(/\bwindow\s*\.\s*print\s*\(|(?<![.\w$])print\s*\(\s*\)/g, "KQA412", () => "The script calls print().");
    scan(/\b(?:window|top|parent|document)\s*\.\s*location\b|(?<![.\w$])location\s*(?:\.\s*(?:href|assign|replace)\s*[=(]|=(?!=))|\bwindow\s*\.\s*open\s*\(|\btop\s*\.\s*location|\blocation\s*\.\s*reload\s*\(/g, "KQA409", (m) => `The script navigates with ${m[0].replace(/\s+/g, "")}.`, masked.replace(/\b(?:self|globalThis)(\s*\.)/g, "window$1"));
    scan(/URL\s*\.\s*createObjectURL|(?<![\w$.])(?<!let\s)(?<!var\s)(?<!const\s)download\s*=(?!=)|\.\s*download\s*=(?!=)/g, "KQA413", (m) => `The script appears to start a download (${m[0].replace(/\s+/g, "")}).`);
    scan(/(?<![.\w$])eval\s*\(|(?:new\s+)?(?<![.\w$])Function\s*\(/g, "KQA414", (m) => `The script uses ${m[0].replace(/\s+/g, " ")}.`, bare);
  }
  const allMasked = jsScripts.filter((s) => !s.src).map((s) => maskJs(s.text)).join("\n");
  const scriptSetsAnswers = /\bKQA\s*\.\s*(set|setNote)\s*\(/.test(allMasked);
  if (unseenForm.length && !/\bsubmit\b/.test(allMasked)) {
    for (const f of unseenForm) add(ctx, "KQA416", "A <form> without action will still try to submit (and reload the frame) when someone presses Enter in a field. No script handles the submit event.", "Remove the <form> wrapper, or add form.addEventListener(\"submit\", e => e.preventDefault()).", { offset: f.sourceCodeLocation?.startOffset });
  }

  // ---- page quality
  const htmlLang = htmlEl ? attr(htmlEl, "lang")?.trim() : undefined;
  if (htmlEl && !htmlLang) add(ctx, "KQA501", "<html> has no non-empty lang value.", undefined, { offset: htmlEl.sourceCodeLocation?.startOffset });
  else if (htmlLang && !/^en(?:-|$)/i.test(htmlLang)) {
    add(ctx, "KQA505", `The questionnaire declares lang="${htmlLang}". This identifies the language of the questionnaire for assistive technology. KQA's shell currently supports en-AU, Vietnamese, Spanish, and Arabic, but vi/es/ar wording is a machine-drafted first release awaiting qualified native-speaker and in-context review. The shell locale does not translate questionnaire content or host-provided notices. Review the full intended-language journey and arrange qualified language review before field use.`, undefined, { offset: htmlEl?.sourceCodeLocation?.startOffset });
  }
  if (!hasViewport) add(ctx, "KQA502", "No <meta name=\"viewport\"> was found.", undefined);
  if (!hasTitle) add(ctx, "KQA503", "No <title> was found.", undefined);
  if (!hasH1 || !hasMain) add(ctx, "KQA504", `${!hasH1 ? "No <h1>" : "No <main>"} was found.`, undefined);

  // ---- manifest
  if (manifestScripts.length === 0) {
    const jsonScript = scripts.find((s) => s.type === "application/json");
    const hint = jsonScript ? ` A JSON script without id="kqa-manifest" was found at line ${jsonScript.el.sourceCodeLocation?.startLine ?? "?"}; add the id to it.` : "";
    add(ctx, "KQA200", `No <script type="application/json" id="kqa-manifest"> exists.${hint}`, undefined);
    return finish();
  }
  if (manifestScripts.length > 1) {
    for (const s of manifestScripts.slice(1)) add(ctx, "KQA201", `A second manifest starts at line ${s.sourceCodeLocation?.startLine}.`, undefined, { offset: s.sourceCodeLocation?.startOffset });
  }
  const mScript = manifestScripts[0];
  const mType = attr(mScript, "type")?.toLowerCase();
  if (mType !== "application/json") {
    add(ctx, "KQA203", `The manifest script has type="${mType ?? "(none)"}". It must be type="application/json", otherwise the browser tries to run it as JavaScript.`, 'Set type="application/json" on the script.', { offset: mScript.sourceCodeLocation?.startOffset, path: "(script type)" });
  }
  const textNode = kids(mScript)[0] as (Node & { sourceCodeLocation?: { startOffset: number } }) | undefined;
  const mText = textOf(mScript);
  const mBase = textNode?.sourceCodeLocation?.startOffset ?? (mScript.sourceCodeLocation?.startTag?.endOffset ?? 0);
  if (mText.trim() === "") {
    add(ctx, "KQA202", "The manifest script is empty.", "Put the manifest JSON inside the script element.", { offset: mScript.sourceCodeLocation?.startOffset });
    return finish();
  }
  const parsed = parseJsonWithPositions(mText);
  if (!parsed.ok) {
    add(ctx, "KQA202", parsed.message + ".", undefined, { offset: mBase + parsed.offset });
    return finish();
  }
  const at = (path: string): number => mBase + (parsed.starts.get(path) ?? 0);
  const keyAt = (path: string): number => mBase + (parsed.keyStarts.get(path) ?? parsed.starts.get(path) ?? 0);

  const manifest = validateManifest(parsed.value, { ctx, at, keyAt, stats });
  const bound = manifest ? checkBindings(manifest, { ctx, dataKqa, repeatTemplates, repeatFields, questionBlocks, questionLists, dataNote, dataStatus, labelsFor, scriptSetsAnswers, stats, unbound, at }) : undefined;
  void bound;
  return finish(manifest);
}

// ------------------------------------------------------------------------------------------------ manifest rules
interface MCtx {
  ctx: Ctx;
  at: (path: string) => number;
  keyAt: (path: string) => number;
  stats: CheckStats;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function checkUnknownKeys(obj: Record<string, unknown>, allowed: string[], path: string, m: MCtx) {
  for (const k of Object.keys(obj)) {
    if (allowed.includes(k)) continue;
    const near = closest(k, allowed);
    add(m.ctx, "KQA216", `"${k}" is not a field of the format${path ? ` (in ${path})` : ""}. It is ignored.${near ? ` Did you mean "${near}"?` : ""}`, near ? `Rename "${k}" to "${near}", or delete it.` : `Delete "${k}".`, { offset: m.keyAt(path ? `${path}.${k}` : k), path: path ? `${path}.${k}` : k });
  }
}

function str(v: unknown, path: string, m: MCtx, opts: { code?: string; min?: number; max: number; optional?: boolean; label: string }): string | undefined {
  if (v === undefined) {
    if (!opts.optional) add(m.ctx, opts.code ?? "KQA203", `${opts.label} is required but missing.`, `Add ${opts.label}.`, { offset: m.at(path.replace(/\.[^.[]+$/, "")) , path });
    return undefined;
  }
  if (typeof v !== "string") {
    add(m.ctx, opts.code ?? "KQA203", `${opts.label} must be text, found ${Array.isArray(v) ? "an array" : typeof v}.`, undefined, { offset: m.at(path), path });
    return undefined;
  }
  if (v.trim().length < (opts.min ?? 1)) {
    add(m.ctx, opts.code ?? "KQA203", `${opts.label} is empty.`, undefined, { offset: m.at(path), path });
    return undefined;
  }
  if (v.length > opts.max) add(m.ctx, "KQA203", `${opts.label} is ${v.length} characters; the maximum is ${opts.max}.`, `Shorten ${opts.label} to ${opts.max} characters or fewer.`, { offset: m.at(path), path });
  return v;
}

function validateManifest(raw: unknown, m: MCtx): Manifest | undefined {
  const { ctx } = m;
  if (!isObj(raw)) {
    add(ctx, "KQA203", "The manifest must be a JSON object ({ … }).", undefined, { offset: m.at(""), path: "(root)" });
    return undefined;
  }
  checkUnknownKeys(raw, ROOT_KEYS, "", m);
  if (raw.format !== FORMAT_ID) {
    add(ctx, "KQA204", raw.format === undefined ? `"format" is missing.` : `"format" is ${JSON.stringify(raw.format)}; it must be exactly "${FORMAT_ID}".`, `Set "format": "${FORMAT_ID}".`, { offset: raw.format === undefined ? m.at("") : m.at("format"), path: "format" });
  }
  str(raw.title, "title", m, { max: LIMITS.maxTitle, label: '"title"' });
  if (raw.description !== undefined) str(raw.description, "description", m, { max: LIMITS.maxDescription, label: '"description"', optional: true });
  if (raw.presentation !== undefined && raw.presentation !== "all" && raw.presentation !== "guided" && raw.presentation !== "guided-question") {
    add(ctx, "KQA203", '"presentation" must be "all", "guided", or "guided-question".', undefined, { offset: m.at("presentation"), path: "presentation" });
  }
  if (raw.presentation === "guided" && (!Array.isArray(raw.sections) || raw.sections.length === 0)) {
    add(ctx, "KQA220", '"presentation": "guided" requires at least one declared section.', 'Add sections and assign every question to one of them, or use "presentation": "all".', { offset: m.at("presentation"), path: "presentation" });
  }

  // sections
  const sectionIds = new Set<string>();
  const usedSections = new Set<string>();
  if (raw.sections !== undefined) {
    if (!Array.isArray(raw.sections)) add(ctx, "KQA203", '"sections" must be an array.', undefined, { offset: m.at("sections"), path: "sections" });
    else {
      m.stats.sections = raw.sections.length;
      if (raw.sections.length > LIMITS.maxSections) add(ctx, "KQA203", `There are ${raw.sections.length} sections; the maximum is ${LIMITS.maxSections}.`, undefined, { offset: m.at("sections"), path: "sections" });
      raw.sections.forEach((s, i) => {
        const p = `sections[${i}]`;
        if (!isObj(s)) return void add(ctx, "KQA203", `${p} must be an object.`, undefined, { offset: m.at(p), path: p });
        checkUnknownKeys(s, SECTION_KEYS, p, m);
        if (typeof s.id !== "string" || !ID_RE.test(s.id)) {
          add(ctx, "KQA206", `Section id ${JSON.stringify(s.id)} is not valid.${typeof s.id === "string" ? ` Suggested: "${slug(s.id)}".` : ""}`, undefined, { offset: m.at(`${p}.id`), path: `${p}.id` });
        } else if (sectionIds.has(s.id)) add(ctx, "KQA207", `Section id "${s.id}" is used more than once.`, "Give each section a unique id.", { offset: m.at(`${p}.id`), path: `${p}.id` });
        else sectionIds.add(s.id);
        str(s.title, `${p}.title`, m, { max: LIMITS.maxLabel, label: `${p}.title` });
      });
    }
  }

  // questions
  if (!Array.isArray(raw.questions)) {
    add(ctx, raw.questions === undefined ? "KQA205" : "KQA203", raw.questions === undefined ? '"questions" is missing.' : '"questions" must be an array.', undefined, { offset: m.at(raw.questions === undefined ? "" : "questions"), path: "questions" });
    return undefined;
  }
  const qs = raw.questions;
  m.stats.questions = qs.length;
  if (qs.length === 0) add(ctx, "KQA205", '"questions" is empty.', undefined, { offset: m.at("questions"), path: "questions" });
  if (qs.length > LIMITS.maxQuestions) add(ctx, "KQA213", `There are ${qs.length} questions; the maximum is ${LIMITS.maxQuestions}.`, undefined, { offset: m.at("questions"), path: "questions" });
  const seen = new Map<string, number>();
  const earlierQuestions = new Map<string, { type: unknown; values: Set<string>; min?: unknown; max?: unknown }>();
  qs.forEach((q, i) => {
    const p = `questions[${i}]`;
    if (!isObj(q)) return void add(ctx, "KQA203", `${p} must be an object.`, undefined, { offset: m.at(p), path: p });
    checkUnknownKeys(q, QUESTION_KEYS, p, m);
    const qid = typeof q.id === "string" ? q.id : undefined;
    if (qid === undefined || !ID_RE.test(qid)) {
      add(ctx, "KQA206", `Question id ${JSON.stringify(q.id)} is not valid.${qid ? ` Suggested: "${slug(qid)}" (and change data-kqa="${qid}" in the markup to match).` : ""}`, undefined, { offset: q.id === undefined ? m.at(p) : m.at(`${p}.id`), path: `${p}.id` });
    } else if (seen.has(qid)) {
      add(ctx, "KQA207", `Question id "${qid}" is also used by questions[${seen.get(qid)}].`, `Rename one of them, and update its data-kqa attributes.`, { offset: m.at(`${p}.id`), path: `${p}.id`, questionId: qid });
    } else seen.set(qid, i);

    const label = typeof q.label === "string" ? q.label : undefined;
    if (!label || label.trim() === "") add(ctx, "KQA215", `${p}${qid ? ` (${qid})` : ""} has no label.`, undefined, { offset: m.at(p), path: `${p}.label`, questionId: qid });
    else if (label.length > LIMITS.maxLabel) add(ctx, "KQA203", `${p}.label is ${label.length} characters; the maximum is ${LIMITS.maxLabel}.`, "Shorten the label and move detail into \"help\".", { offset: m.at(`${p}.label`), path: `${p}.label`, questionId: qid });
    if (q.help !== undefined) str(q.help, `${p}.help`, m, { max: LIMITS.maxHelp, label: `${p}.help`, optional: true });

    const type = q.type;
    if (typeof type !== "string" || !(QUESTION_TYPES as readonly string[]).includes(type)) {
      const guess = typeof type === "string" ? TYPE_HINTS[type.toLowerCase()] ?? closest(type, QUESTION_TYPES) : undefined;
      add(ctx, "KQA208", `${p}${qid ? ` (${qid})` : ""} has type ${JSON.stringify(type)}.${guess ? ` Did you mean "${guess}"?` : ""} Supported: ${QUESTION_TYPES.join(", ")}.`, guess ? `Change "type" to "${guess}".` : undefined, { offset: type === undefined ? m.at(p) : m.at(`${p}.type`), path: `${p}.type`, questionId: qid });
    }
    const t = type as string;

    if (q.section !== undefined) {
      if (typeof q.section !== "string" || !sectionIds.has(q.section)) {
        add(ctx, "KQA211", `${p}${qid ? ` (${qid})` : ""} uses section ${JSON.stringify(q.section)}, but ${sectionIds.size ? `the declared sections are: ${[...sectionIds].join(", ")}` : `"sections" is empty or missing`}.`, undefined, { offset: m.at(`${p}.section`), path: `${p}.section`, questionId: qid });
      } else usedSections.add(q.section);
    }
    if (raw.presentation === "guided" && (typeof q.section !== "string" || !sectionIds.has(q.section))) {
      add(ctx, "KQA220", `Question "${qid ?? `questions[${i}]`}" must belong to a declared section in guided presentation.`, 'Set "section" to a declared section id, or use "presentation": "all".', { offset: q.section === undefined ? m.at(p) : m.at(`${p}.section`), path: `${p}.section`, questionId: qid });
    }
    if (q.required !== undefined && typeof q.required !== "boolean") add(ctx, "KQA203", `${p}.required must be true or false, found ${JSON.stringify(q.required)}.`, undefined, { offset: m.at(`${p}.required`), path: `${p}.required`, questionId: qid });
    if (q.required === true) m.stats.requiredQuestions++;
    if (q.custom !== undefined && typeof q.custom !== "boolean") add(ctx, "KQA203", `${p}.custom must be true or false.`, undefined, { offset: m.at(`${p}.custom`), path: `${p}.custom`, questionId: qid });
    if (t === "repeat") {
      const fields = Array.isArray(q.fields) ? q.fields : [];
      if (!fields.length || fields.length > LIMITS.maxRepeatFields) add(ctx, "KQA203", `${p}.fields must contain 1 to ${LIMITS.maxRepeatFields} repeat fields.`, undefined, { offset: m.at(`${p}.fields`), path: `${p}.fields`, questionId: qid });
      const maxRows = typeof q.maxRows === "number" ? q.maxRows : undefined;
      const minRows = typeof q.minRows === "number" ? q.minRows : undefined;
      if (maxRows === undefined || !Number.isInteger(maxRows) || maxRows < 1 || maxRows > LIMITS.maxRepeatRows) add(ctx, "KQA203", `${p}.maxRows must be a whole number from 1 to ${LIMITS.maxRepeatRows}.`, undefined, { offset: m.at(`${p}.maxRows`), path: `${p}.maxRows`, questionId: qid });
      if (q.minRows !== undefined && (minRows === undefined || !Number.isInteger(minRows) || minRows < 0 || minRows > LIMITS.maxRepeatRows || maxRows !== undefined && minRows > maxRows)) add(ctx, "KQA203", `${p}.minRows must be a whole number from 0 through maxRows.`, undefined, { offset: m.at(`${p}.minRows`), path: `${p}.minRows`, questionId: qid });
      if (q.itemLabel !== undefined && (typeof q.itemLabel !== "string" || !q.itemLabel.trim() || q.itemLabel.length > 80)) add(ctx, "KQA203", `${p}.itemLabel must be non-empty text up to 80 characters.`, undefined, { offset: m.at(`${p}.itemLabel`), path: `${p}.itemLabel`, questionId: qid });
      const fieldIds = new Set<string>();
      fields.forEach((field, j) => {
        const fp = `${p}.fields[${j}]`;
        if (!isObj(field)) return void add(ctx, "KQA203", `${fp} must be an object.`, undefined, { offset: m.at(fp), path: fp, questionId: qid });
        checkUnknownKeys(field, ["id", "label", "help", "type", "required", "options", "min", "max", "step", "maxLength"], fp, m);
        if (typeof field.id !== "string" || !ID_RE.test(field.id)) add(ctx, "KQA206", `${fp}.id must be a valid field id.`, undefined, { offset: m.at(`${fp}.id`), path: `${fp}.id`, questionId: qid });
        else if (fieldIds.has(field.id)) add(ctx, "KQA207", `${fp}.id "${field.id}" is duplicated in this repeat group.`, undefined, { offset: m.at(`${fp}.id`), path: `${fp}.id`, questionId: qid });
        else fieldIds.add(field.id);
        str(field.label, `${fp}.label`, m, { max: LIMITS.maxLabel, label: `${fp}.label`, code: "KQA215" });
        const fieldTypes = ["single", "select", "text", "longtext", "number", "scale", "date"];
        if (typeof field.type !== "string" || !fieldTypes.includes(field.type)) add(ctx, "KQA208", `${fp}.type must be one of ${fieldTypes.join(", ")}.`, undefined, { offset: m.at(`${fp}.type`), path: `${fp}.type`, questionId: qid });
        if (field.help !== undefined) str(field.help, `${fp}.help`, m, { max: LIMITS.maxHelp, label: `${fp}.help`, optional: true });
        if (field.required !== undefined && typeof field.required !== "boolean") add(ctx, "KQA203", `${fp}.required must be true or false.`, undefined, { offset: m.at(`${fp}.required`), path: `${fp}.required`, questionId: qid });
        if (["single", "select"].includes(String(field.type)) && (!Array.isArray(field.options) || field.options.length < 2)) add(ctx, "KQA209", `${fp} needs at least two options.`, undefined, { offset: m.at(`${fp}.options`), path: `${fp}.options`, questionId: qid });
        if (!(["single", "select"].includes(String(field.type))) && field.options !== undefined) add(ctx, "KQA209", `${fp}.options only applies to single and select repeat fields.`, undefined, { offset: m.at(`${fp}.options`), path: `${fp}.options`, questionId: qid });
        if (Array.isArray(field.options)) {
          if (field.options.length > LIMITS.maxOptions) add(ctx, "KQA209", `${fp}.options has ${field.options.length} entries; the maximum is ${LIMITS.maxOptions}.`, undefined, { offset: m.at(`${fp}.options`), path: `${fp}.options`, questionId: qid });
          const optionValues = new Set<string>();
          field.options.forEach((option, k) => {
            const op = `${fp}.options[${k}]`;
            if (!isObj(option)) return void add(ctx, "KQA209", `${op} must be an object with value and label.`, undefined, { offset: m.at(op), path: op, questionId: qid });
            checkUnknownKeys(option, OPTION_KEYS, op, m);
            if (typeof option.value !== "string" || !OPTION_VALUE_RE.test(option.value)) add(ctx, "KQA210", `${op}.value must be a valid option value.`, undefined, { offset: m.at(`${op}.value`), path: `${op}.value`, questionId: qid });
            else if (optionValues.has(option.value)) add(ctx, "KQA210", `${op}.value "${option.value}" is duplicated.`, undefined, { offset: m.at(`${op}.value`), path: `${op}.value`, questionId: qid });
            else optionValues.add(option.value);
            str(option.label, `${op}.label`, m, { max: LIMITS.maxLabel, label: `${op}.label`, code: "KQA215" });
          });
        }
        if ((field.type === "number" || field.type === "scale") && field.min !== undefined && field.max !== undefined && typeof field.min === "number" && typeof field.max === "number" && field.min > field.max) add(ctx, "KQA212", `${fp}.min cannot exceed max.`, undefined, { offset: m.at(`${fp}.min`), path: `${fp}.min`, questionId: qid });
        if ((field.type === "number" || field.type === "scale") && field.step !== undefined && (typeof field.step !== "number" || field.step <= 0)) add(ctx, "KQA212", `${fp}.step must be greater than zero.`, undefined, { offset: m.at(`${fp}.step`), path: `${fp}.step`, questionId: qid });
        if (!(["number", "scale"].includes(String(field.type))) && (field.min !== undefined || field.max !== undefined || field.step !== undefined)) add(ctx, "KQA216", `${fp} uses min/max/step, which apply only to number or scale fields.`, undefined, { offset: m.at(fp), path: fp, questionId: qid });
        if (field.maxLength !== undefined && (typeof field.maxLength !== "number" || !Number.isInteger(field.maxLength) || field.maxLength < 1 || field.maxLength > (field.type === "text" ? LIMITS.textMax : LIMITS.longtextMax) || !["text", "longtext"].includes(String(field.type)))) add(ctx, "KQA203", `${fp}.maxLength is invalid for this repeat field type.`, undefined, { offset: m.at(`${fp}.maxLength`), path: `${fp}.maxLength`, questionId: qid });
      });
    }

    // options
    const wantsOptions = (OPTION_TYPES as readonly string[]).includes(t);
    if (wantsOptions) {
      if (!Array.isArray(q.options) || q.options.length < 2) {
        add(ctx, "KQA209", `${p}${qid ? ` (${qid})` : ""} is a "${t}" question but ${q.options === undefined ? "has no" : Array.isArray(q.options) ? `has only ${q.options.length}` : "has an invalid"} "options" list. It needs at least two.`, undefined, { offset: q.options === undefined ? m.at(p) : m.at(`${p}.options`), path: `${p}.options`, questionId: qid });
      } else {
        if (q.options.length > LIMITS.maxOptions) add(ctx, "KQA209", `${p}.options has ${q.options.length} entries; the maximum is ${LIMITS.maxOptions}.`, undefined, { offset: m.at(`${p}.options`), path: `${p}.options`, questionId: qid });
        if (t === "rank" && q.options.length > LIMITS.maxRankOptions) add(ctx, "KQA209", `${p}.options has ${q.options.length} entries; ranking supports at most ${LIMITS.maxRankOptions}.`, undefined, { offset: m.at(`${p}.options`), path: `${p}.options`, questionId: qid });
        const vals = new Map<string, number>();
        q.options.forEach((o, j) => {
          const op = `${p}.options[${j}]`;
          if (!isObj(o)) return void add(ctx, "KQA209", `${op} must be an object like { "value": "…", "label": "…" }.`, undefined, { offset: m.at(op), path: op, questionId: qid });
          checkUnknownKeys(o, OPTION_KEYS, op, m);
          if (typeof o.value !== "string" || !OPTION_VALUE_RE.test(o.value)) {
            add(ctx, "KQA210", `${op}.value ${JSON.stringify(o.value)} is not valid.${typeof o.value === "string" ? ` Suggested: "${slug(o.value)}".` : ""}`, undefined, { offset: o.value === undefined ? m.at(op) : m.at(`${op}.value`), path: `${op}.value`, questionId: qid });
          } else if (vals.has(o.value)) add(ctx, "KQA210", `${op}.value "${o.value}" repeats options[${vals.get(o.value)}].`, "Make every option value unique.", { offset: m.at(`${op}.value`), path: `${op}.value`, questionId: qid });
          else vals.set(o.value, j);
          str(o.label, `${op}.label`, m, { max: LIMITS.maxLabel, label: `${op}.label`, code: "KQA215" });
        });
      }
    } else if (q.options !== undefined && typeof type === "string" && (QUESTION_TYPES as readonly string[]).includes(type)) {
      add(ctx, "KQA209", `${p}${qid ? ` (${qid})` : ""} is a "${t}" question, which cannot have "options".`, `Delete "options", or change the type to single, multi or select.`, { offset: m.at(`${p}.options`), path: `${p}.options`, questionId: qid });
    }

    if (q.maxSelections !== undefined) {
      if (t !== "multi") {
        add(ctx, "KQA219", `${p}.maxSelections applies only to a multi question.`, "Use it only with type \"multi\", or remove it.", { offset: m.at(`${p}.maxSelections`), path: `${p}.maxSelections`, questionId: qid });
      } else if (!Number.isInteger(q.maxSelections) || (q.maxSelections as number) < 1 || (q.maxSelections as number) > LIMITS.maxOptions || (Array.isArray(q.options) && (q.maxSelections as number) > q.options.length)) {
        const maximum = Array.isArray(q.options) ? q.options.length : LIMITS.maxOptions;
        add(ctx, "KQA219", `${p}.maxSelections must be a whole number from 1 to the number of declared options (at most ${maximum}).`, "Set maxSelections to a valid option count.", { offset: m.at(`${p}.maxSelections`), path: `${p}.maxSelections`, questionId: qid });
      }
    }
    if (q.minSelections !== undefined) {
      const optionCount = Array.isArray(q.options) ? q.options.length : LIMITS.maxOptions;
      if (t !== "multi" || !Number.isInteger(q.minSelections) || (q.minSelections as number) < 1 || (q.minSelections as number) > LIMITS.maxOptions || (Array.isArray(q.options) && (q.minSelections as number) > optionCount) || (typeof q.maxSelections === "number" && (q.minSelections as number) > q.maxSelections)) {
        const maximum = Math.min(optionCount, typeof q.maxSelections === "number" && Number.isInteger(q.maxSelections) ? q.maxSelections : LIMITS.maxOptions);
        add(ctx, "KQA222", `${p}.minSelections must be a whole number from 1 to ${maximum} and applies only to multi questions.`, "Set a valid minimum that does not exceed the available options or maxSelections.", { offset: m.at(`${p}.minSelections`), path: `${p}.minSelections`, questionId: qid });
      }
    }
    if (q.exclusiveOptions !== undefined) {
      const values = Array.isArray(q.options) ? new Set(q.options.filter(isObj).map((option) => option.value).filter((value): value is string => typeof value === "string")) : new Set<string>();
      const exclusive = Array.isArray(q.exclusiveOptions) ? q.exclusiveOptions : [];
      if (t !== "multi" || !Array.isArray(q.exclusiveOptions) || exclusive.length === 0 || exclusive.some((value) => typeof value !== "string" || !OPTION_VALUE_RE.test(value)) || new Set(exclusive).size !== exclusive.length || exclusive.some((value) => !values.has(value))) {
        add(ctx, "KQA221", `${p}.exclusiveOptions must be a non-empty list of unique values declared in this multi question's options.`, 'Use "exclusiveOptions" only on a multi question and list declared option values.', { offset: m.at(`${p}.exclusiveOptions`), path: `${p}.exclusiveOptions`, questionId: qid });
      }
    }
    if (q.randomizeOptions !== undefined && typeof q.randomizeOptions !== "boolean") {
      add(ctx, "KQA223", `${p}.randomizeOptions must be true or false.`, "Set it to true only for an unordered nominal choice list, or remove it.", { offset: m.at(`${p}.randomizeOptions`), path: `${p}.randomizeOptions`, questionId: qid });
    }
    if (q.fixedOptionValues !== undefined) {
      const values = Array.isArray(q.options) ? new Set(q.options.filter(isObj).map((option) => option.value).filter((value): value is string => typeof value === "string")) : new Set<string>();
      const fixed = Array.isArray(q.fixedOptionValues) ? q.fixedOptionValues : [];
      const validFixed = Array.isArray(q.fixedOptionValues) && fixed.every((value) => typeof value === "string" && OPTION_VALUE_RE.test(value)) && new Set(fixed).size === fixed.length && fixed.every((value) => values.has(value));
      if (!validFixed || q.randomizeOptions !== true) add(ctx, "KQA223", `${p}.fixedOptionValues requires randomizeOptions: true and a unique list of declared option values.`, "Mark only choices that must stay in their authored positions, such as an explicitly identified nonresponse option.", { offset: m.at(`${p}.fixedOptionValues`), path: `${p}.fixedOptionValues`, questionId: qid });
    }
    if (q.randomizeOptions === true) {
      const fixed = Array.isArray(q.fixedOptionValues) ? new Set(q.fixedOptionValues.filter((value): value is string => typeof value === "string")) : new Set<string>();
      const movableCount = Array.isArray(q.options) ? new Set(q.options.filter(isObj).map((option) => option.value).filter((value): value is string => typeof value === "string" && !fixed.has(value))).size : 0;
      if (!["single", "multi", "select"].includes(t) || movableCount < 2) add(ctx, "KQA223", `${p}.randomizeOptions applies only to single, multi, or select questions and needs at least two movable options.`, "Use it for unordered nominal options only; keep scales, rankings and inherently ordered choices in their designed order.", { offset: m.at(`${p}.randomizeOptions`), path: `${p}.randomizeOptions`, questionId: qid });
    }

    // ranges
    for (const k of ["min", "max", "step"] as const) {
      if (q[k] !== undefined && (typeof q[k] !== "number" || !Number.isFinite(q[k] as number))) add(ctx, "KQA212", `${p}.${k} must be a number, found ${JSON.stringify(q[k])}.`, undefined, { offset: m.at(`${p}.${k}`), path: `${p}.${k}`, questionId: qid });
    }
    const min = typeof q.min === "number" ? q.min : undefined;
    const max = typeof q.max === "number" ? q.max : undefined;
    if (t === "scale") {
      const lo = min ?? 1;
      const hi = max ?? 5;
      if (!Number.isSafeInteger(lo) || !Number.isSafeInteger(hi) || hi <= lo || hi - lo > LIMITS.scaleSpanMax) add(ctx, "KQA212", `${p}${qid ? ` (${qid})` : ""} is a scale from ${lo} to ${hi}. Scales use safely representable whole numbers, min below max, and at most ${LIMITS.scaleSpanMax} steps.`, undefined, { offset: m.at(p), path: p, questionId: qid });
    } else if (t === "number") {
      if (min !== undefined && max !== undefined && min >= max) add(ctx, "KQA212", `${p}${qid ? ` (${qid})` : ""} has min ${min} which is not below max ${max}.`, undefined, { offset: m.at(p), path: p, questionId: qid });
    } else if (typeof type === "string" && (q.min !== undefined || q.max !== undefined || q.step !== undefined)) {
      add(ctx, "KQA216", `${p}${qid ? ` (${qid})` : ""} sets min/max/step, which only apply to "number" and "scale" questions. They are ignored.`, "Delete min, max and step.", { offset: m.at(p), path: p, questionId: qid });
    }
    if (typeof q.step === "number" && q.step <= 0) add(ctx, "KQA212", `${p}.step must be greater than zero.`, undefined, { offset: m.at(`${p}.step`), path: `${p}.step`, questionId: qid });
    if (q.maxLength !== undefined && (typeof q.maxLength !== "number" || !Number.isInteger(q.maxLength) || q.maxLength < 1 || q.maxLength > LIMITS.longtextMax)) add(ctx, "KQA203", `${p}.maxLength must be a whole number from 1 to ${LIMITS.longtextMax}.`, undefined, { offset: m.at(`${p}.maxLength`), path: `${p}.maxLength`, questionId: qid });

    // note
    if (q.note !== undefined) {
      if (isObj(q.note)) checkUnknownKeys(q.note, NOTE_KEYS, `${p}.note`, m);
      else if (typeof q.note !== "boolean") add(ctx, "KQA203", `${p}.note must be true, false or an object { label, placeholder, maxLength }.`, undefined, { offset: m.at(`${p}.note`), path: `${p}.note`, questionId: qid });
    }

    // Conditions are intentionally shallow and can only inspect an earlier choice question.
    if (q.when !== undefined) {
      const wp = `${p}.when`;
      if (!isObj(q.when)) {
        add(ctx, "KQA218", `${wp} must be an object with a non-empty "all" and/or "any" list.`, undefined, { offset: m.at(wp), path: wp, questionId: qid });
      } else {
        checkUnknownKeys(q.when, WHEN_KEYS, wp, m);
        const when = q.when;
        const hasAll = Array.isArray(when.all) && when.all.length > 0;
        const hasAny = Array.isArray(when.any) && when.any.length > 0;
        if (!hasAll && !hasAny) add(ctx, "KQA218", `${wp} must contain at least one non-empty "all" or "any" list.`, undefined, { offset: m.at(wp), path: wp, questionId: qid });
        for (const group of ["all", "any"] as const) {
          const list = when[group];
          if (list === undefined) continue;
          if (!Array.isArray(list)) {
            add(ctx, "KQA218", `${wp}.${group} must be an array of conditions.`, undefined, { offset: m.at(`${wp}.${group}`), path: `${wp}.${group}`, questionId: qid });
            continue;
          }
          if (list.length === 0) add(ctx, "KQA218", `${wp}.${group} cannot be empty.`, undefined, { offset: m.at(`${wp}.${group}`), path: `${wp}.${group}`, questionId: qid });
          if (list.length > 20) add(ctx, "KQA218", `${wp}.${group} has ${list.length} conditions; the maximum is 20.`, undefined, { offset: m.at(`${wp}.${group}`), path: `${wp}.${group}`, questionId: qid });
          list.forEach((condition, j) => {
            const cp = `${wp}.${group}[${j}]`;
            if (!isObj(condition)) return void add(ctx, "KQA218", `${cp} must be an object with question, operator and value.`, undefined, { offset: m.at(cp), path: cp, questionId: qid });
            checkUnknownKeys(condition, CONDITION_KEYS, cp, m);
            const ref = typeof condition.question === "string" ? condition.question : undefined;
            const op = condition.operator;
            const value = condition.value;
            if (!ref || !ID_RE.test(ref)) {
              add(ctx, "KQA218", `${cp}.question must be a valid earlier question id.`, undefined, { offset: m.at(`${cp}.question`), path: `${cp}.question`, questionId: qid });
            } else if (!earlierQuestions.has(ref)) {
              add(ctx, "KQA218", `${cp} refers to "${ref}", which must be declared before this question.`, undefined, { offset: m.at(`${cp}.question`), path: `${cp}.question`, questionId: qid });
            }
            const answerStateOp = op === "answered" || op === "notAnswered";
            const choiceOp = op === "equals" || op === "notEquals" || op === "contains" || op === "notContains";
            const typedOp = op === "lt" || op === "lte" || op === "gt" || op === "gte" || op === "eq" || op === "ne";
            if (!answerStateOp && !choiceOp && !typedOp) {
              add(ctx, "KQA218", `${cp}.operator must be a choice comparison, a typed comparison ("lt", "lte", "gt", "gte", "eq", "ne"), "answered" or "notAnswered".`, undefined, { offset: m.at(`${cp}.operator`), path: `${cp}.operator`, questionId: qid });
            }
            if (answerStateOp && value !== undefined) {
              add(ctx, "KQA218", `${cp}.value is not used with "${op}".`, `Remove the value property from this answer-state condition.`, { offset: m.at(`${cp}.value`), path: `${cp}.value`, questionId: qid });
            } else if (choiceOp && (typeof value !== "string" || !OPTION_VALUE_RE.test(value))) {
              add(ctx, "KQA218", `${cp}.value must be a valid option value.`, undefined, { offset: m.at(`${cp}.value`), path: `${cp}.value`, questionId: qid });
            }
            const source = ref ? earlierQuestions.get(ref) : undefined;
            if (source && choiceOp) {
              const multiOp = op === "contains" || op === "notContains";
              if (multiOp ? source.type !== "multi" : source.type !== "single" && source.type !== "select") {
                add(ctx, "KQA218", `${cp} uses "${op}" with ${source.type}; contains operators require a multi question, and equals operators require single or select. Ranked choices support answer-state conditions only.`, undefined, { offset: m.at(`${cp}.operator`), path: `${cp}.operator`, questionId: qid });
              }
              if (typeof value === "string" && !source.values.has(value)) {
                add(ctx, "KQA218", `${cp}.value "${value}" is not an option of earlier question "${ref}".`, undefined, { offset: m.at(`${cp}.value`), path: `${cp}.value`, questionId: qid });
              }
            }
            if (typedOp && source) {
              if (source.type === "number" || source.type === "scale") {
                if (typeof value !== "number" || !Number.isFinite(value)) {
                  add(ctx, "KQA218", `${cp}.value must be a finite number for a ${source.type} comparison.`, undefined, { offset: m.at(`${cp}.value`), path: `${cp}.value`, questionId: qid });
                } else {
                  if (source.type === "scale" && !Number.isInteger(value)) add(ctx, "KQA218", `${cp}.value must be a whole number for a scale comparison.`, undefined, { offset: m.at(`${cp}.value`), path: `${cp}.value`, questionId: qid });
                  const min = source.type === "scale" ? (typeof source.min === "number" ? source.min : 1) : source.min;
                  const max = source.type === "scale" ? (typeof source.max === "number" ? source.max : 5) : source.max;
                  if (source.type === "scale" && (typeof min === "number" && value < min || typeof max === "number" && value > max)) add(ctx, "KQA218", `${cp}.value must be within the declared scale range.`, undefined, { offset: m.at(`${cp}.value`), path: `${cp}.value`, questionId: qid });
                }
              } else if (source.type === "date") {
                if (typeof value !== "string" || !isCalendarDate(value)) add(ctx, "KQA218", `${cp}.value must be a real calendar date in YYYY-MM-DD form.`, undefined, { offset: m.at(`${cp}.value`), path: `${cp}.value`, questionId: qid });
              } else {
                add(ctx, "KQA218", `${cp} uses a typed comparison with ${String(source.type)}; typed comparisons require number, scale or date questions.`, undefined, { offset: m.at(`${cp}.operator`), path: `${cp}.operator`, questionId: qid });
              }
            }
          });
        }
      }
    }
    if (qid && !earlierQuestions.has(qid)) {
      const values = new Set<string>();
      if (Array.isArray(q.options)) for (const option of q.options) if (isObj(option) && typeof option.value === "string") values.add(option.value);
      earlierQuestions.set(qid, { type, values, min: q.min, max: q.max });
    }
  });

  // Question-order variation is opt-in and restricted to adjacent, independent root questions.
  if (raw.questionOrderGroups !== undefined) {
    const groupPath = "questionOrderGroups";
    if (!Array.isArray(raw.questionOrderGroups)) {
      add(ctx, "KQA224", '"questionOrderGroups" must be an array.', undefined, { offset: m.at(groupPath), path: groupPath });
    } else {
      const groups = raw.questionOrderGroups;
      const groupIds = new Set<string>();
      const memberGroup = new Map<string, string>();
      const questionIndexes = new Map<string, number>();
      for (const [index, item] of qs.entries()) if (isObj(item) && typeof item.id === "string") questionIndexes.set(item.id, index);
      if (groups.length > Math.floor(LIMITS.maxQuestions / 2)) add(ctx, "KQA224", `"questionOrderGroups" has ${groups.length} groups; the maximum is ${Math.floor(LIMITS.maxQuestions / 2)}.`, undefined, { offset: m.at(groupPath), path: groupPath });
      if (raw.presentation === "guided" || raw.presentation === "guided-question") add(ctx, "KQA224", '"questionOrderGroups" is supported only when presentation is "all".', 'Remove questionOrderGroups or use the default full-page presentation; guided question presentation keeps authored order.', { offset: m.at("presentation"), path: "presentation" });
      groups.forEach((item, groupIndex) => {
        const path = `${groupPath}[${groupIndex}]`;
        if (!isObj(item)) return void add(ctx, "KQA224", `${path} must be an object with an id and questionIds.`, undefined, { offset: m.at(path), path });
        checkUnknownKeys(item, ["id", "questionIds"], path, m);
        if (typeof item.id !== "string" || !ID_RE.test(item.id)) add(ctx, "KQA224", `${path}.id must be a valid stable id.`, undefined, { offset: m.at(`${path}.id`), path: `${path}.id` });
        else if (groupIds.has(item.id)) add(ctx, "KQA224", `Question-order group id "${item.id}" is repeated.`, "Give each group a unique stable id.", { offset: m.at(`${path}.id`), path: `${path}.id` });
        else groupIds.add(item.id);
        if (!Array.isArray(item.questionIds) || item.questionIds.length < 2 || item.questionIds.length > LIMITS.maxQuestions) {
          add(ctx, "KQA224", `${path}.questionIds must contain between 2 and ${LIMITS.maxQuestions} question ids.`, undefined, { offset: m.at(`${path}.questionIds`), path: `${path}.questionIds` });
          return;
        }
        const ids = item.questionIds;
        const validIds = ids.filter((id): id is string => typeof id === "string" && ID_RE.test(id));
        if (validIds.length !== ids.length) add(ctx, "KQA224", `${path}.questionIds contains an invalid question id.`, undefined, { offset: m.at(`${path}.questionIds`), path: `${path}.questionIds` });
        if (new Set(validIds).size !== ids.length) add(ctx, "KQA224", `${path}.questionIds contains a duplicate id.`, undefined, { offset: m.at(`${path}.questionIds`), path: `${path}.questionIds` });
        for (const id of validIds) {
          if (!questionIndexes.has(id)) add(ctx, "KQA224", `${path} refers to unknown question "${id}".`, undefined, { offset: m.at(`${path}.questionIds`), path: `${path}.questionIds` });
          if (memberGroup.has(id)) add(ctx, "KQA224", `Question "${id}" belongs to more than one question-order group.`, undefined, { offset: m.at(`${path}.questionIds`), path: `${path}.questionIds` });
          else memberGroup.set(id, typeof item.id === "string" ? item.id : path);
        }
        const indexes = validIds.map((id) => questionIndexes.get(id)).filter((value): value is number => value !== undefined).sort((a, b) => a - b);
        if (indexes.length === validIds.length && indexes[indexes.length - 1] - indexes[0] + 1 !== indexes.length) add(ctx, "KQA224", `${path}.questionIds must be a contiguous run in manifest order.`, "List adjacent, independent questions only; questions outside the group keep their authored position.", { offset: m.at(`${path}.questionIds`), path: `${path}.questionIds` });
        const authored = [...validIds].sort((a, b) => (questionIndexes.get(a) ?? 0) - (questionIndexes.get(b) ?? 0));
        if (authored.some((id, index) => id !== validIds[index])) add(ctx, "KQA224", `${path}.questionIds must follow the authored manifest order.`, "List the group question ids in their canonical manifest order.", { offset: m.at(`${path}.questionIds`), path: `${path}.questionIds` });
        const members = validIds.map((id) => { const index = questionIndexes.get(id); return index === undefined ? undefined : qs[index]; }).filter(isObj);
        if (members.length === validIds.length && members.length) {
          const section = members[0].section;
          if (members.some((question) => question.section !== section)) add(ctx, "KQA224", `${path} questions must all belong to the same section (or all be unsectioned).`, undefined, { offset: m.at(`${path}.questionIds`), path: `${path}.questionIds` });
          members.forEach((question, memberIndex) => {
            const id = validIds[memberIndex];
            if (question.custom === true) add(ctx, "KQA224", `Question "${id}" is custom and cannot be moved safely.`, "Use a standard question block for randomized groups.", { offset: m.at(`questions[${questionIndexes.get(id)}].custom`), path: `questions[${questionIndexes.get(id)}].custom`, questionId: id });
            if (question.when !== undefined) add(ctx, "KQA224", `Question "${id}" has routing conditions and cannot be randomized.`, undefined, { offset: m.at(`questions[${questionIndexes.get(id)}].when`), path: `questions[${questionIndexes.get(id)}].when`, questionId: id });
          });
        }
      });
      if (memberGroup.size) {
        qs.forEach((item, questionIndex) => {
          if (!isObj(item) || !isObj(item.when)) return;
          for (const conditionList of [item.when.all, item.when.any]) {
            if (!Array.isArray(conditionList)) continue;
            for (const condition of conditionList) {
              if (isObj(condition) && typeof condition.question === "string" && memberGroup.has(condition.question)) {
                add(ctx, "KQA224", `Question "${condition.question}" is a routing source and cannot be reordered safely.`, "Remove the question-order group or the routing dependency.", { offset: m.at(`questions[${questionIndex}].when`), path: `questions[${questionIndex}].when`, questionId: typeof item.id === "string" ? item.id : undefined });
              }
            }
          }
        });
      }
    }
  }
  for (const id of sectionIds) if (!usedSections.has(id)) add(ctx, "KQA217", `Section "${id}" has no questions.`, undefined, { offset: m.at(`sections[${(raw.sections as { id: string }[]).findIndex((s) => s.id === id)}]`), path: "sections" });

  // return a typed manifest only when nothing structural is broken, so later checks can trust the shape
  const structuralErrors = ctx.out.some((d) => d.category === "manifest" && d.severity === "error");
  return structuralErrors ? undefined : (raw as unknown as Manifest);
}

function slug(s: string): string {
  const out = s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return out || "question";
}

// ------------------------------------------------------------------------------------------------ bindings
interface BCtx {
  ctx: Ctx;
  dataKqa: Found[];
  repeatTemplates: Found[];
  repeatFields: Found[];
  questionBlocks: Found[];
  questionLists: Found[];
  dataNote: Found[];
  dataStatus: El[];
  labelsFor: Map<string, number>;
  scriptSetsAnswers: boolean;
  stats: CheckStats;
  /** inputs and options that carry no data-kqa, used to point at a control that was probably forgotten */
  unbound: El[];
  /** offset of a manifest path in the file, so findings about a question can point at its entry */
  at: (path: string) => number;
}

const TEXT_INPUT_TYPES = new Set(["text", "email", "url", "tel", "search", ""]);

function elementKind(el: El): string {
  if (el.tagName === "input") return `input:${(attr(el, "type") ?? "text").toLowerCase()}`;
  return el.tagName;
}

function hasLabel(el: El, ancestors: El[], labelsFor: Map<string, number>): boolean {
  if (attr(el, "aria-label")?.trim() || attr(el, "aria-labelledby")?.trim() || attr(el, "title")?.trim()) return true;
  const id = attr(el, "id");
  if (id && labelsFor.has(id)) return true;
  return ancestors.some((a) => a.tagName === "label");
}

function hasGroupLabel(ancestors: El[]): boolean {
  return ancestors.some((a) => {
    if (a.tagName === "fieldset") return kids(a).some((c) => isEl(c) && c.tagName === "legend");
    const role = attr(a, "role");
    return (role === "radiogroup" || role === "group") && !!(attr(a, "aria-label") || attr(a, "aria-labelledby"));
  });
}

function checkBindings(manifest: Manifest, b: BCtx) {
  const { ctx } = b;
  const byId = new Map<string, Question>(manifest.questions.map((q) => [q.id, q]));
  const controls = new Map<string, Found[]>();
  const startOf = (el: El) => el.sourceCodeLocation?.startOffset;
  const tagSrc = (el: El) => {
    const loc = el.sourceCodeLocation?.startTag;
    return loc ? ctx.html.slice(loc.startOffset, loc.endOffset).replace(/\s+/g, " ") : `<${el.tagName}>`;
  };

  if (manifest.presentation === "guided" || manifest.presentation === "guided-question") {
    const blockCounts = new Map<string, number>();
    for (const list of b.questionLists) {
      const sectionId = attr(list.el, "data-kqa-question-list") ?? "";
      if ((sectionId === "" && manifest.presentation !== "guided-question") || (sectionId !== "" && !(manifest.sections ?? []).some((section) => section.id === sectionId))) {
        add(ctx, "KQA321", `data-kqa-question-list="${sectionId}" does not name a declared section.`, undefined, { offset: startOf(list.el), snippet: tagSrc(list.el) });
      }
    }
    for (const block of b.questionBlocks) {
      const id = attr(block.el, "data-kqa-question-id") ?? "";
      const question = byId.get(id);
      if (!question) {
        add(ctx, "KQA321", `data-kqa-question-id="${id}" does not name a manifest question.`, undefined, { offset: startOf(block.el), snippet: tagSrc(block.el) });
        continue;
      }
      blockCounts.set(id, (blockCounts.get(id) ?? 0) + 1);
      const parent = block.ancestors[block.ancestors.length - 1];
      const parentListId = parent ? attr(parent, "data-kqa-question-list") : undefined;
      const expectedListId = question.section ?? "";
      if (parentListId !== expectedListId) {
        add(ctx, "KQA321", `Question block "${id}" must be a direct child of data-kqa-question-list="${expectedListId}".`, `Wrap the question in one element marked data-kqa-question-list="${expectedListId}" and keep its whole block under that list.`, { offset: startOf(block.el), snippet: tagSrc(block.el), questionId: id });
      }
    }
    for (const question of manifest.questions) {
      const count = blockCounts.get(question.id) ?? 0;
      if (count !== 1) add(ctx, "KQA321", `Guided question "${question.id}" needs exactly one data-kqa-question-id wrapper; found ${count}.`, `Add one whole-question wrapper marked data-kqa-question-id="${question.id}".`, { path: `questions[${manifest.questions.indexOf(question)}]`, questionId: question.id, offset: b.at(`questions[${manifest.questions.indexOf(question)}]`) });
    }
  }

  for (const group of manifest.questionOrderGroups ?? []) {
    const memberBlocks = group.questionIds.map((id) => b.questionBlocks.filter((block) => attr(block.el, "data-kqa-question-id") === id));
    const members = group.questionIds.map((id) => byId.get(id)).filter((question): question is Question => !!question);
    const expectedSection = members[0]?.section ?? "";
    const candidates = memberBlocks.flat();
    const parents = new Set(candidates.map((block) => block.ancestors[block.ancestors.length - 1]).filter((parent): parent is El => !!parent));
    const complete = memberBlocks.every((blocks) => blocks.length === 1) && candidates.length === group.questionIds.length;
    const memberIds = new Set(group.questionIds);
    const orderedMemberBlocks = b.questionBlocks.filter((block) => memberIds.has(attr(block.el, "data-kqa-question-id") ?? ""));
    const domOrder = orderedMemberBlocks.map((block) => attr(block.el, "data-kqa-question-id"));
    const blockIndexes = orderedMemberBlocks.map((block) => b.questionBlocks.indexOf(block));
    const domRun = blockIndexes.length === group.questionIds.length && Math.max(...blockIndexes) - Math.min(...blockIndexes) + 1 === blockIndexes.length;
    const authoredDomOrder = domOrder.every((id, index) => id === group.questionIds[index]);
    const parent = parents.size === 1 ? [...parents][0] : undefined;
    const parentMarker = parent ? attr(parent, "data-kqa-question-list") : undefined;
    const memberNodes = candidates.map((block) => block.el);
    const childNodes = parent ? kids(parent) : [];
    const memberPositions = memberNodes.map((node) => childNodes.indexOf(node));
    const minMemberPosition = memberPositions.length ? Math.min(...memberPositions) : -1;
    const maxMemberPosition = memberPositions.length ? Math.max(...memberPositions) : -1;
    const onlyTriviaBetweenMembers = complete && minMemberPosition >= 0 && maxMemberPosition >= 0 && childNodes.slice(minMemberPosition + 1, maxMemberPosition).every((node) => {
      if (isEl(node)) return memberNodes.includes(node);
      if ("value" in node && typeof node.value === "string") return node.value.trim() === "";
      return (node as { nodeName?: string }).nodeName === "#comment";
    });
    const markedLists = b.questionLists.filter((list) => (attr(list.el, "data-kqa-question-list") ?? "") === expectedSection);
    if (!complete || !domRun || !onlyTriviaBetweenMembers || !authoredDomOrder || !parent || parentMarker !== expectedSection || markedLists.length !== 1) {
      add(ctx, "KQA322", `Question-order group "${group.id}" needs exactly one marked root wrapper for every member, as adjacent direct children of the same data-kqa-question-list="${expectedSection}".`, `Place each whole-question wrapper next to the previous member in one matching data-kqa-question-list; keep explanatory content inside its question wrapper.`, { path: `questionOrderGroups.${group.id}`, offset: b.at(`questionOrderGroups[${(manifest.questionOrderGroups ?? []).indexOf(group)}]`) });
    }
  }

  for (const f of b.dataKqa) {
    const id = attr(f.el, "data-kqa") ?? "";
    const q = byId.get(id);
    if (!q) {
      const near = closest(id, [...byId.keys()]);
      add(ctx, "KQA301", `<${f.el.tagName} data-kqa="${id}"> has no matching question in the manifest.${near ? ` Did you mean "${near}"?` : ""}`, near ? `Change data-kqa to "${near}".` : undefined, { offset: startOf(f.el), snippet: tagSrc(f.el) });
      continue;
    }
    controls.set(id, [...(controls.get(id) ?? []), f]);
  }

  const radioNames = new Map<string, Set<string>>();

  for (const q of manifest.questions) {
    const list = controls.get(q.id) ?? [];
    if (q.type === "repeat") {
      checkRepeatBindings(q, b);
      if (list.length) for (const found of list) add(ctx, "KQA309", `Repeat question "${q.id}" must not use data-kqa; bind its row fields with data-kqa-repeat-field inside its template.`, undefined, { offset: startOf(found.el), snippet: tagSrc(found.el), questionId: q.id });
      continue;
    }
    if (q.randomizeOptions === true && q.custom) add(ctx, "KQA223", `Question "${q.id}" cannot randomize options when it is custom.`, "Use native radio, checkbox, or select controls so KQA can apply and retain the presented order.", { questionId: q.id, path: `questions[${manifest.questions.indexOf(q)}].randomizeOptions` });
    if (list.length === 0) {
      if (!q.custom) {
        const near = closest(q.id, b.dataKqa.map((f) => attr(f.el, "data-kqa") ?? ""));
        const fix = q.type === "single"
          ? `Add one radio per option: <input type="radio" name="${q.id}" data-kqa="${q.id}" value="…">.`
          : q.type === "rank"
            ? `Add <ol data-kqa="${q.id}"> with one <li data-value="OPTION"> label for each option.`
            : undefined;
        add(ctx, "KQA300", `Question "${q.id}" (${q.type}) has no element with data-kqa="${q.id}".${near && !byId.has(near) ? ` The page has data-kqa="${near}", which is probably a typo.` : ""}`, fix, { path: `questions[${manifest.questions.indexOf(q)}]`, questionId: q.id, offset: b.at(`questions[${manifest.questions.indexOf(q)}]`) });
      } else b.stats.customQuestions++;
    } else {
      b.stats.boundQuestions++;
      if (q.custom) b.stats.customQuestions++;
    }
    if (q.custom && !b.scriptSetsAnswers) add(ctx, "KQA317", `Question "${q.id}" is custom, but the page's scripts never call KQA.set() or KQA.setNote().`, undefined, { questionId: q.id, path: `questions[${manifest.questions.indexOf(q)}].custom` });

    const note = noteConfig(q);
    const noteEls = b.dataNote.filter((f) => attr(f.el, "data-kqa-note") === q.id);
    if (note.enabled && noteEls.length === 0 && !q.custom) add(ctx, "KQA306", `Question "${q.id}" enables a note but the page has no element with data-kqa-note="${q.id}".`, `Add <textarea data-kqa-note="${q.id}" aria-label="Note for ${q.label.replace(/"/g, "'").slice(0, 60)}"></textarea>.`, { questionId: q.id, offset: b.at(`questions[${manifest.questions.indexOf(q)}]`), path: `questions[${manifest.questions.indexOf(q)}].note` });

    if (list.length === 0) continue;

    if (q.randomizeOptions === true && (q.type === "single" || q.type === "multi")) {
      const labelParents = list.map((found) => {
        const labelIndex = found.ancestors.findIndex((ancestor) => ancestor.tagName === "label");
        return labelIndex < 0 ? null : found.ancestors[labelIndex - 1] ?? null;
      });
      if (labelParents.some((parent) => parent === null) || labelParents.some((parent) => parent !== labelParents[0])) add(ctx, "KQA223", `Question "${q.id}" uses choice markup that KQA cannot safely reorder.`, "Wrap each radio or checkbox in a label, and place all option labels as siblings under the same parent.", { questionId: q.id, path: `questions[${manifest.questions.indexOf(q)}].randomizeOptions` });
    }
    if (q.randomizeOptions === true && q.type === "select" && list[0] && kids(list[0].el).some((child) => isEl(child) && child.tagName !== "option")) add(ctx, "KQA223", `Select question "${q.id}" must use direct <option> children for option rotation.`, "Move options out of <optgroup> elements; an empty direct option can remain as the placeholder.", { questionId: q.id, path: `questions[${manifest.questions.indexOf(q)}].randomizeOptions` });

    if (q.type === "rank") {
      const host = list[0]?.el;
      if (list.length !== 1 || host?.tagName !== "ol") {
        add(ctx, "KQA309", `Rank question "${q.id}" needs one <ol data-kqa="${q.id}"> containing its options in the starting order.`, undefined, { offset: host ? startOf(host) : undefined, questionId: q.id });
        continue;
      }
      if (!hasLabel(host, list[0].ancestors, b.labelsFor) && !hasGroupLabel(list[0].ancestors)) add(ctx, "KQA308", `Rank list "${q.id}" has no accessible question label.`, `Place it in a labelled fieldset or add aria-label/aria-labelledby.`, { offset: startOf(host), snippet: tagSrc(host), questionId: q.id });
      const options = q.options ?? [];
      const items = kids(host).filter(isEl);
      const seen = new Set<string>();
      if (items.length !== options.length || items.some((item) => item.tagName !== "li")) add(ctx, "KQA304", `Rank list "${q.id}" must contain one direct <li data-value="…"> for every manifest option and no other direct elements.`, undefined, { offset: startOf(host), snippet: tagSrc(host), questionId: q.id });
      items.filter((item) => item.tagName === "li").forEach((item) => {
        const value = attr(item, "data-value");
        if (!value || !options.some((option) => option.value === value) || seen.has(value)) add(ctx, "KQA304", `Rank list "${q.id}" has a missing, unknown or duplicate data-value ${JSON.stringify(value)}.`, undefined, { offset: startOf(item), snippet: tagSrc(item), questionId: q.id });
        if (value) seen.add(value);
        if (!textOf(item).trim()) add(ctx, "KQA308", `Rank option "${value ?? ""}" in "${q.id}" has no visible label.`, undefined, { offset: startOf(item), snippet: tagSrc(item), questionId: q.id });
      });
      for (const option of options) if (!seen.has(option.value)) add(ctx, "KQA304", `Rank list "${q.id}" is missing option "${option.value}".`, undefined, { offset: startOf(host), snippet: tagSrc(host), questionId: q.id });
      continue;
    }

    // element compatibility
    const kinds = list.map((f) => elementKind(f.el));
    const ok = (k: string): boolean => {
      switch (q.type) {
        case "single": return k === "input:radio";
        case "multi": return k === "input:checkbox";
        case "select": return k === "select";
        case "rank": return k === "ol";
        case "text": return k.startsWith("input:") && TEXT_INPUT_TYPES.has(k.slice(6) === "text" ? "text" : k.slice(6));
        case "longtext": return k === "textarea";
        case "number": return k === "input:number";
        case "scale": return k === "input:range" || k === "input:radio";
        case "date": return k === "input:date";
        case "repeat": return false;
      }
    };
    const expectedText: Record<string, string> = {
      single: "radio buttons (<input type=\"radio\">)", multi: "checkboxes (<input type=\"checkbox\">)", select: "a <select>", rank: "an ordered list (<ol>)", text: "<input type=\"text\"> (or email, url, tel, search)",
      longtext: "a <textarea>", number: "<input type=\"number\">", scale: "<input type=\"range\"> or numbered radio buttons", date: "<input type=\"date\">",
    };
    let mismatched = false;
    list.forEach((f, idx) => {
      if (f.el.tagName === "div" || f.el.tagName === "span" || f.el.tagName === "button" || !["input", "select", "textarea"].includes(f.el.tagName)) {
        mismatched = true;
        add(ctx, "KQA309", `<${f.el.tagName} data-kqa="${q.id}"> is not a form control.`, `Put data-kqa on ${expectedText[q.type]}, or set "custom": true on the question and call KQA.set().`, { offset: startOf(f.el), snippet: tagSrc(f.el), questionId: q.id });
      } else if (!ok(kinds[idx])) {
        mismatched = true;
        add(ctx, "KQA302", `Question "${q.id}" is "${q.type}" but is bound to ${kinds[idx].replace("input:", "<input type=\"") + (kinds[idx].startsWith("input:") ? "\">" : ">")}. A "${q.type}" question needs ${expectedText[q.type]}.`, undefined, { offset: startOf(f.el), snippet: tagSrc(f.el), questionId: q.id });
      }
    });
    if (mismatched) continue;

    // per-element rules
    const optionValues = (q.options ?? []).map((o) => o.value);
    const dom = new Set<string>();
    const singleControl = ["text", "longtext", "number", "date", "select"].includes(q.type) || (q.type === "scale" && kinds[0] === "input:range");
    if (singleControl && list.length > 1) {
      for (const f of list.slice(1)) add(ctx, "KQA313", `Question "${q.id}" is bound to ${list.length} ${q.type === "select" ? "<select>" : "controls"}; only one is allowed for this type.`, undefined, { offset: startOf(f.el), snippet: tagSrc(f.el), questionId: q.id });
    }
    for (const f of list) {
      const el = f.el;
      const kind = elementKind(el);
      const value = attr(el, "value");
      if (hasAttr(el, "disabled") || hasAttr(el, "readonly")) add(ctx, "KQA310", `${tagSrc(el)} is disabled or read-only.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
      if (!hasLabel(el, f.ancestors, b.labelsFor)) add(ctx, "KQA308", `${tagSrc(el)} has no label.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
      if (kind === "input:radio" || kind === "input:checkbox") {
        if (hasAttr(el, "checked")) add(ctx, "KQA320", `${tagSrc(el)} is pre-selected with checked.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
        if (value === undefined || value === "") {
          add(ctx, "KQA312", `${tagSrc(el)} has no value attribute.${optionValues.length ? ` Expected one of: ${optionValues.join(", ")}.` : ""}`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
        } else if (q.type === "scale") {
          const { min, max } = scaleBounds(q);
          const n = Number(value);
          if (!Number.isInteger(n) || n < min || n > max) add(ctx, "KQA303", `${tagSrc(el)} has value "${value}", which is outside the scale ${min} to ${max}.`, `Use whole numbers from ${min} to ${max}.`, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
          else dom.add(String(n));
        } else if (!optionValues.includes(value)) {
          const near = closest(value, optionValues);
          add(ctx, "KQA303", `${tagSrc(el)} has value "${value}", which is not an option of "${q.id}". Options: ${optionValues.join(", ")}.${near ? ` Did you mean "${near}"?` : ""}`, near ? `Change value="${value}" to value="${near}".` : undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
        } else dom.add(value);
        if (kind === "input:radio") {
          const name = attr(el, "name") ?? "";
          radioNames.set(name, new Set([...(radioNames.get(name) ?? []), q.id]));
        }
      } else if (kind === "select") {
        for (const c of kids(el)) {
          const walkOpts = (n: Node) => {
            if (isEl(n) && n.tagName === "option") {
              const ov = attr(n, "value") ?? textOf(n).trim();
              if (hasAttr(n, "selected")) add(ctx, "KQA320", `<option${ov ? ` value="${ov}"` : ""} selected> pre-selects an answer.`, "Use an empty placeholder option without selected.", { offset: startOf(n), questionId: q.id });
              if (ov === "") return;
              if (!optionValues.includes(ov)) {
                const near = closest(ov, optionValues);
                add(ctx, "KQA303", `<option value="${ov}"> is not an option of "${q.id}". Options: ${optionValues.join(", ")}.${near ? ` Did you mean "${near}"?` : ""}`, near ? `Change the option's value to "${near}".` : undefined, { offset: startOf(n), questionId: q.id });
              } else dom.add(ov);
            } else for (const k of kids(n)) walkOpts(k);
          };
          walkOpts(c);
        }
      } else if (kind === "textarea") {
        if (textOf(el).trim() !== "") add(ctx, "KQA320", `<textarea data-kqa="${q.id}"> has default text.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
      } else if (value && value !== "") {
        add(ctx, "KQA320", `${tagSrc(el)} has a default value.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
      }
      if (kind === "input:number" || kind === "input:range") {
        const { min, max } = q.type === "scale" ? scaleBounds(q) : { min: q.min, max: q.max };
        const aMin = attr(el, "min");
        const aMax = attr(el, "max");
        const aStep = attr(el, "step");
        const mismatch: string[] = [];
        if (min !== undefined && (aMin === undefined ? kind === "input:range" : Number(aMin) !== min)) mismatch.push(`min is ${aMin ?? (kind === "input:range" ? "0 (default)" : "unset")}, manifest says ${min}`);
        if (max !== undefined && (aMax === undefined ? kind === "input:range" : Number(aMax) !== max)) mismatch.push(`max is ${aMax ?? (kind === "input:range" ? "100 (default)" : "unset")}, manifest says ${max}`);
        if (q.step !== undefined && (aStep === undefined ? true : Number(aStep) !== q.step)) mismatch.push(`step is ${aStep ?? "unset (1)"}, manifest says ${q.step}`);
        if (mismatch.length) add(ctx, "KQA314", `${tagSrc(el)}: ${mismatch.join("; ")}.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
      }
      if ((q.type === "text" || q.type === "longtext") && (kind === "input:text" || kind === "textarea")) {
        const aMaxLen = attr(el, "maxlength");
        const manifestMax = q.maxLength ?? (q.type === "text" ? LIMITS.textMax : LIMITS.longtextMax);
        if (aMaxLen !== undefined && Number(aMaxLen) !== manifestMax && (q.maxLength !== undefined || Number(aMaxLen) < manifestMax)) {
          add(ctx, "KQA314", `${tagSrc(el)}: maxlength is ${aMaxLen}, manifest says ${manifestMax}${Number(aMaxLen) < manifestMax ? ", so long answers are cut off in the browser but the app would accept them" : ", so the app would reject answers longer than the manifest allows"}.`, `Set maxlength="${manifestMax}" on the control, or change maxLength in the manifest.`, { offset: startOf(el), snippet: tagSrc(el), questionId: q.id });
        }
      }
      if (q.type === "scale" && kind === "input:radio") continue;
    }

    // coverage and grouping for choice types
    if (q.type === "single" || q.type === "multi" || q.type === "select") {
      if (!q.custom) {
        const valueless = list.some((f) => ["input:radio", "input:checkbox"].includes(elementKind(f.el)) && !attr(f.el, "value"));
        for (const v of optionValues) {
          if (!dom.has(v) && !valueless) {
            const stray = b.unbound.find((e) => attr(e, "value") === v && attr(e, "name") === q.id) ?? b.unbound.find((e) => attr(e, "value") === v && !attr(e, "name"));
            if (stray) add(ctx, "KQA304", `The manifest offers option "${v}" for "${q.id}". The page has an element with value="${v}" but it has no data-kqa="${q.id}", so choosing it is never saved.`, `Add data-kqa="${q.id}" to this element.`, { offset: startOf(stray), snippet: tagSrc(stray), questionId: q.id, path: `questions[${manifest.questions.indexOf(q)}].options` });
            else add(ctx, "KQA304", `The manifest offers option "${v}" for "${q.id}", but the page has no control with value="${v}".`, undefined, { offset: startOf(list[0].el), snippet: tagSrc(list[0].el), questionId: q.id, path: `questions[${manifest.questions.indexOf(q)}].options` });
          }
        }
      }
    } else if (q.type === "scale" && kinds[0] === "input:radio" && !q.custom) {
      const { min, max } = scaleBounds(q);
      const missing: number[] = [];
      for (let n = min; n <= max; n++) if (!dom.has(String(n))) missing.push(n);
      if (missing.length && !list.some((f) => !attr(f.el, "value"))) add(ctx, "KQA304", `The scale "${q.id}" runs ${min} to ${max}, but there is no radio for ${missing.join(", ")}.`, undefined, { offset: startOf(list[0].el), snippet: tagSrc(list[0].el), questionId: q.id });
    }
    if (q.type === "single" || (q.type === "scale" && kinds[0] === "input:radio")) {
      const names = new Set(list.map((f) => attr(f.el, "name") ?? ""));
      if (names.size > 1 || names.has("")) add(ctx, "KQA307", `The radios for "${q.id}" use ${names.has("") ? "no name" : "different names"} (${[...names].map((n) => (n ? `"${n}"` : "(none)")).join(", ")}).`, `Give them all the same name, for example name="${q.id}".`, { offset: startOf(list[0].el), snippet: tagSrc(list[0].el), questionId: q.id });
      if (!hasGroupLabel(list[0].ancestors)) add(ctx, "KQA318", `The radios for "${q.id}" are not inside a labelled group.`, `Wrap them in <fieldset><legend>${q.label.replace(/</g, "&lt;").slice(0, 60)}</legend>…</fieldset>.`, { offset: startOf(list[0].el), snippet: tagSrc(list[0].el), questionId: q.id });
    }
  }
  for (const [name, qids] of radioNames) {
    if (name && qids.size > 1) {
      const f = b.dataKqa.find((x) => attr(x.el, "name") === name && qids.has(attr(x.el, "data-kqa") ?? ""));
      add(ctx, "KQA319", `Radios of ${[...qids].map((q) => `"${q}"`).join(" and ")} share name="${name}", so the browser treats them as one group.`, `Give each question's radios their own name (use the question id).`, { offset: f ? startOf(f.el) : undefined, snippet: f ? tagSrc(f.el) : undefined });
    }
  }

  for (const f of b.dataNote) {
    const id = attr(f.el, "data-kqa-note") ?? "";
    const q = byId.get(id);
    if (!q || !noteConfig(q).enabled) {
      add(ctx, "KQA305", `<${f.el.tagName} data-kqa-note="${id}"> refers to ${q ? `question "${id}", which does not enable notes` : "a question that does not exist"}.`, q ? `Add "note": true to question "${id}".` : undefined, { offset: startOf(f.el), snippet: tagSrc(f.el) });
    } else if (!(f.el.tagName === "textarea" || (f.el.tagName === "input" && TEXT_INPUT_TYPES.has((attr(f.el, "type") ?? "text").toLowerCase())))) {
      add(ctx, "KQA309", `data-kqa-note must be on a <textarea> or text <input>, found <${f.el.tagName}>.`, undefined, { offset: startOf(f.el), snippet: tagSrc(f.el), questionId: id });
    } else if (!hasLabel(f.el, f.ancestors, b.labelsFor)) add(ctx, "KQA308", `${tagSrc(f.el)} has no label.`, undefined, { offset: startOf(f.el), snippet: tagSrc(f.el), questionId: id });
  }
  for (const el of b.dataStatus) {
    const id = attr(el, "data-kqa-status") ?? "";
    if (!byId.has(id)) add(ctx, "KQA311", `data-kqa-status="${id}" does not match any question.`, undefined, { offset: startOf(el), snippet: tagSrc(el) });
  }
}

function checkRepeatBindings(question: Question, b: BCtx) {
  const { ctx } = b;
  const startOf = (el: El) => el.sourceCodeLocation?.startOffset;
  const tagSrc = (el: El) => {
    const loc = el.sourceCodeLocation?.startTag;
    return loc ? ctx.html.slice(loc.startOffset, loc.endOffset).replace(/\s+/g, " ") : `<${el.tagName}>`;
  };
  const templates = b.repeatTemplates.filter((found) => attr(found.el, "data-kqa-repeat-template") === question.id);
  if (templates.length !== 1) {
    add(ctx, "KQA300", `Repeat question "${question.id}" needs exactly one <template data-kqa-repeat-template="${question.id}">; found ${templates.length}.`, `Add one template containing the semantic fieldset row prototype.`, { questionId: question.id });
    return;
  }
  const template = templates[0]!;
  if (template.el.tagName !== "template") add(ctx, "KQA309", `data-kqa-repeat-template="${question.id}" must be on a <template>.`, undefined, { offset: startOf(template.el), snippet: tagSrc(template.el), questionId: question.id });
  const templateControls = b.repeatFields.filter((found) => found.ancestors.includes(template.el));
  const fieldsets = templateControls.map((found) => found.ancestors.find((ancestor) => ancestor.tagName === "fieldset")).filter(Boolean);
  const uniqueFieldsets = new Set(fieldsets);
  if (uniqueFieldsets.size !== 1 || !fieldsets[0] || !kids(fieldsets[0]).some((child) => isEl(child) && child.tagName === "legend")) {
    add(ctx, "KQA318", `Repeat template for "${question.id}" needs one semantic <fieldset> row with a <legend>.`, `Put all repeated field controls inside one fieldset with a legend such as “Item”.`, { offset: startOf(template.el), snippet: tagSrc(template.el), questionId: question.id });
  }
  const declaredFields = question.fields ?? [];
  for (const found of b.repeatFields) {
    if (found.ancestors.includes(template.el)) continue;
    add(ctx, "KQA301", `data-kqa-repeat-field="${attr(found.el, "data-kqa-repeat-field") ?? ""}" is outside a repeat template.`, undefined, { offset: startOf(found.el), snippet: tagSrc(found.el) });
  }
  for (const field of declaredFields) {
    const controls = templateControls.filter((found) => attr(found.el, "data-kqa-repeat-field") === field.id);
    if (!controls.length) {
      add(ctx, "KQA300", `Repeat field "${field.id}" in "${question.id}" has no control in its template.`, `Add a native field control marked data-kqa-repeat-field="${field.id}".`, { questionId: question.id });
      continue;
    }
    const expected: Record<string, (el: El) => boolean> = {
      single: (el) => el.tagName === "input" && attr(el, "type")?.toLowerCase() === "radio",
      select: (el) => el.tagName === "select",
      text: (el) => el.tagName === "input" && TEXT_INPUT_TYPES.has((attr(el, "type") ?? "text").toLowerCase()),
      longtext: (el) => el.tagName === "textarea",
      number: (el) => el.tagName === "input" && attr(el, "type")?.toLowerCase() === "number",
      scale: (el) => el.tagName === "input" && ["range", "radio"].includes((attr(el, "type") ?? "").toLowerCase()),
      date: (el) => el.tagName === "input" && attr(el, "type")?.toLowerCase() === "date",
    };
    if (controls.some((found) => !expected[field.type]?.(found.el))) {
      add(ctx, "KQA302", `Repeat field "${field.id}" is not bound to a native ${field.type} control.`, undefined, { offset: startOf(controls[0]!.el), snippet: tagSrc(controls[0]!.el), questionId: question.id });
      continue;
    }
    if (field.type !== "single" && field.type !== "scale" && controls.length !== 1) add(ctx, "KQA313", `Repeat field "${field.id}" needs exactly one control; found ${controls.length}.`, undefined, { offset: startOf(controls[1]!.el), snippet: tagSrc(controls[1]!.el), questionId: question.id });
    for (const found of controls) {
      const el = found.el;
      if (!hasLabel(el, found.ancestors, b.labelsFor)) add(ctx, "KQA308", `Repeat field control ${tagSrc(el)} has no accessible label.`, `Wrap the control in a <label> or provide aria-label/aria-labelledby.`, { offset: startOf(el), snippet: tagSrc(el), questionId: question.id });
      if (hasAttr(el, "data-kqa")) add(ctx, "KQA309", `Repeat field "${field.id}" must use data-kqa-repeat-field, not data-kqa.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: question.id });
      if (hasAttr(el, "disabled") || hasAttr(el, "readonly")) add(ctx, "KQA310", `${tagSrc(el)} is disabled or read-only.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: question.id });
      if (hasAttr(el, "checked")) add(ctx, "KQA320", `${tagSrc(el)} preselects a repeat answer.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: question.id });
      if (field.type !== "single" && field.type !== "select" && attr(el, "value")) add(ctx, "KQA320", `${tagSrc(el)} has a default value.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: question.id });
      if (el.tagName === "textarea" && textOf(el).trim()) add(ctx, "KQA320", `Repeat field "${field.id}" has default text.`, undefined, { offset: startOf(el), snippet: tagSrc(el), questionId: question.id });
      if (el.tagName === "select") for (const option of kids(el)) if (isEl(option) && option.tagName === "option" && hasAttr(option, "selected")) add(ctx, "KQA320", `Repeat field "${field.id}" has a preselected option.`, undefined, { offset: startOf(option), snippet: tagSrc(option), questionId: question.id });
    }
    if (field.type === "single" || field.type === "select") {
      const expectedValues = new Set((field.options ?? []).map((option) => option.value));
      const actualValues = new Set<string>();
      for (const found of controls) {
        if (field.type === "single") {
          const value = attr(found.el, "value");
          if (value && expectedValues.has(value)) actualValues.add(value);
          else if (value) add(ctx, "KQA303", `Repeat field "${field.id}" has undeclared option value "${value}".`, undefined, { offset: startOf(found.el), snippet: tagSrc(found.el), questionId: question.id });
        } else {
          for (const child of kids(found.el)) if (isEl(child) && child.tagName === "option") {
            const value = attr(child, "value") ?? textOf(child).trim();
            if (!value) continue;
            if (expectedValues.has(value)) actualValues.add(value);
            else add(ctx, "KQA303", `Repeat field "${field.id}" has undeclared option value "${value}".`, undefined, { offset: startOf(child), snippet: tagSrc(child), questionId: question.id });
          }
        }
      }
      for (const value of expectedValues) if (!actualValues.has(value)) add(ctx, "KQA304", `Repeat field "${field.id}" does not bind option "${value}" in its template.`, undefined, { offset: startOf(controls[0]!.el), snippet: tagSrc(controls[0]!.el), questionId: question.id });
    } else if (field.type === "scale" && controls[0]?.el.tagName === "input" && attr(controls[0].el, "type")?.toLowerCase() === "radio") {
      const min = typeof field.min === "number" ? field.min : 1;
      const max = typeof field.max === "number" ? field.max : 5;
      const actualValues = new Set<number>();
      for (const found of controls) {
        const value = Number(attr(found.el, "value"));
        if (!Number.isInteger(value) || value < min || value > max) add(ctx, "KQA303", `Repeat scale field "${field.id}" has a radio value outside ${min} to ${max}.`, undefined, { offset: startOf(found.el), snippet: tagSrc(found.el), questionId: question.id });
        else actualValues.add(value);
      }
      for (let value = min; value <= max && value - min <= 20; value++) if (!actualValues.has(value)) add(ctx, "KQA304", `Repeat scale field "${field.id}" has no radio for ${value}.`, undefined, { offset: startOf(controls[0]!.el), snippet: tagSrc(controls[0]!.el), questionId: question.id });
    }
  }
  for (const found of templateControls) {
    const id = attr(found.el, "data-kqa-repeat-field") ?? "";
    if (!declaredFields.some((field) => field.id === id)) add(ctx, "KQA301", `Repeat template for "${question.id}" has undeclared field "${id}".`, undefined, { offset: startOf(found.el), snippet: tagSrc(found.el), questionId: question.id });
  }
}
