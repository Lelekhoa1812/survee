/**
 * Regenerates the parts of the documentation that must never drift from the code:
 *   docs/DIAGNOSTICS.md           from src/lib/diagnostics/catalog.ts
 *   docs/kqa-manifest.schema.json from the zod manifest schema
 *   docs/kqa-questionnaire-author/references/ from canonical docs and examples
 * Run with `npm run docs`. A test fails if the committed files are out of date.
 */
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { CATALOG, type Category } from "../src/lib/diagnostics/catalog";
import { manifestJsonSchema } from "../src/lib/format/schema";

const root = path.join(__dirname, "..", "docs");
mkdirSync(root, { recursive: true });

const skillReferences: Record<string, string> = {
  "FORMAT.md": "FORMAT.md",
  "AGENT_PLAYBOOK.md": "AGENT_PLAYBOOK.md",
  "DESIGN_SYSTEM.md": "DESIGN_SYSTEM.md",
  "INTERVIEW_PACKAGES.md": "INTERVIEW_PACKAGES.md",
  "REPEATABLE_RECORDS_DESIGN.md": "kqa-questionnaire-author/references/REPEATABLE_RECORDS_DESIGN.md",
  "QUESTION_BLUEPRINT.md": "QUESTION_BLUEPRINT.md",
  "MCP.md": "MCP.md",
  "QUESTIONNAIRE_AUTHORING_BENCHMARK.md": "evals/QUESTIONNAIRE_AUTHORING_BENCHMARK.md",
  "questionnaire-authoring-cases.json": "evals/questionnaire-authoring-cases.json",
  "PACKAGE_SELECTION_BENCHMARK.md": "evals/PACKAGE_SELECTION_BENCHMARK.md",
  "package-selection-cases.json": "evals/package-selection-cases.json",
  "package-selection.schema.json": "evals/package-selection.schema.json",
  "REPEATABLE_RECORD_SELECTION_BENCHMARK.md": "evals/REPEATABLE_RECORD_SELECTION_BENCHMARK.md",
  "repeatable-record-selection-cases.json": "evals/repeatable-record-selection-cases.json",
  "repeatable-record-selection.schema.json": "evals/repeatable-record-selection.schema.json",
  "PACKAGE_DRAFT_BENCHMARK.md": "evals/PACKAGE_DRAFT_BENCHMARK.md",
  "package-draft-cases.json": "evals/package-draft-cases.json",
  "package-draft-results.schema.json": "evals/package-draft-results.schema.json",
  "AUTHORING_TRUST_BOUNDARY_EVAL.md": "evals/AUTHORING_TRUST_BOUNDARY_EVAL.md",
  "AUTHORING_TRUST_BOUNDARY_CASES.json": "evals/authoring-trust-boundary-cases.json",
  "AUTHORING_TRUST_BOUNDARY_TRACE.schema.json": "evals/authoring-trust-boundary-trace.schema.json",
  "starter.kqa.html": "template/starter.kqa.html",
  "conditional-follow-up.kqa.html": "examples/conditional-follow-up.kqa.html",
  "routed-follow-up.kqa.html": "examples/routed-follow-up.kqa.html",
  "repeated-assets.kqa.html": "examples/repeated-assets.kqa.html",
  "service-improvement.kqa.html": "examples/service-improvement.kqa.html",
  "service-improvement.review.md": "examples/service-improvement.review.md",
  "industrial-operations.kqa.html": "examples/industrial-operations.kqa.html",
  "industrial-operations.review.md": "examples/industrial-operations.review.md",
  "personal-planning.kqa.html": "examples/personal-planning.kqa.html",
  "personal-planning.review.md": "examples/personal-planning.review.md",
  "question-order-variation.kqa.html": "examples/question-order-variation.kqa.html",
};
const referencesDir = path.join(root, "kqa-questionnaire-author", "references");
mkdirSync(referencesDir, { recursive: true });

