import { createHash } from "node:crypto";
import { ObjectId, type ClientSession } from "mongodb";
import { col, withMongoTransaction } from "../db";
import type { MailRecord } from "../mail/state";
import type { MailMessageDoc, ParticipantView } from "./types";
import { currentTenantId, tenantFilter } from "../tenant-context";

export function mailRecord(doc: MailMessageDoc): MailRecord {
  return {
    id: doc._id.toHexString(),
    participantId: doc.participantId.toHexString(),
    to: doc.to,
    token: doc.token,
    status: doc.status,
    error: doc.error,
    messageId: doc.messageId,
    sentAt: doc.sentAt.toISOString(),
    delivery: doc.delivery,
    deliveryCheckedAt: doc.deliveryCheckedAt?.toISOString(),
    deliveryDetail: doc.deliveryDetail,
    resolution: doc.resolution ? { ...doc.resolution, acknowledgedAt: doc.resolution.acknowledgedAt.toISOString() } : undefined,
    pendingAttemptCount: doc.pendingAttemptCount,
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

const MCP_MAIL_OPERATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type InviteSendOperation = { operationId: string; credentialId: string; argumentDigest: string };
export type InviteSendOperationResult =
  | { kind: "created"; attemptId: string }
  | { kind: "replayed"; attempt: MailRecord; interviewId: string }
  | { kind: "conflict" | "deleted" };

function inviteOperationScope(tenantId: string, operation: InviteSendOperation) {
  return {
    tenantId,
    tool: "send_invite",
    credentialIdHash: createHash("sha256").update(operation.credentialId).digest("hex"),
    operationIdHash: createHash("sha256").update(operation.operationId).digest("hex"),
  };
}

async function inviteOperationResult(
  scope: ReturnType<typeof inviteOperationScope>,
  argumentDigest: string,
): Promise<Exclude<InviteSendOperationResult, { kind: "created" }> | null> {
  const operation = await (await col.mcpOperations()).findOne(scope);
  if (!operation || operation.expiresAt <= new Date()) return null;
  if (operation.deletedAt) return { kind: "deleted" };
  if (operation.argumentDigest !== argumentDigest) return { kind: "conflict" };
  const attemptId = typeof operation.result.mailAttemptId === "string" ? operation.result.mailAttemptId : "";
  const attemptOid = /^[0-9a-f]{24}$/i.test(attemptId) ? new ObjectId(attemptId) : null;
  const attempt = attemptOid ? await (await col.mail()).findOne(tenantFilter(scope.tenantId, { _id: attemptOid })) : null;
  return attempt ? { kind: "replayed", attempt: mailRecord(attempt), interviewId: operation.interviewId?.toHexString() ?? "" } : { kind: "deleted" };
}

/** Find the exact durable invite attempt for an operation retry. */
export async function getInviteSendOperation(operation: InviteSendOperation): Promise<Exclude<InviteSendOperationResult, { kind: "created" }> | null> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  return inviteOperationResult(inviteOperationScope(tenantId, operation), operation.argumentDigest);
}

/** Reserve one pending mail attempt and its MCP retry key in the same transaction. */
export async function insertMailWithOperation(
  doc: Omit<MailMessageDoc, "_id" | "tenantId">,
  operation: InviteSendOperation,
): Promise<InviteSendOperationResult> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const scope = inviteOperationScope(tenantId, operation);
  const operations = await col.mcpOperations();
  const mail = await col.mail();
  const now = new Date();
  const row: MailMessageDoc = { ...doc, tenantId, _id: new ObjectId() };
  try {
    return await withMongoTransaction(async (session) => {
      const existing = await operations.findOne(scope, { session });
      if (existing && existing.expiresAt > now) {
        if (existing.deletedAt) return { kind: "deleted" as const };
        if (existing.argumentDigest !== operation.argumentDigest) return { kind: "conflict" as const };
        const attemptId = typeof existing.result.mailAttemptId === "string" ? existing.result.mailAttemptId : "";
        const attemptOid = /^[0-9a-f]{24}$/i.test(attemptId) ? new ObjectId(attemptId) : null;
        const attempt = attemptOid ? await mail.findOne(tenantFilter(tenantId, { _id: attemptOid }), { session }) : null;
        return attempt ? { kind: "replayed" as const, attempt: mailRecord(attempt), interviewId: existing.interviewId?.toHexString() ?? "" } : { kind: "deleted" as const };
      }
      if (existing) await operations.deleteOne({ _id: existing._id }, { session });

      const participant = await (await col.participants()).updateOne(
        tenantFilter(tenantId, { _id: doc.participantId, interviewId: doc.interviewId, email: doc.to, token: doc.token }),
        { $inc: { inviteAttemptRevision: 1 } },
        { session },
      );
      if (participant.matchedCount !== 1) return { kind: "deleted" as const };
      await mail.insertOne(row, { session });
      await operations.insertOne({
        _id: new ObjectId(), ...scope, argumentDigest: operation.argumentDigest,
        interviewId: doc.interviewId, participantIds: [doc.participantId],
        result: { mailAttemptId: row._id.toHexString() }, createdAt: now,
        expiresAt: new Date(now.getTime() + MCP_MAIL_OPERATION_TTL_MS),
      }, { session });
      return { kind: "created" as const, attemptId: row._id.toHexString() };
    });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    const committed = await inviteOperationResult(scope, operation.argumentDigest);
    if (committed) return committed;
    throw error;
  }
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
  const participantIds = people.flatMap((person) => {
    const participantId = /^[0-9a-f]{24}$/i.test(person.id) ? new ObjectId(person.id) : null;
    return participantId ? [participantId] : [];
  });
  if (!participantIds.length) return [];
  const mail = await col.mail();
  const current = filters.length ? await mail.aggregate<MailMessageDoc>([
    { $match: tenantFilter(tenantId, { interviewId, $or: filters }) },
    { $sort: { sentAt: -1, _id: -1 } },
    { $group: { _id: { participantId: "$participantId", to: "$to", token: "$token" }, latest: { $first: "$$ROOT" } } },
    { $replaceRoot: { newRoot: "$latest" } },
  ]).toArray() : [];
  const unresolved = await mail.aggregate<MailMessageDoc>([
    { $match: tenantFilter(tenantId, { interviewId, participantId: { $in: participantIds }, status: "pending", delivery: { $nin: ["delivered", "bounced"] } }) },
    {
      $setWindowFields: {
        partitionBy: "$participantId",
        sortBy: { _id: -1 },
        output: {
          pageRow: { $documentNumber: {} },
          pendingAttemptCount: { $count: {}, window: { documents: ["unbounded", "unbounded"] } },
        },
      },
    },
    { $match: { pageRow: { $lte: 50 } } },
    { $unset: "pageRow" },
  ]).toArray();
  const found = new Set(current.map((row) => row._id.toHexString()));
  return [...current, ...unresolved.filter((row) => !found.has(row._id.toHexString()))];
}

