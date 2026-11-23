import { ObjectId, type ClientSession } from "mongodb";
import { col } from "../db";
import type { MailRecord } from "../mail/state";
import type { MailMessageDoc } from "./types";
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

export async function insertMail(doc: Omit<MailMessageDoc, "_id" | "tenantId">): Promise<MailMessageDoc> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const row: MailMessageDoc = { ...doc, tenantId, _id: new ObjectId() };
  await (await col.mail()).insertOne(row);
  return row;
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
  const tenantId = await currentTenantId();
  if (!tenantId) return;
  await (await col.mail()).deleteMany(tenantFilter(tenantId, { participantId }), { session });
}
