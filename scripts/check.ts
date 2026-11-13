/**
 * Check one or more questionnaire files from the terminal, with the same checker the app uses.
 *
 *   npm run check -- path/to/file.html            plain-text findings
 *   npm run check -- path/to/file.html --agent    the markdown report to paste to the AI agent
 *   npm run check -- path/to/file.html --json     the full report as JSON
 *
 * Exit code 0 when there are no errors, 1 when there are, 2 on a usage problem.
 * The checker is static (it reads the file). The live browser check only runs inside the app.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { checkHtml } from "../src/lib/diagnostics/static";
import { toAgentMarkdown, toPlainText } from "../src/lib/diagnostics/report";

const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith("--"));
const mode = args.includes("--json") ? "json" : args.includes("--agent") ? "agent" : "text";
if (!files.length) {
  console.error("Usage: npm run check -- <file.html> [more files] [--agent | --json]");
  process.exit(2);
}

let failed = false;
for (const file of files) {
  let html: string;
  try {
    html = readFileSync(file, "utf8");
  } catch (e) {
    console.error(`Cannot read ${file}: ${(e as Error).message}`);
    process.exit(2);
  }
  const report = checkHtml(html, { fileName: path.basename(file) });
  if (!report.ok) failed = true;
  console.log(mode === "json" ? JSON.stringify(report, null, 2) : mode === "agent" ? toAgentMarkdown(report) : toPlainText(report));
}
process.exit(failed ? 1 : 0);
