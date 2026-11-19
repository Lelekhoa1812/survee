import { displayValue, evaluateEligibility, progress } from "../format/answers";
import { exportFilename, sortedParticipants } from "./rows";
import type { ExportFile, ExportInput } from "./types";

/** Machine-readable export. Participant tokens are never included: the type does not carry them. */
export function jsonExport(input: ExportInput): ExportFile {
  const { manifest } = input;
  const doc = {
    exportVersion: 1,
    generatedAt: input.generatedAt,
    interview: {
      id: input.interview.id,
      name: input.interview.name,
      description: input.interview.description,
      mode: input.interview.mode,
      status: input.interview.status,
      createdAt: input.interview.createdAt,
    },
    survey: {
      version: input.surveyVersion,
      title: manifest.title,
      description: manifest.description,
      sections: manifest.sections,
      questions: manifest.questions,
    },
    participants: sortedParticipants(input).map((p) => {
      const pr = progress(manifest, p.answers);
      const eligibility = evaluateEligibility(manifest, p.answers);
      const answers: Record<string, { value?: unknown; display: string; note?: string; updatedAt: string; presentedOptionOrder?: string[]; optionOrderVersion?: number }> = {};
      for (const q of manifest.questions) {
        const a = p.answers[q.id];
        if (!a) continue;
        answers[q.id] = {
          value: a.value,
          display: displayValue(q, a.value),
          note: a.note,
          updatedAt: a.updatedAt,
          presentedOptionOrder: a.presentedOptionOrder,
          optionOrderVersion: a.optionOrderVersion,
        };
      }
      const recordGroups = Object.fromEntries(
        Object.entries(p.recordGroups ?? {})
          .filter(([, rows]) => rows.length > 0)
          .map(([questionId, rows]) => [questionId, rows.map(({ id, values }) => ({ id, values }))]),
      );
      return {
        id: p.id,
        name: p.name,
        note: p.note,
        status: p.status,
        createdAt: p.createdAt,
        lastSavedAt: p.lastSavedAt,
        submittedAt: p.submittedAt,
        progress: {
          answered: pr.answered,
          total: pr.total,
          surveyTotal: manifest.questions.length,
          inactive: pr.inactive,
          requiredAnswered: pr.requiredAnswered,
          requiredTotal: pr.requiredTotal,
        },
        /** Current-rule inference; KQA does not record whether a question was actually rendered. */
        eligibility: Object.fromEntries(manifest.questions.map((q) => [q.id, eligibility[q.id] === false ? "inactive" : "eligible"])),
        answers,
        ...(Object.keys(recordGroups).length ? { recordGroups } : {}),
      };
    }),
  };
  return {
    filename: exportFilename(input, "json"),
    contentType: "application/json",
    body: `${JSON.stringify(doc, null, 2)}\n`,
  };
}
