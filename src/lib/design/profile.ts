import { createHash } from "node:crypto";
import postcss, { type AtRule, type Node, type Rule } from "postcss";

export type DesignProfileSurface = "host" | "questionnaire" | "analytics";
export type DesignProfileFormat = "css" | "json";

const MAX_SOURCE_BYTES = 32 * 1024;
const MAX_TOKENS = 250;
const MAX_TOKEN_NAME = 120;
const MAX_TOKEN_VALUE = 256;
const MAX_OVERLAY_DECLARATIONS = 40;

interface DesignToken {
  name: string;
  value: string;
  scope: string;
  sourceContext: string;
  line: number | null;
  path?: string;
  sourceType?: string;
  requiresReview?: boolean;
}

interface RoleCandidate {
  role: string;
  targetToken: string;
  category: "color" | "font" | "length" | "shadow";
  rationale: string;
}

interface Mapping extends RoleCandidate {
  sourceToken: string;
  sourceType?: string;
  scope: string;
  value: string;
  confidence: "high" | "review";
  valueCheck: "recognized" | "manual_review";
}

type ExtractResult = { ok: true; profile: Record<string, unknown> } | { ok: false; code: string; error: string };

function fail(code: string, error: string): ExtractResult {
  return { ok: false, code, error };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeTokenName(value: string): boolean {
  return value.length > 0 && value.length <= MAX_TOKEN_NAME && !/[\u0000-\u001f\u007f]/.test(value);
}

function scopeFromCss(node: Node): { scope: string; sourceContext: string } {
  const parts: string[] = [];
  let darkMedia = false;
  let lightMedia = false;
  let customScope: string | null = null;
  let current = node.parent;
  while (current) {
    if (current.type === "atrule") {
      const atRule = current as AtRule;
      const context = `@${atRule.name}${atRule.params ? ` ${atRule.params}` : ""}`;
      parts.unshift(context.slice(0, 140));
      const params = atRule.params.trim().toLowerCase().replace(/\s+/g, " ");
      if (atRule.name.toLowerCase() === "media" && params === "(prefers-color-scheme: dark)") darkMedia = true;
      else if (atRule.name.toLowerCase() === "media" && params === "(prefers-color-scheme: light)") lightMedia = true;
      else customScope ??= context;
    } else if (current.type === "rule") {
      const selector = (current as Rule).selector.trim();
      parts.unshift(selector.slice(0, 140));
      const rootSelectors = selector.split(",").map((item) => item.trim().toLowerCase());
      if (!rootSelectors.every((item) => [":root", "html", "body"].includes(item))) customScope ??= selector;
    }
    current = current.parent;
  }
  const scope = customScope ? `custom:${customScope}` : darkMedia ? "dark" : lightMedia ? "light" : "default";
  return { scope, sourceContext: parts.join(" > ").slice(0, 240) || ":root" };
}

function collectCss(source: string): { tokens: DesignToken[]; diagnostics: string[] } {
  const tokens: DesignToken[] = [];
  const diagnostics: string[] = [];
  const root = postcss.parse(source, { from: undefined });
  root.walkDecls((decl) => {
    if (!decl.prop.startsWith("--")) return;
    if (tokens.length >= MAX_TOKENS) return;
    const name = decl.prop;
    const value = decl.value.trim();
    if (!safeTokenName(name) || !/^--[A-Za-z0-9_-]+$/.test(name)) {
      diagnostics.push("A custom property with an unsupported name was skipped.");
      return;
    }
    if (!value || value.length > MAX_TOKEN_VALUE || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      diagnostics.push(`${name} was skipped because its value is empty, too long, or contains control characters.`);
      return;
    }
    const sourceScope = scopeFromCss(decl);
    tokens.push({ name, value, ...sourceScope, line: decl.source?.start?.line ?? null });
  });
  if (tokens.length >= MAX_TOKENS) diagnostics.push(`Token extraction is capped at ${MAX_TOKENS} declarations.`);
  return { tokens, diagnostics };
}

interface JsonTokenExtraction {
  tokens: DesignToken[];
  diagnostics: string[];
  format: "legacy" | "dtcg-2025.10";
}

interface DtcgTokenRecord {
  path: string[];
  curlyPath: string;
  scope: string;
  name: string;
  rawValue: unknown;
  sourceType?: string;
  requiresReview: boolean;
}

const DTCG_FORMAT_URL = "https://www.w3.org/community/reports/design-tokens/CG-FINAL-format-20251028/";
const DTCG_COLOR_URL = "https://www.designtokens.org/TR/2025.10/color/";
const DTCG_METADATA_KEYS = new Set(["$schema", "$type", "$description", "$extensions", "$deprecated"]);

function detectDtcg(value: unknown, depth = 0, budget = { visited: 0 }): boolean {
  if (depth > 8 || budget.visited++ > 1500) return false;
  if (!isRecord(value)) return false;
  if (typeof value.$schema === "string" && /design.?tokens/i.test(value.$schema)) return true;
  if (Object.prototype.hasOwnProperty.call(value, "$value")
    || Object.prototype.hasOwnProperty.call(value, "$type")
    || Object.prototype.hasOwnProperty.call(value, "$extends")) return true;
  return Object.values(value).some((child) => detectDtcg(child, depth + 1, budget));
}

function pointerSegments(pointer: string): string[] | null {
  if (pointer === "#") return [];
  if (!pointer.startsWith("#/")) return null;
  try {
    return pointer.slice(2).split("/").map((segment) => decodeURIComponent(segment).replace(/~1/g, "/").replace(/~0/g, "~"));
  } catch {
    return null;
  }
}

function pointerKey(path: string[]): string {
  return JSON.stringify(path);
}

function normalizedDtcgValue(value: unknown, type?: string): string | null {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (type === "fontFamily" && Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.map((family) => /^[a-z-]+$/i.test(family) ? family : JSON.stringify(family)).join(", ");
  }
  if (isRecord(value) && type === "dimension" && typeof value.value === "number" && Number.isFinite(value.value)
    && typeof value.unit === "string" && /^[A-Za-z%]+$/.test(value.unit)) {
    return `${value.value}${value.unit}`;
  }
  if (isRecord(value) && type === "color") {
    // The DTCG hex member is only a fallback color; it does not erase alpha.
    // Keep non-opaque (or malformed-alpha) colors intact so they remain manual
    // review values and cannot enter opaque contrast estimates or CSS overlays.
    if (typeof value.hex === "string" && (value.alpha === undefined || value.alpha === 1)) return value.hex;
    if (value.colorSpace === "srgb" && Array.isArray(value.components) && value.components.length === 3
      && value.components.every((component) => typeof component === "number" && Number.isFinite(component) && component >= 0 && component <= 1)
      && (value.alpha === undefined || value.alpha === 1)) {
      return `#${value.components.map((component) => Math.round((component as number) * 255).toString(16).padStart(2, "0")).join("")}`;
    }
  }
  try {
    return JSON.stringify(value) ?? null;
  } catch {
    return null;
  }
}

function collectDtcg(parsed: Record<string, unknown>): JsonTokenExtraction {
  const records: DtcgTokenRecord[] = [];
  const diagnostics: string[] = [];
  const diagnosticSet = new Set<string>();
  let visited = 0;
  let traversalCapped = false;
  const addDiagnostic = (message: string) => {
    if (diagnosticSet.has(message)) return;
    diagnosticSet.add(message);
    diagnostics.push(message);
  };

  const addRecord = (path: string[], rawValue: unknown, inheritedType: string | undefined, explicitType: unknown) => {
    if (!path.length) {
      addDiagnostic("A token at the JSON root was skipped because it has no token name.");
      return;
    }
    if (records.length >= MAX_TOKENS) return;
    const sourcePath = path.join(".");
    const modeIndex = path.length > 1 && ["dark", "light"].includes(path[0]!.toLowerCase()) ? 0 : -1;
    const scope = modeIndex >= 0 ? path[modeIndex]!.toLowerCase() : "default";
    const tokenPath = modeIndex >= 0 ? path.slice(1) : path;
    if (modeIndex >= 0 && tokenPath.some((part) => ["dark", "light"].includes(part.toLowerCase()))) {
      addDiagnostic(`${sourcePath} contains a nested light/dark path segment; only top-level light/dark groups are treated as theme scopes.`);
    }
    const name = tokenPath.filter((part) => part !== "$root").join(".");
    const curlyPath = tokenPath.join(".");
    if (!safeTokenName(name)) {
      addDiagnostic(`${sourcePath} was skipped because its token path is empty, too long, or contains control characters.`);
      return;
    }
    const tokenType = typeof explicitType === "string" ? explicitType : inheritedType;
    const requiresReview = (explicitType !== undefined && typeof explicitType !== "string")
      || typeof tokenType !== "string"
      || !tokenType;
    if (requiresReview) addDiagnostic(`${sourcePath} has no explicit or inherited $type; its semantic role needs manual review.`);
    records.push({ path, curlyPath, scope, name, rawValue, ...(tokenType ? { sourceType: tokenType } : {}), requiresReview });
  };

  const visit = (value: unknown, path: string[], inheritedType: string | undefined, depth: number) => {
    visited += 1;
    if (visited > 1500) {
      traversalCapped = true;
      return;
    }
    if (records.length >= MAX_TOKENS) return;
    if (depth > 8) {
      addDiagnostic("Nested token data deeper than eight levels was skipped.");
      return;
    }
    if (!isRecord(value)) {
      if (path.length && value !== null) addDiagnostic(`${path.join(".")} was skipped because a DTCG group or token must be an object.`);
      return;
    }

    const explicitType = value.$type;
    if (explicitType !== undefined && typeof explicitType !== "string") {
      addDiagnostic(`${path.join(".") || "root"} has a non-string $type; inherited type information was used where available.`);
    }
    const tokenType = typeof explicitType === "string" ? explicitType : inheritedType;
    if (Object.prototype.hasOwnProperty.call(value, "$value")) {
      const extraKeys = Object.keys(value).filter((key) => key !== "$value" && key !== "$root" && !DTCG_METADATA_KEYS.has(key));
      if (Object.prototype.hasOwnProperty.call(value, "$root")) {
        addDiagnostic(`${path.join(".")} contains both $value and $root; the invalid token/group was skipped.`);
        return;
      }
      if (extraKeys.length) {
        addDiagnostic(`${path.join(".")} contains both $value and child data; the invalid token/group was skipped.`);
        return;
      }
      addRecord(path, value.$value, inheritedType, explicitType);
      return;
    }

    if (typeof value.$ref === "string" && Object.keys(value).every((key) => key === "$ref" || DTCG_METADATA_KEYS.has(key))) {
      addRecord(path, { $ref: value.$ref }, inheritedType, explicitType);
      return;
    }
    if (Object.prototype.hasOwnProperty.call(value, "$extends")) {
      addDiagnostic(`${path.join(".") || "root"} uses $extends group inheritance, which this bounded importer does not resolve.`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (key === "$root") {
        visit(child, [...path, key], tokenType, depth + 1);
        continue;
      }
      if (key.startsWith("$")) {
        if (!DTCG_METADATA_KEYS.has(key) && key !== "$extends") addDiagnostic(`Unsupported DTCG metadata ${key} at ${path.join(".") || "root"} was ignored.`);
        continue;
      }
      visit(child, [...path, key], tokenType, depth + 1);
    }
  };

  visit(parsed, [], undefined, 0);
  if (traversalCapped) addDiagnostic("JSON traversal is capped at 1,500 nodes.");
  if (records.length >= MAX_TOKENS) addDiagnostic(`Token extraction is capped at ${MAX_TOKENS} values.`);

  const byPointer = new Map<string, DtcgTokenRecord>();
  const byCurlyPath = new Map<string, DtcgTokenRecord[]>();
  for (const record of records) {
    byPointer.set(pointerKey(record.path), record);
    byPointer.set(pointerKey([...record.path, "$value"]), record);
    byCurlyPath.set(record.curlyPath, [...(byCurlyPath.get(record.curlyPath) ?? []), record]);
  }
  const cache = new Map<DtcgTokenRecord, { value: unknown; unresolved: boolean }>();
  let resolvedValueNodes = 0;
  const resolvePointer = (pointer: string, stack: DtcgTokenRecord[]): { found: boolean; value?: unknown; unresolved: boolean } => {
    const segments = pointerSegments(pointer);
    if (!segments) return { found: false, unresolved: true };
    const token = byPointer.get(pointerKey(segments));
    if (token) return { found: true, ...resolveToken(token, stack) };
    let current: unknown = parsed;
    for (const segment of segments) {
      if (Array.isArray(current) && /^(0|[1-9]\d*)$/.test(segment)) current = current[Number(segment)];
      else if (isRecord(current) && Object.prototype.hasOwnProperty.call(current, segment)) current = current[segment];
      else return { found: false, unresolved: true };
    }
    const resolved = resolveValue(current, stack);
    return { found: true, value: resolved.value, unresolved: resolved.unresolved };
  };
  const resolveValue = (value: unknown, stack: DtcgTokenRecord[], depth = 0): { value: unknown; unresolved: boolean } => {
    resolvedValueNodes += 1;
    if (depth > 8 || resolvedValueNodes > 1500) {
      addDiagnostic("Alias value traversal is capped at eight nested levels and 1,500 nodes; affected tokens need manual review.");
      return { value, unresolved: true };
    }
    if (typeof value === "string") {
      const alias = /^\{([^{}]+)\}$/.exec(value.trim());
      if (!alias) {
        if (value.includes("{") || value.includes("}")) return { value, unresolved: true };
        return { value, unresolved: false };
      }
      const candidates = byCurlyPath.get(alias[1]!);
      if (!candidates?.length) {
        addDiagnostic(`${stack.at(-1)?.path.join(".") ?? "A token"} references unresolved token {${alias[1]}}.`);
        return { value, unresolved: true };
      }
      const currentScope = stack.at(-1)?.scope ?? "default";
      const sameScope = candidates.filter((candidate) => candidate.scope === currentScope);
      const defaults = candidates.filter((candidate) => candidate.scope === "default");
      const resolvedCandidates = sameScope.length ? sameScope : defaults.length ? defaults : candidates;
      if (resolvedCandidates.length > 1) {
        addDiagnostic(`${stack.at(-1)?.path.join(".") ?? "A token"} references ambiguous token path {${alias[1]}}.`);
        return { value, unresolved: true };
      }
      return resolveToken(resolvedCandidates[0]!, stack);
    }
    if (isRecord(value) && typeof value.$ref === "string" && Object.keys(value).length === 1) {
      const reference = resolvePointer(value.$ref, stack);
      if (!reference.found) {
        addDiagnostic(`${stack.at(-1)?.path.join(".") ?? "A token"} references unresolved JSON Pointer ${value.$ref}.`);
        return { value, unresolved: true };
      }
      return { value: reference.value, unresolved: reference.unresolved };
    }
    if (Array.isArray(value)) {
      const children = value.map((child) => resolveValue(child, stack, depth + 1));
      return { value: children.map((child) => child.value), unresolved: children.some((child) => child.unresolved) };
    }
    if (isRecord(value)) {
      const entries = Object.entries(value).map(([key, child]) => [key, resolveValue(child, stack, depth + 1)] as const);
      return {
        value: Object.fromEntries(entries.map(([key, child]) => [key, child.value])),
        unresolved: entries.some(([, child]) => child.unresolved),
      };
    }
    return { value, unresolved: false };
  };
  const resolveToken = (record: DtcgTokenRecord, stack: DtcgTokenRecord[]): { value: unknown; unresolved: boolean } => {
    const cycleAt = stack.indexOf(record);
    if (cycleAt >= 0) {
      const cycle = [...stack.slice(cycleAt), record].map((item) => item.path.join(".")).join(" -> ");
      addDiagnostic(`Circular DTCG token reference: ${cycle}.`);
      return { value: record.rawValue, unresolved: true };
    }
    const cached = cache.get(record);
    if (cached) return cached;
    const result = resolveValue(record.rawValue, [...stack, record]);
    cache.set(record, result);
    return result;
  };

  const tokens: DesignToken[] = [];
  for (const record of records) {
    const resolved = resolveToken(record, []);
    const value = normalizedDtcgValue(resolved.value, record.sourceType);
    if (value === null || !value.trim() || value.length > MAX_TOKEN_VALUE || /[\u0000-\u001f\u007f]/.test(value)) {
      addDiagnostic(`${record.path.join(".")} was skipped because its resolved value is empty, too long, or unsupported.`);
      continue;
    }
    tokens.push({
      name: record.name,
      value,
      scope: record.scope,
      sourceContext: `DTCG JSON path ${record.path.join(".")}`.slice(0, 240),
      line: null,
      path: record.path.join("."),
      ...(record.sourceType ? { sourceType: record.sourceType } : {}),
      requiresReview: record.requiresReview || resolved.unresolved,
    });
  }
  return { tokens, diagnostics, format: "dtcg-2025.10" };
}

function collectLegacyJson(parsed: Record<string, unknown>): JsonTokenExtraction {
  const tokens: DesignToken[] = [];
  const diagnostics: string[] = [];
  const ignoredKeys = new Set(["$schema", "$description", "description", "version", "type", "metadata"]);
  let visited = 0;
  let traversalCapped = false;

  const visit = (value: unknown, path: string[], depth: number) => {
    visited += 1;
    if (visited > 1500) {
      traversalCapped = true;
      return;
    }
    if (tokens.length >= MAX_TOKENS) return;
    if (depth > 8) {
      diagnostics.push("Nested token data deeper than eight levels was skipped.");
      return;
    }
    if (isRecord(value)) {
      const descriptor = value.value;
      if ((typeof descriptor === "string" || typeof descriptor === "number") && path.length) {
        add(path, descriptor);
        return;
      }
      for (const [key, child] of Object.entries(value)) {
        if (ignoredKeys.has(key)) continue;
        visit(child, [...path, key], depth + 1);
      }
      return;
    }
    if (typeof value === "string" || typeof value === "number") {
      if (path.length) add(path, value);
      return;
    }
    if (value !== null) diagnostics.push(`Unsupported token value at ${path.join(".") || "root"} was skipped.`);
  };

  const add = (path: string[], rawValue: string | number) => {
    const sourcePath = path.join(".");
    const first = path[0]?.toLowerCase();
    const scope = first === "dark" || first === "light" ? first : "default";
    const tokenPath = scope === "default" ? path : path.slice(1);
    const name = tokenPath.join(".");
    const value = String(rawValue).trim();
    if (!safeTokenName(name) || !value || value.length > MAX_TOKEN_VALUE || /[\u0000-\u001f\u007f]/.test(value)) {
      diagnostics.push(`${sourcePath} was skipped because its name or value is empty, too long, or contains control characters.`);
      return;
    }
    tokens.push({ name, value, scope, sourceContext: `JSON path ${sourcePath}`.slice(0, 240), line: null, path: sourcePath });
  };

  visit(parsed, [], 0);
  if (traversalCapped) diagnostics.push("JSON traversal is capped at 1,500 nodes.");
  if (tokens.length >= MAX_TOKENS) diagnostics.push(`Token extraction is capped at ${MAX_TOKENS} values.`);
  return { tokens, diagnostics, format: "legacy" };
}

function collectJson(source: string): JsonTokenExtraction | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  return detectDtcg(parsed) ? collectDtcg(parsed) : collectLegacyJson(parsed);
}

function roleCandidate(tokenName: string): RoleCandidate | null {
  const name = tokenName.replace(/^--/, "").toLowerCase().replace(/[._/]+/g, "-");
  const tail = name.split("-").at(-1) ?? name;
  if (/(?:^|[-_])(background|canvas|page-bg|bg)(?:$|[-_])/.test(name)) return { role: "color.canvas", targetToken: "--bg", category: "color", rationale: "The token name identifies a page or canvas background." };
  if (/(?:^|[-_])(surface|panel|card)(?:$|[-_])/.test(name)) {
    const secondary = /(?:secondary|raised|subtle|2|alt)/.test(name);
    return { role: secondary ? "surface.secondary" : "surface.primary", targetToken: secondary ? "--surface-2" : "--surface", category: "color", rationale: "The token name identifies a surface role." };
  }
  if (/(?:^|[-_])(muted|subtle|secondary-text|text-secondary)(?:$|[-_])/.test(name)) return { role: "text.secondary", targetToken: "--muted", category: "color", rationale: "The token name identifies secondary or muted text." };
  if (/(?:^|[-_])(ink|foreground|text|on-surface)(?:$|[-_])/.test(name)) return { role: "text.primary", targetToken: "--ink", category: "color", rationale: "The token name identifies primary text or foreground." };
  if (/(?:^|[-_])(brand|primary)(?:$|[-_])/.test(name)) return { role: "brand.primary", targetToken: "--brand", category: "color", rationale: "The token name identifies a brand or primary action color." };
  if (/(?:^|[-_])accent(?:$|[-_])/.test(name)) return { role: "accent.primary", targetToken: "--accent", category: "color", rationale: "The token name identifies an accent color." };
  if (/(?:^|[-_])(focus|ring)(?:$|[-_])/.test(name)) return { role: "focus.ring", targetToken: "--focus", category: "color", rationale: "The token name identifies a keyboard focus indicator." };
  if (/(?:^|[-_])(danger|error)(?:$|[-_])/.test(name)) return { role: "status.danger", targetToken: "--danger", category: "color", rationale: "The token name identifies an error or danger state." };
  if (/(?:^|[-_])(radius|rounded)(?:$|[-_])/.test(name)) return { role: "shape.radius", targetToken: "--r", category: "length", rationale: "The token name identifies a corner radius." };
  if (/(?:^|[-_])(font|typeface|typography)(?:$|[-_])/.test(name)) {
    const mono = /(?:mono|code|monospace)/.test(name);
    return { role: mono ? "type.monospace" : "type.body", targetToken: mono ? "--mono" : "--sans", category: "font", rationale: mono ? "The token name identifies a code or monospace face." : "The token name identifies a font or typeface." };
  }
  if (/(?:^|[-_])(spacing|space)(?:$|[-_])/.test(name)) {
    const suffix = name.replace(/^(?:.*?[-_])?(spacing|space)[-_]?/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    return { role: `spacing.${suffix || tail}`, targetToken: `--space-${suffix || "base"}`.slice(0, 80), category: "length", rationale: "The token name identifies a spacing scale value; KQA has no built-in spacing scale." };
  }
  if (/(?:^|[-_])(shadow|elevation)(?:$|[-_])/.test(name)) {
    const suffix = name.replace(/^(?:.*?[-_])?(shadow|elevation)[-_]?/, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-|-$/g, "");
    return { role: `elevation.${suffix || "default"}`, targetToken: `--shadow${suffix ? `-${suffix}` : ""}`.slice(0, 80), category: "shadow", rationale: "The token name identifies a shadow or elevation role." };
  }
  return null;
}

function solidColor(value: string): [number, number, number] | null {
  const trimmed = value.trim().toLowerCase();
  if (trimmed === "black") return [0, 0, 0];
  if (trimmed === "white") return [255, 255, 255];
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(trimmed)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((digit) => digit + digit).join("") : hex;
    return [0, 2, 4].map((offset) => Number.parseInt(full.slice(offset, offset + 2), 16)) as [number, number, number];
  }
  const channel = "(\\d{1,3}(?:\\.\\d+)?)";
  const commaRgb = new RegExp(`^rgb\\(\\s*${channel}\\s*,\\s*${channel}\\s*,\\s*${channel}\\s*\\)$`, "i").exec(trimmed);
  const spaceRgb = new RegExp(`^rgb\\(\\s*${channel}\\s+${channel}\\s+${channel}\\s*\\)$`, "i").exec(trimmed);
  const rgb = commaRgb ?? spaceRgb;
  if (rgb) {
    const channels = rgb.slice(1).map(Number);
    if (channels.every((channel) => channel >= 0 && channel <= 255)) return channels as [number, number, number];
  }
  return null;
}

function recognizedValue(category: RoleCandidate["category"], value: string): boolean {
  if (category === "color") return solidColor(value) !== null;
  if (category === "length") return /^(?:0|(?:\d+(?:\.\d+)?|\.\d+)(?:px|rem|em|%|ch|vw|vh))$/i.test(value.trim());
  if (category === "font") return value.length <= 160 && /^[A-Za-z0-9\s,"'_()-]+$/.test(value) && !/url|expression/i.test(value);
  return value === "none" || /^(?:-?\d+(?:\.\d+)?(?:px|rem|em)?[\s,]*){1,8}$/i.test(value.trim());
}

function matchesDtcgType(category: RoleCandidate["category"], sourceType: string | undefined): boolean {
  if (!sourceType) return true;
  if (category === "color") return sourceType === "color";
  if (category === "font") return sourceType === "fontFamily" || sourceType === "fontWeight";
  if (category === "length") return sourceType === "dimension";
  return sourceType === "shadow";
}

function contrastRatio(foreground: string, background: string): number | null {
  const fg = solidColor(foreground);
  const bg = solidColor(background);
  if (!fg || !bg) return null;
  const luminance = (rgb: [number, number, number]) => {
    const linear = rgb.map((channel) => {
      const value = channel / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * linear[0]! + 0.7152 * linear[1]! + 0.0722 * linear[2]!;
  };
  const values = [luminance(fg), luminance(bg)].sort((a, b) => b - a);
  return Number(((values[0]! + 0.05) / (values[1]! + 0.05)).toFixed(2));
}

function contrastChecks(mappings: Mapping[], scopes: string[]) {
  const checks: Record<string, unknown>[] = [];
  for (const scope of scopes) {
    const inScope = mappings.filter((mapping) => mapping.scope === scope);
    for (const textRole of ["text.primary", "text.secondary"]) {
      const text = inScope.find((mapping) => mapping.role === textRole);
      if (!text) continue;
      for (const backgroundRole of ["color.canvas", "surface.primary", "surface.secondary"]) {
        const background = inScope.find((mapping) => mapping.role === backgroundRole);
        if (!background) continue;
        const ratio = contrastRatio(text.value, background.value);
        checks.push({
          scope,
          pairing: "candidate-inferred-from-token-names",
          foreground: { role: text.role, token: text.sourceToken },
          background: { role: background.role, token: background.sourceToken },
          status: ratio === null ? "not_evaluated" : "evaluated",
          ...(ratio === null ? { reason: "Only opaque hex, black/white, or simple rgb() values are evaluated." } : {
            ratio,
            wcagAaNormalText: ratio >= 4.5,
            wcagAaLargeText: ratio >= 3,
          }),
          caveat: "This is a token-name-based candidate pairing, not a rendered contrast evaluation. Verify actual text, size, opacity, overlays, and interaction states.",
        });
      }
    }
  }
  return checks;
}

function overlayCss(mappings: Mapping[], surface: DesignProfileSurface): { css: string | null; notes: string[] } {
  const notes: string[] = [];
  const eligible = mappings.filter((mapping) => mapping.valueCheck === "recognized"
    && ["default", "light", "dark"].includes(mapping.scope)
    && /^--[A-Za-z0-9_-]+$/.test(mapping.targetToken));
  const defaultMappings = eligible.filter((mapping) => mapping.scope === "default");
  const lightMappings = eligible.filter((mapping) => mapping.scope === "light");
  const darkMappings = eligible.filter((mapping) => mapping.scope === "dark");
  const customCount = mappings.filter((mapping) => mapping.scope.startsWith("custom:")).length;
  if (customCount) notes.push("Custom selector scopes are preserved in the profile but omitted from the generic overlay; adapt them to the target document deliberately.");
  if (!eligible.length) return { css: null, notes: [...notes, "No mappings had values safe enough for a copyable CSS proposal."] };

  const declarations = (list: Mapping[]) => list.slice(0, MAX_OVERLAY_DECLARATIONS)
    .map((mapping) => `  ${mapping.targetToken}: ${mapping.value};`).join("\n");
  if (eligible.length > MAX_OVERLAY_DECLARATIONS) notes.push(`The copyable overlay includes at most ${MAX_OVERLAY_DECLARATIONS} declarations; review the complete mapping list for the rest.`);
  const blocks: string[] = [`/* Proposal only for the ${surface} surface. Review before integrating; this tool changes no files. */`];
  if (defaultMappings.length) blocks.push(`:root {\n${declarations(defaultMappings)}\n}`);
  if (lightMappings.length) blocks.push(`@media (prefers-color-scheme: light) {\n  :root {\n${declarations(lightMappings).replace(/^/gm, "  ")}\n  }\n}`);
  if (darkMappings.length) blocks.push(`@media (prefers-color-scheme: dark) {\n  :root {\n${declarations(darkMappings).replace(/^/gm, "  ")}\n  }\n}`);
  return { css: blocks.join("\n\n"), notes };
}

export function extractDesignProfile(input: { source: string; format: DesignProfileFormat; surface: DesignProfileSurface }): ExtractResult {
  if (typeof input.source !== "string" || !input.source.trim()) return fail("invalid_input", "Send non-empty CSS or token JSON.");
  if (Buffer.byteLength(input.source, "utf8") > MAX_SOURCE_BYTES) return fail("too_large", `Design input must be no more than ${MAX_SOURCE_BYTES} UTF-8 bytes.`);

  let extracted: { tokens: DesignToken[]; diagnostics: string[] };
  let jsonFormat: JsonTokenExtraction["format"] | null = null;
  if (input.format === "css") {
    try {
      extracted = collectCss(input.source);
    } catch (error) {
      const issue = error as { line?: number; column?: number };
      return fail("invalid_css", `CSS could not be parsed${issue.line ? ` near line ${issue.line}${issue.column ? `, column ${issue.column}` : ""}` : ""}.`);
    }
  } else {
    const parsed = collectJson(input.source);
    if (!parsed) return fail("invalid_json", "Send a JSON object containing string or number design tokens.");
    extracted = parsed;
    jsonFormat = parsed.format;
  }
  if (!extracted.tokens.length) return fail("no_tokens", "No supported custom properties or token values were found.");

  const grouped = new Map<string, { token: DesignToken; candidate: RoleCandidate }[]>();
  const unmapped: { token: string; value: string; scope: string; sourceContext: string; reason: string }[] = [];
  for (const token of extracted.tokens) {
    const candidate = roleCandidate(token.name);
    if (!candidate) {
      unmapped.push({ token: token.name, value: token.value, scope: token.scope, sourceContext: token.sourceContext, reason: "Token name does not clearly identify a KQA semantic role." });
      continue;
    }
    const key = `${token.scope}\u0000${candidate.role}`;
    grouped.set(key, [...(grouped.get(key) ?? []), { token, candidate }]);
  }

  const mappings: Mapping[] = [];
  const ambiguous: Record<string, unknown>[] = [];
  for (const [key, candidates] of grouped) {
    if (candidates.length !== 1) {
      const [scope, role] = key.split("\u0000");
      ambiguous.push({ scope, role, sourceTokens: candidates.map(({ token }) => token.name), reason: "More than one source token could fill this role; choose explicitly before integration." });
      continue;
    }
    const { token, candidate } = candidates[0]!;
    const recognized = !token.requiresReview
      && matchesDtcgType(candidate.category, token.sourceType)
      && recognizedValue(candidate.category, token.value);
    mappings.push({
      ...candidate,
      sourceToken: token.name,
      ...(token.sourceType ? { sourceType: token.sourceType } : {}),
      scope: token.scope,
      value: token.value,
      confidence: recognized ? "high" : "review",
      valueCheck: recognized ? "recognized" : "manual_review",
    });
  }

  const scopes = [...new Set(extracted.tokens.map((token) => token.scope))];
  const overlay = overlayCss(mappings, input.surface);
  const sourceHash = createHash("sha256").update(input.source).digest("hex");
  const darkTokenCount = extracted.tokens.filter((token) => token.scope === "dark").length;
  const profile = {
    profileVersion: "kqa-design-profile/2",
    policyVersion: "kqa-design/18",
    surface: input.surface,
    sourceFormat: input.format,
    ...(jsonFormat === "dtcg-2025.10" ? {
      tokenFormat: {
        name: "Design Tokens Format Module 2025.10 (bounded subset)",
        source: DTCG_FORMAT_URL,
        status: "W3C Design Tokens Community Group specification; not a W3C Standard.",
        colorModule: {
          name: "Design Tokens Color Module 2025.10",
          source: DTCG_COLOR_URL,
          status: "W3C Design Tokens Community Group specification; not a W3C Standard.",
          alphaHandling: "A hex fallback does not override alpha. Colors with alpha other than 1 remain manual-review values and are excluded from opaque CSS overlays and inferred contrast checks.",
        },
        supported: ["Nested groups and group $root tokens", "$value", "Inherited $type", "Color, dimension, and font-family normalization", "Curly-brace aliases", "Inline JSON Pointer references", "Top-level light/dark scope groups"],
        limitations: ["Group $extends inheritance and resolver-file permutations are not resolved.", "External file or URL references are not fetched.", "Translucent colors need manual review and are excluded from opaque overlays and contrast checks.", "Only inline token data is inspected; profile output remains proposal-only."],
      },
    } : {}),
    sourceSha256: sourceHash,
    extractedTokens: extracted.tokens,
    proposedMappings: mappings,
    ambiguousMappings: ambiguous,
    unmappedTokens: unmapped,
    contrastChecks: contrastChecks(mappings, scopes),
    themeCoverage: {
      scopes,
      hasDarkTokens: darkTokenCount > 0,
      note: darkTokenCount ? "Dark-scope tokens were found." : "No dark-scope tokens were found; confirm whether the target needs a dark theme.",
    },
    integrationProposal: {
      status: "proposal_only",
      note: "Mappings are heuristic and require review. KQA does not fetch, execute, store, or apply the supplied source.",
      cssOverlay: overlay.css,
      overlayNotes: overlay.notes,
    },
    diagnostics: extracted.diagnostics,
    limits: [
      "CSS and JSON are treated as inert, user-supplied text. No URL is fetched and no stylesheet code is executed.",
      ...(jsonFormat === "dtcg-2025.10" ? ["DTCG import is a bounded subset: $extends groups, resolver-file permutations, and external references are reported or left unresolved rather than fetched or applied."] : []),
      "Only uniquely mapped tokens are proposed. Name-based roles are suggestions, not proof of intended use.",
      "Contrast checks cover inferred token pairs with supported solid colors only; they do not inspect rendered UI, alpha compositing, gradients, images, typography, or every state.",
      "For questionnaire themes, host CSS variables do not cross the sandboxed iframe; integrate the proposal inside the questionnaire HTML and preview it before publishing.",
    ],
  };
  return { ok: true, profile };
}
