import { MAX_INVITES_PER_BATCH } from "../participant-limits";
import { getParticipant } from "../repo";
import { sendInvite, type SendInviteResult } from "./invite";

export type InviteBatchOutcome =
  | ({ personId: string } & SendInviteResult)
  | { personId: string; ok: false; code: "preflight_unavailable"; error: string; interviewId: string };

export type InviteBatchDeps = {
  loadPerson?: typeof getParticipant;
  send?: typeof sendInvite;
};

/** Send a small cohort serially through the same durable, throttled per-person path as individual invites. */
export async function sendInviteBatch(
  input: { interviewId: string; personIds: string[]; triggeredBy: "admin" | "mcp" },
  deps: InviteBatchDeps = {},
): Promise<{ ok: true; outcomes: InviteBatchOutcome[] }> {
  const loadPerson = deps.loadPerson ?? getParticipant;
  const send = deps.send ?? sendInvite;
  const outcomes: InviteBatchOutcome[] = [];

  for (const personId of input.personIds) {
    let person: Awaited<ReturnType<typeof getParticipant>>;
    try {
      person = await loadPerson(personId);
    } catch {
      outcomes.push({
        personId,
        ok: false,
        code: "preflight_unavailable",
        error: "Could not verify this person's interview and email before sending. No message was sent.",
        interviewId: input.interviewId,
      });
      continue;
    }
    if (!person || person.interviewId !== input.interviewId) {
      outcomes.push({ personId, ok: false, code: "not_found", error: "Person not found in this interview." });
      continue;
    }
    try {
      outcomes.push({ personId, ...await send({ personId, triggeredBy: input.triggeredBy }) });
    } catch {
      outcomes.push({
        personId,
        ok: false,
        code: "outcome_unknown",
        error: "This invite could not be confirmed. Check the person's invitation status before trying again.",
        interviewId: input.interviewId,
      });
    }
  }

  return { ok: true, outcomes };
}

export function validateInviteBatch(interviewId: unknown, personIds: unknown, maxCount = MAX_INVITES_PER_BATCH): string | null {
  if (typeof interviewId !== "string" || !/^[0-9a-f]{24}$/i.test(interviewId)) return "interviewId must be a valid interview id.";
  if (!Array.isArray(personIds) || personIds.length < 1 || personIds.length > maxCount) {
    return `personIds must contain 1 to ${maxCount} people.`;
  }
  if (!personIds.every((id) => typeof id === "string" && /^[0-9a-f]{24}$/i.test(id))) return "Each personIds entry must be a valid person id.";
  if (new Set(personIds).size !== personIds.length) return "personIds cannot contain duplicates.";
  return null;
}
