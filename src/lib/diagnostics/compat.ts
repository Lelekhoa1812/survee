import type { AnswerMap, Manifest, RepeatRecordMap } from "../format/schema";
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
  answers: { answers: AnswerMap; status: string; recordGroups?: RepeatRecordMap }[];
}

function make(code: string, message: string, fix?: string, questionId?: string): Diagnostic {
  const e = entry(code);
  return { code, severity: e.severity, category: e.category, title: e.title, message, fix: fix ?? e.fix, questionId };
}

export function compareVersions({ previous, next, answers }: CompatInput): Diagnostic[] {
  const out: Diagnostic[] = [];
  const nextById = new Map(next.questions.map((q) => [q.id, q]));
  const prevById = new Map(previous.questions.map((q) => [q.id, q]));
  const answeredPeopleByQuestion = new Map<string, number>();
  const optionUsageByQuestion = new Map<string, Map<string, number>>();
  const peopleOverNewSelectionLimit = new Map<string, number>();
  const peopleUnderNewSelectionMinimum = new Map<string, number>();
  const peopleWithExclusiveConflicts = new Map<string, number>();
  const repeatDataChanges = new Map<string, Set<number>>();
  let submitted = 0;
  let peopleWithAnyAnswers = 0;

  // Aggregate participant data once. Compatibility checks run both during admin previews and MCP
  // version changes, so scanning every participant again for each question/option is costly.
  for (const [personIndex, person] of answers.entries()) {
    if (person.status === "submitted") submitted += 1;
    let personHasAnyAnswer = false;
    for (const [questionId, answer] of Object.entries(person.answers)) {
      if (answer.value !== undefined || !!answer.note) {
        personHasAnyAnswer = true;
        answeredPeopleByQuestion.set(questionId, (answeredPeopleByQuestion.get(questionId) ?? 0) + 1);
      }

      const values = typeof answer.value === "string"
        ? [answer.value]
        : Array.isArray(answer.value)
          ? answer.value
          : [];
      if (values.length === 0) continue;
      const nextQuestion = nextById.get(questionId);
      if (nextQuestion?.type === "multi" && nextQuestion.maxSelections !== undefined && Array.isArray(answer.value)) {
        const retained = new Set(nextQuestion.options?.map((option) => option.value) ?? []);
        const retainedSelections = new Set(answer.value.filter((value) => retained.has(value)));
        if (retainedSelections.size > nextQuestion.maxSelections) {
          peopleOverNewSelectionLimit.set(questionId, (peopleOverNewSelectionLimit.get(questionId) ?? 0) + 1);
        }
      }
      if (nextQuestion?.type === "multi" && nextQuestion.minSelections !== undefined && Array.isArray(answer.value)) {
        const retained = new Set(nextQuestion.options?.map((option) => option.value) ?? []);
        const retainedSelections = new Set(answer.value.filter((value) => retained.has(value)));
        if (retainedSelections.size > 0 && retainedSelections.size < nextQuestion.minSelections) {
          peopleUnderNewSelectionMinimum.set(questionId, (peopleUnderNewSelectionMinimum.get(questionId) ?? 0) + 1);
        }
      }
      if (nextQuestion?.type === "multi" && Array.isArray(answer.value)) {
        const retained = new Set(nextQuestion.options?.map((option) => option.value) ?? []);
        const retainedSelections = new Set(answer.value.filter((value) => retained.has(value)));
        const exclusive = new Set(nextQuestion.exclusiveOptions ?? []);
        if ([...retainedSelections].some((value) => exclusive.has(value)) && retainedSelections.size > 1) {
          peopleWithExclusiveConflicts.set(questionId, (peopleWithExclusiveConflicts.get(questionId) ?? 0) + 1);
        }
      }
      let counts = optionUsageByQuestion.get(questionId);
      if (!counts) {
        counts = new Map();
        optionUsageByQuestion.set(questionId, counts);
      }
      // Existing semantics count a person once per option, even if malformed stored data repeats it.
      for (const value of new Set(values)) counts.set(value, (counts.get(value) ?? 0) + 1);
    }
    for (const [questionId, rows] of Object.entries(person.recordGroups ?? {})) {
      const activeRows = rows.filter((row) => !row.deletedAt);
      if (activeRows.length) {
        personHasAnyAnswer = true;
        answeredPeopleByQuestion.set(questionId, (answeredPeopleByQuestion.get(questionId) ?? 0) + 1);
      }
      const oldQuestion = prevById.get(questionId);
      const nextQuestion = nextById.get(questionId);
      if (oldQuestion?.type !== "repeat" || nextQuestion?.type !== "repeat" || activeRows.length === 0) continue;
      const nextFields = new Map((nextQuestion.fields ?? []).map((field) => [field.id, field]));
      let affected = nextQuestion.maxRows !== undefined && activeRows.length > nextQuestion.maxRows;
      for (const row of activeRows) {
        for (const [fieldId, value] of Object.entries(row.values ?? {})) {
          if (value === "" || value === null || value === undefined) continue;
          const oldField = (oldQuestion.fields ?? []).find((field) => field.id === fieldId);
          const nextField = nextFields.get(fieldId);
          const contract = (field: typeof oldField) => field ? JSON.stringify({ type: field.type, required: field.required, options: field.options, min: field.min, max: field.max, step: field.step, maxLength: field.maxLength }) : null;
          if (!nextField || contract(oldField) !== contract(nextField)) affected = true;
        }
      }
      if (affected) {
        if (!repeatDataChanges.has(questionId)) repeatDataChanges.set(questionId, new Set());
        repeatDataChanges.get(questionId)!.add(personIndex);
      }
    }
    if (personHasAnyAnswer) peopleWithAnyAnswers += 1;
  }

  const previousPresentation = previous.presentation ?? "all";
  const nextPresentation = next.presentation ?? "all";
  if (previousPresentation !== nextPresentation && peopleWithAnyAnswers > 0) {
    out.push(make("KQA710", `The respondent presentation changed from "${previousPresentation}" to "${nextPresentation}" while ${peopleWithAnyAnswers} ${peopleWithAnyAnswers === 1 ? "person has" : "people have"} saved answers. Their data remains attached to the same questions, but the changed flow may affect context and burden.`));
  }

  const nextByNewLabel = new Map<string, (typeof next.questions)[number]>();
  for (const question of next.questions) {
    if (prevById.has(question.id)) continue;
    const label = question.label.trim().toLowerCase();
    if (!nextByNewLabel.has(label)) nextByNewLabel.set(label, question);
  }

  for (const q of previous.questions) {
    const people = answeredPeopleByQuestion.get(q.id) ?? 0;
    const n = nextById.get(q.id);
    if (!n) {
      if (people > 0) {
        out.push(make("KQA700", `Question "${q.id}" ("${q.label}") is not in the new version, and ${people} ${people === 1 ? "person has" : "people have"} answered it.`, undefined, q.id));
      }
      const renamed = nextByNewLabel.get(q.label.trim().toLowerCase());
      if (renamed) out.push(make("KQA703", `"${q.id}" is gone and "${renamed.id}" is new, with the same label "${q.label}". If this is a rename, answers will not follow it.`, `Restore the id "${q.id}" instead of "${renamed.id}".`, q.id));
      continue;
    }
    if (n.type !== q.type && people > 0) {
      out.push(make("KQA701", `Question "${q.id}" changed from "${q.type}" to "${n.type}", and ${people} saved ${people === 1 ? "answer uses" : "answers use"} the old type.`, undefined, q.id));
    }
    if (n.type === "repeat" && q.type === "repeat") {
      const affected = repeatDataChanges.get(q.id)?.size ?? 0;
      if (affected > 0) out.push(make("KQA709", `Repeated-record fields or the row limit for "${q.id}" changed while saved data from ${affected} ${affected === 1 ? "person may" : "people may"} no longer fit the new definition.`, undefined, q.id));
    }
    if (n.type === q.type && q.options && n.options) {
      const keep = new Set(n.options.map((o) => o.value));
      const removed = q.options.filter((o) => !keep.has(o.value));
      for (const o of removed) {
        const used = optionUsageByQuestion.get(q.id)?.get(o.value) ?? 0;
        if (used > 0) out.push(make("KQA702", `Option "${o.value}" ("${o.label}") of "${q.id}" is not in the new version, but ${used} ${used === 1 ? "person chose" : "people chose"} it.`, undefined, q.id));
      }
    }
    const oldValues = q.options?.map((option) => option.value) ?? [];
    const newValues = n.options?.map((option) => option.value) ?? [];
    const sameOptionSet = oldValues.length === newValues.length && oldValues.every((value) => newValues.includes(value));
    const authoredOrderChanged = sameOptionSet && JSON.stringify(oldValues) !== JSON.stringify(newValues);
    const oldFixed = [...(q.fixedOptionValues ?? [])].sort();
    const newFixed = [...(n.fixedOptionValues ?? [])].sort();
    if (people > 0 && n.type === q.type && ((q.randomizeOptions ?? false) !== (n.randomizeOptions ?? false) || JSON.stringify(oldFixed) !== JSON.stringify(newFixed) || authoredOrderChanged)) {
      out.push(make("KQA708", `Question "${q.id}" changed its option presentation order or rotation policy while ${people} ${people === 1 ? "person has" : "people have"} saved an answer.`, undefined, q.id));
    }
    if (n.type === "multi" && n.maxSelections !== undefined) {
      const peopleOverLimit = peopleOverNewSelectionLimit.get(q.id) ?? 0;
      if (peopleOverLimit > 0) {
        out.push(make("KQA705", `Question "${q.id}" now allows at most ${n.maxSelections} choices, but ${peopleOverLimit} ${peopleOverLimit === 1 ? "person has" : "people have"} already saved more.`, undefined, q.id));
      }
    }
    if (n.type === "multi" && n.minSelections !== undefined) {
      const peopleUnderMinimum = peopleUnderNewSelectionMinimum.get(q.id) ?? 0;
      if (peopleUnderMinimum > 0) {
        out.push(make("KQA707", `Question "${q.id}" now requires at least ${n.minSelections} choices when answered, but ${peopleUnderMinimum} ${peopleUnderMinimum === 1 ? "person has" : "people have"} already saved fewer.`, undefined, q.id));
      }
    }
    if (n.type === "multi") {
      const peopleWithConflicts = peopleWithExclusiveConflicts.get(q.id) ?? 0;
      if (peopleWithConflicts > 0) out.push(make("KQA706", `Question "${q.id}" now has exclusive options, but ${peopleWithConflicts} ${peopleWithConflicts === 1 ? "person has" : "people have"} already saved conflicting choices.`, undefined, q.id));
    }
  }
  if (submitted > 0) {
    for (const q of next.questions) {
      if (q.required && !prevById.get(q.id)?.required) {
        out.push(make("KQA704", `"${q.id}" is required in the new version, and ${submitted} ${submitted === 1 ? "person has" : "people have"} already submitted without it.`, undefined, q.id));
      }
    }
  }
  return out;
}