export async function listPendingMailByPerson(participantId: ObjectId, beforeId?: ObjectId, limit = 50): Promise<{ rows: MailMessageDoc[]; nextCursor: string | null; total: number }> {
  const tenantId = await currentTenantId();
  if (!tenantId) return { rows: [], nextCursor: null, total: 0 };
  const mail = await col.mail();
  const base = { participantId, status: "pending", delivery: { $nin: ["delivered", "bounced"] } };
  const [total, rows] = await Promise.all([
    mail.countDocuments(tenantFilter(tenantId, base)),
    mail.find(tenantFilter(tenantId, { ...base, ...(beforeId ? { _id: { $lt: beforeId } } : {}) })).sort({ _id: -1 }).limit(Math.max(1, Math.min(limit, 50))).toArray(),
  ]);
  const nextCursor = rows.length === Math.min(limit, 50) && rows.length && rows.at(-1)?._id ? rows.at(-1)!._id.toHexString() : null;
  return { rows, nextCursor, total };
}

export async function listMailByPerson(participantId: ObjectId): Promise<MailMessageDoc[]> {
  const tenantId = await currentTenantId();
  if (!tenantId) return [];
  return (await col.mail()).find(tenantFilter(tenantId, { participantId })).sort({ sentAt: -1 }).limit(50).toArray();
}

/** Load one exact attempt only when it belongs to this tenant-scoped participant. */
export async function getMailAttemptForPerson(participantId: ObjectId, attemptId: ObjectId): Promise<MailMessageDoc | null> {
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  return (await col.mail()).findOne(tenantFilter(tenantId, { participantId, _id: attemptId }));
}

export async function updateMailDelivery(id: ObjectId, patch: Pick<MailMessageDoc, "delivery" | "deliveryCheckedAt" | "deliveryDetail">): Promise<MailRecord["delivery"] | undefined> {
  const tenantId = await currentTenantId();
  if (!tenantId) return undefined;
  const mail = await col.mail();
  const result = await mail.updateOne(
    tenantFilter(tenantId, {
      _id: id,
      ...(patch.delivery === "unknown" ? { delivery: { $nin: ["delivered", "bounced"] } } : {}),
    }),
    { $set: patch },
  );
  if (result.matchedCount === 1) return patch.delivery;
  const current = await mail.findOne(tenantFilter(tenantId, { _id: id }));
  return current?.delivery;
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
