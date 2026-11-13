import { displayValue, progress } from "../format/answers";
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
      const answers: Record<string, { value?: unknown; display: string; note?: string; updatedAt: string }> = {};
      for (const q of manifest.questions) {
        const a = p.answers[q.id];
        if (!a) continue;
        answers[q.id] = {
          value: a.value,
          display: displayValue(q, a.value),
          note: a.note,
          updatedAt: a.updatedAt,
        };
      }
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
          requiredAnswered: pr.requiredAnswered,
          requiredTotal: pr.requiredTotal,
        },
        answers,
      };
    }),
  };
  return {
    filename: exportFilename(input, "json"),
    contentType: "application/json",
    body: `${JSON.stringify(doc, null, 2)}\n`,
  };
}
