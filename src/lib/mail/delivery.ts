import { ObjectId } from "mongodb";
import { getParticipant } from "../repo";
import { listMailByPerson, mailRecord, updateMailDelivery } from "../repo/mail";
import { parseEmail } from "./address";
import { checkMessageIds, type DeliveryCheck } from "./imap";
import { currentMail, type MailRecord } from "./state";
import type { MailDelivery } from "../repo/types";

export type DeliveryResult =
  | { ok: true; delivery: MailDelivery; checkedAt: string; detail?: string; personId: string; interviewId: string }
  | { ok: false; code: "not_found" | "not_sent"; error: string };

export interface DeliveryDeps {
  load?: (personId: string) => Promise<{ person: { id: string; interviewId: string; email?: string; token: string }; rows: MailRecord[] } | null>;
  check?: (messageIds: string[]) => Promise<Map<string, DeliveryCheck>>;
  save?: (id: string, patch: { delivery: MailDelivery; deliveryCheckedAt: Date; deliveryDetail?: string }) => Promise<void>;
}

async function loadFromDb(personId: string) {
  const person = await getParticipant(personId);
  if (!person) return null;
  const oid = /^[0-9a-f]{24}$/i.test(personId) ? new ObjectId(personId) : null;
  const rows = oid ? (await listMailByPerson(oid)).map(mailRecord) : [];
  return { person: { id: person.id, interviewId: person.interviewId, email: person.email, token: person.token }, rows };
}

/** On-demand check of the message id we stored for the current address and token. Disconnects when finished. */
export async function checkInviteDelivery(personId: string, deps: DeliveryDeps = {}): Promise<DeliveryResult> {
  const ctx = await (deps.load ?? loadFromDb)(personId);
  if (!ctx) return { ok: false, code: "not_found", error: "Person not found." };
  const parsed = parseEmail(ctx.person.email ?? "");
  const email = parsed.ok ? parsed.email : null;
  const current = currentMail({ email, token: ctx.person.token }, ctx.rows);
  if (current.state !== "sent" || !current.messageId) {
    return { ok: false, code: "not_sent", error: "Send the link before checking delivery." };
  }
  const row = ctx.rows.find((item) => item.messageId === current.messageId && item.to === email && item.token === ctx.person.token);
  const checked = await (deps.check ?? checkMessageIds)([current.messageId]);
  const result = checked.get(current.messageId) ?? { status: "unknown" as const, detail: "Not confirmed yet." };
  const checkedAt = new Date();
  if (row) {
    const save = deps.save ?? (async (id: string, patch: { delivery: MailDelivery; deliveryCheckedAt: Date; deliveryDetail?: string }) => {
      await updateMailDelivery(new ObjectId(id), patch);
    });
    await save(row.id, { delivery: result.status, deliveryCheckedAt: checkedAt, deliveryDetail: result.detail });
  }
  return { ok: true, delivery: result.status, checkedAt: checkedAt.toISOString(), detail: result.detail, personId: ctx.person.id, interviewId: ctx.person.interviewId };
}
