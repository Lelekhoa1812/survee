import type { AnswerMap, Manifest } from "../format/schema";
import { entry } from "./catalog";
import type { Diagnostic } from "./types";

/**
 * Compare a new survey version with the current one and the answers people have already given, so replacing a
 * file never silently orphans data. Returned diagnostics use the KQA7xx codes.
 */
export interface CompatInput {
  previous: Manifest;
  next: Manifest;
  /** One AnswerMap per participant. */
  answers: { answers: AnswerMap; status: string }[];
}

function make(code: string, message: string, fix?: string, questionId?: string): Diagnostic {
  const e = entry(code);
  return { code, severity: e.severity, category: e.category, title: e.title, message, fix: fix ?? e.fix, questionId };
}

export function compareVersions({ previous, next, answers }: CompatInput): Diagnostic[] {
  const out: Diagnostic[] = [];
  const nextById = new Map(next.questions.map((q) => [q.id, q]));
  const prevById = new Map(previous.questions.map((q) => [q.id, q]));
  const hasAnswer = (a: AnswerMap, id: string) => a[id] && (a[id].value !== undefined || !!a[id].note);

  for (const q of previous.questions) {
    const people = answers.filter((p) => hasAnswer(p.answers, q.id)).length;
    const n = nextById.get(q.id);
    if (!n) {
      if (people > 0) {
        out.push(make("KQA700", `Question "${q.id}" ("${q.label}") is not in the new version, and ${people} ${people === 1 ? "person has" : "people have"} answered it.`, undefined, q.id));
      }
      const renamed = next.questions.find((x) => !prevById.has(x.id) && x.label.trim().toLowerCase() === q.label.trim().toLowerCase());
      if (renamed) out.push(make("KQA703", `"${q.id}" is gone and "${renamed.id}" is new, with the same label "${q.label}". If this is a rename, answers will not follow it.`, `Restore the id "${q.id}" instead of "${renamed.id}".`, q.id));
      continue;
    }
    if (n.type !== q.type && people > 0) {
      out.push(make("KQA701", `Question "${q.id}" changed from "${q.type}" to "${n.type}", and ${people} saved ${people === 1 ? "answer uses" : "answers use"} the old type.`, undefined, q.id));
    }
    if (n.type === q.type && q.options && n.options) {
      const keep = new Set(n.options.map((o) => o.value));
      const removed = q.options.filter((o) => !keep.has(o.value));
      for (const o of removed) {
        const used = answers.filter((p) => {
          const v = p.answers[q.id]?.value;
          return Array.isArray(v) ? v.includes(o.value) : v === o.value;
        }).length;
        if (used > 0) out.push(make("KQA702", `Option "${o.value}" ("${o.label}") of "${q.id}" is not in the new version, but ${used} ${used === 1 ? "person chose" : "people chose"} it.`, undefined, q.id));
      }
    }
  }
  const submitted = answers.filter((p) => p.status === "submitted").length;
  if (submitted > 0) {
    for (const q of next.questions) {
      if (q.required && !prevById.get(q.id)?.required) {
        out.push(make("KQA704", `"${q.id}" is required in the new version, and ${submitted} ${submitted === 1 ? "person has" : "people have"} already submitted without it.`, undefined, q.id));
      }
    }
  }
  return out;
}
