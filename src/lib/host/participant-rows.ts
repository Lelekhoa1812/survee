import { progress } from "../format/answers";
import { currentMail, type MailRecord } from "../mail/state";
import type { Manifest } from "../format/schema";
import type { ParticipantView } from "../repo/types";
import type { PersonRow } from "../../components/interview-types";

/** Shape bounded participant pages consistently for the host people and answer surfaces. */
export function participantRows(manifest: Manifest, people: ParticipantView[], mailRows: MailRecord[], includeAnswerData = true): PersonRow[] {
  const mailByToken = new Map<string, MailRecord[]>();
  const unresolvedByParticipant = new Map<string, MailRecord[]>();
  for (const row of mailRows) {
    const rows = mailByToken.get(row.token) ?? [];
    rows.push(row);
    mailByToken.set(row.token, rows);
    if (row.participantId) {
      const pending = unresolvedByParticipant.get(row.participantId) ?? [];
      if (row.status === "pending" && row.delivery !== "delivered" && row.delivery !== "bounced") pending.push(row);
      unresolvedByParticipant.set(row.participantId, pending);
    }
  }
  return people.map((person) => {
    const result = progress(manifest, person.answers, person.recordGroups);
    const mail = currentMail(person, mailByToken.get(person.token) ?? []);
    return {
      id: person.id, token: person.token, name: person.name, email: person.email, note: person.note, status: person.status,
      answered: result.answered, total: result.total, requiredMissing: result.missingRequired.length,
      createdAt: person.createdAt, updatedAt: person.updatedAt, lastSeenAt: person.lastSeenAt, lastSavedAt: person.lastSavedAt, submittedAt: person.submittedAt,
      answers: includeAnswerData ? person.answers : {},
      ...(includeAnswerData ? {
        ...(person.recordGroups ? { recordGroups: person.recordGroups } : {}),
        ...(person.questionOrderAssignments ? { questionOrderAssignments: person.questionOrderAssignments } : {}),
      } : {}),
      mail: {
        state: mail.state, sentAt: mail.sentAt, error: mail.error, delivery: mail.state === "sent" ? mail.delivery : "unknown", deliveryCheckedAt: mail.deliveryCheckedAt, deliveryDetail: mail.deliveryDetail, attemptId: mail.attemptId, resolution: mail.resolution,
        pendingAttempts: (unresolvedByParticipant.get(person.id) ?? []).filter((row) => row.id !== mail.attemptId).map((row) => ({ attemptId: row.id, email: row.to, sentAt: row.sentAt, resolution: row.resolution })),
        pendingAttemptCount: Math.max(0, (unresolvedByParticipant.get(person.id) ?? []).find((row) => row.pendingAttemptCount !== undefined)?.pendingAttemptCount ?? unresolvedByParticipant.get(person.id)?.length ?? 0),
      },
    };
  });
}
