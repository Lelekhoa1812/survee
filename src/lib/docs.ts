import { readFile } from "node:fs/promises";
import path from "node:path";

export const DOCS = [
  { slug: "format", file: "FORMAT.md", title: "Format specification", blurb: "Every rule a questionnaire file must follow." },
  { slug: "agent-playbook", file: "AGENT_PLAYBOOK.md", title: "AI agent playbook", blurb: "Step-by-step instructions for an agent that writes the file." },
  { slug: "design-system", file: "DESIGN_SYSTEM.md", title: "Design system", blurb: "Sourced visual, accessibility, interaction, and analytics guidance." },
  { slug: "interview-packages", file: "INTERVIEW_PACKAGES.md", title: "Interview packages", blurb: "Adaptable domain briefs, safeguards and review criteria for interview authors." },
  { slug: "question-blueprint", file: "QUESTION_BLUEPRINT.md", title: "Question blueprint", blurb: "Reusable record connecting a question's purpose, interpretation, routing, risks and testing." },
  { slug: "questionnaire-author-skill", file: "kqa-questionnaire-author/SKILL.md", title: "Questionnaire author skill", blurb: "Portable, repeatable workflow for agents authoring and reviewing KQA interviews." },
  { slug: "repeatable-records-design", file: "kqa-questionnaire-author/references/REPEATABLE_RECORDS_DESIGN.md", title: "Repeatable records proposal", blurb: "Research-backed decision guidance and design constraints for a future bounded repeated-record capability." },
  { slug: "repeatable-record-selection-benchmark", file: "evals/REPEATABLE_RECORD_SELECTION_BENCHMARK.md", title: "Repeatable record selection benchmark", blurb: "Development cases testing when to use repeated records and when KQA must choose an existing pattern, clarify, or decline." },
  { slug: "questionnaire-authoring-benchmark", file: "evals/QUESTIONNAIRE_AUTHORING_BENCHMARK.md", title: "Questionnaire evaluation benchmark", blurb: "Versioned review corpus, provider-neutral scoring, and evaluation limits for questionnaire authoring agents." },
  { slug: "package-selection-benchmark", file: "evals/PACKAGE_SELECTION_BENCHMARK.md", title: "Package-selection benchmark", blurb: "Development cases for package fit, clarification, and capability boundaries." },
  { slug: "package-draft-benchmark", file: "evals/PACKAGE_DRAFT_BENCHMARK.md", title: "Package draft benchmark", blurb: "Expert content review rubric and separate functional, accessibility, respondent-pretest and format evidence lanes." },
  { slug: "authoring-trust-boundary-eval", file: "evals/AUTHORING_TRUST_BOUNDARY_EVAL.md", title: "Authoring trust-boundary evaluation", blurb: "Seed cases and a trace evaluator for agent prompt-injection, tool-scope, authorization, and approval behavior." },
  { slug: "mcp", file: "MCP.md", title: "KQA MCP server", blurb: "Connection, permissions and operating procedures for live interviews." },
  { slug: "diagnostics", file: "DIAGNOSTICS.md", title: "Checker codes", blurb: "What each error and warning means and how to fix it." },
] as const;

const root = () => path.join(process.cwd(), "docs");

export async function readDoc(file: string): Promise<string | null> {
  try {
    return await readFile(path.join(root(), file), "utf8");
  } catch {
    return null;
  }
}

export async function readAsset(rel: string): Promise<{ body: string; type: string } | null> {
  const allowed: Record<string, string> = {
    "template/starter.kqa.html": "text/html; charset=utf-8",
    "examples/conditional-follow-up.kqa.html": "text/html; charset=utf-8",
    "examples/routed-follow-up.kqa.html": "text/html; charset=utf-8",
    "examples/service-improvement.kqa.html": "text/html; charset=utf-8",
    "examples/service-improvement.review.md": "text/markdown; charset=utf-8",
    "examples/personal-planning.kqa.html": "text/html; charset=utf-8",
    "examples/personal-planning.review.md": "text/markdown; charset=utf-8",
    "kqa-manifest.schema.json": "application/json; charset=utf-8",
    "evals/questionnaire-authoring-cases.json": "application/json; charset=utf-8",
    "evals/package-draft-cases.json": "application/json; charset=utf-8",
    "evals/package-draft-results.schema.json": "application/json; charset=utf-8",
    "evals/package-selection-cases.json": "application/json; charset=utf-8",
    "evals/package-selection.schema.json": "application/json; charset=utf-8",
    "evals/repeatable-record-selection-cases.json": "application/json; charset=utf-8",
    "evals/repeatable-record-selection.schema.json": "application/json; charset=utf-8",
    "evals/authoring-trust-boundary-cases.json": "application/json; charset=utf-8",
    "evals/authoring-trust-boundary-trace.schema.json": "application/json; charset=utf-8",
  };
  const type = allowed[rel];
  if (!type) return null;
  const body = await readDoc(rel);
  return body === null ? null : { body, type };
}

/** One document that holds everything an AI agent needs: paste it, or point the agent at its URL. */
export async function buildBundle(origin: string): Promise<string> {
  const parts: string[] = [];
  parts.push("# KQA questionnaire format: everything an AI agent needs\n");
  parts.push(`This bundle was generated by the KQA app (${origin}). It contains the format specification, agent playbook and skill, design guidance, interview packages, question blueprint, questionnaire content-review and tool-safety evaluation guides, live MCP operations guide, checker code reference, JSON Schema and a starter file. Use the checker to identify format problems; it cannot assess every issue with wording, accessibility or suitability.\n`);
  for (const d of DOCS) {
    const text = await readDoc(d.file);
    if (text) parts.push(`\n\n---\n\n<!-- ${d.file} -->\n\n${text.trim()}\n`);
  }
  const schema = await readDoc("kqa-manifest.schema.json");
  if (schema) parts.push(`\n\n---\n\n## Appendix A. JSON Schema of the manifest\n\n\`\`\`json\n${schema.trim()}\n\`\`\`\n`);
  const starter = await readDoc("template/starter.kqa.html");
  if (starter) parts.push(`\n\n---\n\n## Appendix B. Known-good starter file\n\nCopy this and replace the content. It passes the checker as it stands.\n\n\`\`\`html\n${starter.trim()}\n\`\`\`\n`);
  return parts.join("");
}
