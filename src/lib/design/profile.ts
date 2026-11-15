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
}

interface RoleCandidate {
  role: string;
  targetToken: string;
  category: "color" | "font" | "length" | "shadow";
  rationale: string;
}

interface Mapping extends RoleCandidate {
  sourceToken: string;
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

function collectJson(source: string): { tokens: DesignToken[]; diagnostics: string[] } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
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
  return { tokens, diagnostics };
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
    const recognized = recognizedValue(candidate.category, token.value);
    mappings.push({
      ...candidate,
      sourceToken: token.name,
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
    profileVersion: "kqa-design-profile/1",
    policyVersion: "kqa-design/12",
    surface: input.surface,
    sourceFormat: input.format,
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
      "Only uniquely mapped tokens are proposed. Name-based roles are suggestions, not proof of intended use.",
      "Contrast checks cover inferred token pairs with supported solid colors only; they do not inspect rendered UI, alpha compositing, gradients, images, typography, or every state.",
      "For questionnaire themes, host CSS variables do not cross the sandboxed iframe; integrate the proposal inside the questionnaire HTML and preview it before publishing.",
    ],
  };
  return { ok: true, profile };
}
