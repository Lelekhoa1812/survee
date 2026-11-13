import { ObjectId } from "mongodb";
import { col } from "../db";
import type { MailRecord } from "../mail/state";
import type { MailMessageDoc } from "./types";

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

export async function insertMail(doc: Omit<MailMessageDoc, "_id">): Promise<MailMessageDoc> {
  const row: MailMessageDoc = { ...doc, _id: new ObjectId() };
  await (await col.mail()).insertOne(row);
  return row;
}

export async function listMailByInterview(interviewId: ObjectId): Promise<MailMessageDoc[]> {
  return (await col.mail()).find({ interviewId }).sort({ sentAt: -1 }).limit(500).toArray();
}

export async function listMailByPerson(participantId: ObjectId): Promise<MailMessageDoc[]> {
  return (await col.mail()).find({ participantId }).sort({ sentAt: -1 }).limit(50).toArray();
}

export async function updateMailDelivery(id: ObjectId, patch: Pick<MailMessageDoc, "delivery" | "deliveryCheckedAt" | "deliveryDetail">): Promise<void> {
  await (await col.mail()).updateOne({ _id: id }, { $set: patch });
}

export async function deleteMailForInterview(interviewId: ObjectId): Promise<void> {
  await (await col.mail()).deleteMany({ interviewId });
}

export async function deleteMailForPerson(participantId: ObjectId): Promise<void> {
  await (await col.mail()).deleteMany({ participantId });
}