const skillPathByDocPath = new Map(Object.entries(skillReferences).map(([name, source]) => [path.posix.normalize(source), name]));
skillPathByDocPath.set("kqa-questionnaire-author/SKILL.md", "../SKILL.md");

function portableSkillMarkdown(markdown: string, source: string) {
  return markdown.replace(/(\]\()(<[^>]+>|[^)\s]+)(?=[\s)])/g, (match, prefix: string, wrappedTarget: string) => {
    const target = wrappedTarget.startsWith("<") && wrappedTarget.endsWith(">")
      ? wrappedTarget.slice(1, -1)
      : wrappedTarget;
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) return match;

    const targetPath = target.split(/[?#]/, 1)[0];
    const suffix = target.slice(targetPath.length);
    const docPath = targetPath.startsWith("/api/docs/")
      ? path.posix.normalize(targetPath.slice("/api/docs/".length))
      : targetPath.startsWith("/")
        ? null
        : path.posix.normalize(path.posix.join(path.posix.dirname(source), targetPath));
    if (!docPath) return match;
    const skillPath = skillPathByDocPath.get(docPath);
    if (!skillPath) return match;
    const bundleTarget = path.posix.join("references", skillPath);
    const relativeTarget = path.posix.relative("references", bundleTarget);
    const replacement = `${prefix}${relativeTarget}${suffix}`;
    return wrappedTarget.startsWith("<") ? `${prefix}<${relativeTarget}${suffix}>` : replacement;
  });
}

for (const [name, source] of Object.entries(skillReferences)) {
  const sourcePath = path.join(root, source);
  const targetPath = path.join(referencesDir, name);
  if (name.endsWith(".md")) {
    writeFileSync(targetPath, portableSkillMarkdown(readFileSync(sourcePath, "utf8"), source));
  } else {
    copyFileSync(sourcePath, targetPath);
  }
}

const TITLES: Record<Category, string> = {
  file: "The file itself (KQA1xx)",
  manifest: "The manifest (KQA2xx)",
  binding: "Controls and bindings (KQA3xx, KQA4xx)",
  sandbox: "Sandbox and safety (KQA5xx)",
  quality: "Quality notes",
  runtime: "Live check in the browser (KQA6xx)",
  compat: "Replacing a survey that already has answers (KQA7xx)",
};

const out: string[] = [];
out.push("# Checker codes");
out.push("");
out.push("<!-- Generated by `npm run docs` from src/lib/diagnostics/catalog.ts. Do not edit by hand. -->");
out.push("");
out.push("Every finding the checker reports has a stable code. This page explains each one and how to fix it. Errors block the upload. Warnings and notes do not, but warnings usually mean something will look wrong or lose data.");
out.push("");
out.push(`There are ${CATALOG.length} codes. Severity is **error**, **warning** or **note**.`);

for (const cat of Object.keys(TITLES) as Category[]) {
  const list = CATALOG.filter((c) => c.category === cat);
  if (!list.length) continue;
  out.push("");
  out.push(`## ${TITLES[cat]}`);
  for (const c of list) {
    out.push("");
    out.push(`### ${c.code}: ${c.title}`);
    out.push("");
    out.push(`Severity: **${c.severity === "info" ? "note" : c.severity}**`);
    out.push("");
    out.push(c.explain);
    out.push("");
    out.push(`**How to fix:** ${c.fix}`);
    if (c.example) {
      out.push("");
      out.push("Wrong:");
      out.push("");
      out.push("```html");
      out.push(c.example.wrong);
      out.push("```");
      out.push("");
      out.push("Right:");
      out.push("");
      out.push("```html");
      out.push(c.example.right);
      out.push("```");
    }
  }
}
out.push("");
writeFileSync(path.join(root, "DIAGNOSTICS.md"), out.join("\n"));
writeFileSync(path.join(root, "kqa-manifest.schema.json"), JSON.stringify(manifestJsonSchema(), null, 2) + "\n");
console.log(`Wrote docs/DIAGNOSTICS.md (${CATALOG.length} codes) and docs/kqa-manifest.schema.json`);
