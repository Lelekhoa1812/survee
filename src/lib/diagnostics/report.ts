import { entry } from "./catalog";
import type { Diagnostic, Report } from "./types";

const plural = (n: number, one: string, many = one + "s") => `${n} ${n === 1 ? one : many}`;

function summaryLine(r: Report): string {
  const parts = [plural(r.counts.error, "error"), plural(r.counts.warning, "warning"), plural(r.counts.info, "note")];
  return `${r.ok ? "PASSED" : "FAILED"}: ${parts.join(", ")}`;
}

function where(d: Diagnostic): string {
  const bits: string[] = [];
  if (d.location) bits.push(`line ${d.location.line}, column ${d.location.column}`);
  if (d.questionId) bits.push(`question \`${d.questionId}\``);
  if (d.path) bits.push(`manifest path \`${d.path}\``);
  return bits.join(" · ");
}

/**
 * The report written for an AI agent: everything it needs to fix the file in one pass, with the rules of the
 * format restated, so it can be pasted into a chat with no other context.
 */
export function toAgentMarkdown(r: Report): string {
  const lines: string[] = [];
  const name = r.fileName ?? "questionnaire.html";
  lines.push(`# KQA checker report for ${name}`);
  lines.push("");
  lines.push(`Checker ${r.checkerVersion} · format ${r.formatVersion} · checked ${r.checkedAt}`);
  lines.push(`**Result: ${summaryLine(r)}**`);
  lines.push("");
  lines.push("## Instructions for the agent that wrote this file");
  lines.push("");
  if (!r.ok) {
    lines.push("You produced an HTML questionnaire for the KQA app. The checker found blocking errors. Work through the findings below and return a corrected file.");
  } else if (r.counts.warning > 0) {
    lines.push("This file passes the blocking checks, but has warnings to review before it is shared. Work through the findings below and return a corrected file if you make changes.");
  } else {
    lines.push("This file passed the static checker. Review the rendered page, mobile layout, keyboard interaction, and reduced-motion behavior before sharing it.");
  }
  lines.push("");
  lines.push("1. Fix every ERROR. Fix every WARNING too unless you have a specific reason not to, and say so if you skip one.");
  lines.push("2. Return the COMPLETE corrected HTML file (from `<!doctype html>` to `</html>`), not a diff and not a snippet.");
  lines.push("3. Do not rename question ids or option values that already exist. Saved answers are keyed by them. Change labels instead.");
  lines.push("4. Line numbers refer to the file as uploaded. The rules are in docs/FORMAT.md; every code is explained in docs/DIAGNOSTICS.md.");
  lines.push("5. After fixing, re-read your output against the rules before replying: every manifest question needs a matching `data-kqa` control, and every control's `value` must equal a manifest option value exactly.");

  const sections: [string, Diagnostic[]][] = [
    ["Errors", r.diagnostics.filter((d) => d.severity === "error")],
    ["Warnings", r.diagnostics.filter((d) => d.severity === "warning")],
    ["Notes", r.diagnostics.filter((d) => d.severity === "info")],
  ];
  const tag = { Errors: "E", Warnings: "W", Notes: "N" } as const;
  for (const [title, list] of sections) {
    if (!list.length) continue;
    lines.push("");
    lines.push(`## ${title} (${list.length})`);
    list.forEach((d, i) => {
      lines.push("");
      lines.push(`### ${tag[title as keyof typeof tag]}${i + 1} · ${d.code} · ${d.title}`);
      const w = where(d);
      if (w) lines.push(`Where: ${w}`);
      lines.push(`Problem: ${d.message}`);
      lines.push(`Fix: ${d.fix}`);
      if (d.context) {
        lines.push("Source:");
        lines.push("```html");
        lines.push(d.context);
        lines.push("```");
      }
    });
  }

  if (r.manifest) {
    lines.push("");
    lines.push("## Manifest as read");
    lines.push("");
    lines.push(`Title: ${r.manifest.title}. ${plural(r.manifest.questions.length, "question")}.`);
    for (const q of r.manifest.questions) {
      const opts = q.options ? ` options: ${q.options.map((o) => o.value).join(", ")}` : "";
      lines.push(`- \`${q.id}\` (${q.type}${q.required ? ", required" : ""}${q.note ? ", note" : ""}${q.custom ? ", custom" : ""})${opts}`);
    }
  }

  const used = [...new Set(r.diagnostics.map((d) => d.code))];
  if (used.length) {
    lines.push("");
    lines.push("## What these codes mean");
    for (const code of used) {
      const e = entry(code);
      lines.push("");
      lines.push(`- **${code} ${e.title}.** ${e.explain}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

/** A compact plain-text version for the terminal and for emails. */
export function toPlainText(r: Report): string {
  const out: string[] = [`${r.fileName ?? "questionnaire.html"}: ${summaryLine(r)}`];
  for (const d of r.diagnostics) {
    const loc = d.location ? `L${d.location.line}:${d.location.column}` : "";
    out.push(`${d.severity.toUpperCase().padEnd(7)} ${d.code} ${loc.padEnd(8)} ${d.title}`);
    out.push(`        ${d.message}`);
    out.push(`        Fix: ${d.fix}`);
  }
  return out.join("\n");
}

/** Merge diagnostics from the browser probe into a static report. */
export function mergeDiagnostics(r: Report, extra: Diagnostic[]): Report {
  const diagnostics = [...r.diagnostics, ...extra];
  const rank = { error: 0, warning: 1, info: 2 } as const;
  diagnostics.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.location?.line ?? 1e9) - (b.location?.line ?? 1e9) || a.code.localeCompare(b.code));
  const counts = { error: 0, warning: 0, info: 0 };
  for (const d of diagnostics) counts[d.severity]++;
  return { ...r, diagnostics, counts, ok: counts.error === 0 };
}
