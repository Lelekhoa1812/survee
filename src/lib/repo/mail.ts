import { ObjectId, type ClientSession } from "mongodb";
import { col, withMongoTransaction } from "../db";
import type { MailRecord } from "../mail/state";
import type { MailMessageDoc, ParticipantView } from "./types";
import { currentTenantId, tenantFilter } from "../tenant-context";

export function mailRecord(doc: MailMessageDoc): MailRecord {
  return {
    id: doc._id.toHexString(),
    to: doc.to,
    token: doc.token,
    status: doc.status,
    error: doc.error,
    messageId: doc.messageId,
    sentAt: doc.sentAt.toISOString(),
    delivery: doc.delivery,
    deliveryCheckedAt: doc.deliveryCheckedAt?.toISOString(),
    deliveryDetail: doc.deliveryDetail,
  };
}

export async function insertMail(doc: Omit<MailMessageDoc, "_id" | "tenantId">): Promise<MailMessageDoc | null> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const row: MailMessageDoc = { ...doc, tenantId, _id: new ObjectId() };
  // Touch the participant in the same transaction as the pending attempt.
  // deleteParticipant also writes that participant and checks for pending mail,
  // so the two operations serialize instead of recreating erased mail after a delete.
  const started = await withMongoTransaction(async (session) => {
    const participant = await (await col.participants()).updateOne(
      tenantFilter(tenantId, { _id: doc.participantId, interviewId: doc.interviewId, email: doc.to, token: doc.token }),
      { $inc: { inviteAttemptRevision: 1 } },
      { session },
    );
    if (participant.matchedCount !== 1) return false;
    await (await col.mail()).insertOne(row, { session });
    return true;
  });
  return started ? row : null;
}

/** Persist the attempt before contacting SMTP, so an interrupted/ambiguous send stays visible. */
export async function updateMailAttempt(id: ObjectId, patch: Pick<MailMessageDoc, "status" | "messageId" | "error">): Promise<boolean> {
  const tenantId = await currentTenantId();
  if (!tenantId) return false;
  const result = await (await col.mail()).updateOne(
    tenantFilter(tenantId, { _id: id, status: "pending" }),
    { $set: patch },
  );
  return result.matchedCount === 1;
}

export async function listMailByInterview(interviewId: ObjectId): Promise<MailMessageDoc[]> {
  const tenantId = await currentTenantId();
  if (!tenantId) return [];
  return (await col.mail()).find(tenantFilter(tenantId, { interviewId })).sort({ sentAt: -1 }).limit(500).toArray();
}

/** Load only the latest mail attempt for each exact participant link in a bounded page. */
export async function listCurrentMailByParticipants(interviewId: ObjectId, people: readonly Pick<ParticipantView, "id" | "token" | "email">[]): Promise<MailMessageDoc[]> {
  const tenantId = await currentTenantId();
  if (!tenantId || !people.length) return [];
  const filters = people.flatMap((person) => {
    if (!person.email) return [];
    const participantId = /^[0-9a-f]{24}$/i.test(person.id) ? new ObjectId(person.id) : null;
    return participantId ? [{ participantId, to: person.email.trim().toLowerCase(), token: person.token }] : [];
  });
  if (!filters.length) return [];
  return (await col.mail()).aggregate<MailMessageDoc>([
    { $match: tenantFilter(tenantId, { interviewId, $or: filters }) },
    { $sort: { sentAt: -1, _id: -1 } },
    { $group: { _id: { participantId: "$participantId", to: "$to", token: "$token" }, latest: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$latest" } },
  ]).toArray();
}

export async function listMailByPerson(participantId: ObjectId): Promise<MailMessageDoc[]> {
  const tenantId = await currentTenantId();
  if (!tenantId) return [];
  return (await col.mail()).find(tenantFilter(tenantId, { participantId })).sort({ sentAt: -1 }).limit(50).toArray();
}

export async function updateMailDelivery(id: ObjectId, patch: Pick<MailMessageDoc, "delivery" | "deliveryCheckedAt" | "deliveryDetail">): Promise<void> {
  const tenantId = await currentTenantId();
  if (!tenantId) return;
  await (await col.mail()).updateOne(tenantFilter(tenantId, { _id: id }), { $set: patch });
}

export async function deleteMailForInterview(interviewId: ObjectId, session?: ClientSession): Promise<void> {
  const tenantId = await currentTenantId();
  if (!tenantId) return;
  await (await col.mail()).deleteMany(tenantFilter(tenantId, { interviewId }), { session });
}

export async function deleteMailForPerson(participantId: ObjectId, session?: ClientSession): Promise<void> {
  // participantId is a globally unique participant _id. Match only this exact
  // foreign key so legacy rows without tenantId are erased too.
  await (await col.mail()).deleteMany({ participantId }, { session });
}
