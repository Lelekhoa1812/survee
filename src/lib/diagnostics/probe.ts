import { entry } from "./catalog";
import type { Diagnostic } from "./types";

/** What the bridge posts back when the admin runs the probe in the real frame. */
export interface ProbeMessage {
  results: { code: string; questionId?: string; message: string }[];
  tested: number;
  errors: { message: string; line?: number; column?: number; stack?: string; rejection?: boolean }[];
  consoleErrors: string[];
  visibleTextLength: number;
  overflowPx: number;
  viewportWidth: number;
}

function make(code: string, message: string, extra: Partial<Diagnostic> = {}): Diagnostic {
  const e = entry(code);
  return { code, severity: e.severity, category: e.category, title: e.title, message, fix: e.fix, ...extra };
}

/** Turn the probe's raw result into diagnostics, with the same shape as the static checker's. */
export function probeToDiagnostics(p: ProbeMessage): Diagnostic[] {
  const out: Diagnostic[] = [];
  for (const r of p.results) out.push(make(r.code, r.message, { questionId: r.questionId }));
  for (const e of p.errors) {
    if (e.rejection) out.push(make("KQA603", e.message));
    else out.push(make("KQA600", `${e.message}${e.line ? ` (line ${e.line}${e.column ? `, column ${e.column}` : ""} of the running page)` : ""}${e.stack ? `\n${e.stack}` : ""}`));
  }
  for (const m of [...new Set(p.consoleErrors)].slice(0, 5)) out.push(make("KQA604", m));
  if (p.visibleTextLength === 0) out.push(make("KQA606", "The page rendered no visible text."));
  if (p.overflowPx > 0) out.push(make("KQA607", `At ${p.viewportWidth}px wide the content is ${p.overflowPx}px wider than the screen.`));
  return out;
}

export function probeTimeoutDiagnostic(): Diagnostic {
  return make("KQA605", "The page did not report ready within 8 seconds, so the live check could not run.");
}
