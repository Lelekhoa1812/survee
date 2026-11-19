import { createHash } from "node:crypto";
import type { Manifest } from "./schema";

/** Bump only when the assignment algorithm changes; saved assignments remain authoritative. */
export const QUESTION_ORDER_ALGORITHM = "kqa-question-order-v1";

export interface QuestionOrderAssignment {
  algorithmVersion: string;
  groups: Record<string, string[]>;
}

/**
 * Build a repeatable per-participant, per-version assignment. The caller persists the
 * complete group permutations before returning them to a respondent. Authored order
 * remains canonical everywhere else.
 */
export function assignQuestionOrder(manifest: Manifest, participantId: string, surveyVersion: number): QuestionOrderAssignment {
  const groups: Record<string, string[]> = {};
  for (const group of manifest.questionOrderGroups ?? []) {
    const ordered = [...group.questionIds];
    const seed = JSON.stringify([QUESTION_ORDER_ALGORITHM, participantId, surveyVersion, group.id, group.questionIds]);
    // A counter-based stream avoids ambient randomness and is stable across Node versions.
    let counter = 0;
    const below = (bound: number) => {
      const range = 0x1_0000_0000;
      const limit = Math.floor(range / bound) * bound;
      let value = 0;
      do {
        value = createHash("sha256").update(`${seed}:${counter++}`).digest().readUInt32BE(0);
      } while (value >= limit);
      return value % bound;
    };
    for (let index = ordered.length - 1; index > 0; index -= 1) {
      const swap = below(index + 1);
      [ordered[index], ordered[swap]] = [ordered[swap], ordered[index]];
    }
    groups[group.id] = ordered;
  }
  return { algorithmVersion: QUESTION_ORDER_ALGORITHM, groups };
}

/** Apply assigned group permutations to a copy of canonical question IDs. */
export function presentedQuestionIds(manifest: Manifest, assignment: QuestionOrderAssignment): string[] {
  const order = manifest.questions.map((question) => question.id);
  const positions = new Map(order.map((id, index) => [id, index]));
  for (const group of manifest.questionOrderGroups ?? []) {
    const assigned = assignment.groups[group.id];
    if (!assigned || assigned.length !== group.questionIds.length || new Set(assigned).size !== group.questionIds.length || assigned.some((id) => !group.questionIds.includes(id))) continue;
    const start = Math.min(...group.questionIds.map((id) => positions.get(id) ?? Number.MAX_SAFE_INTEGER));
    if (start === Number.MAX_SAFE_INTEGER) continue;
    for (let index = 0; index < assigned.length; index += 1) order[start + index] = assigned[index];
  }
  return order;
}
