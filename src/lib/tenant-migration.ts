import type { Db } from "mongodb";
import { AXION_TENANT_ID } from "./env";
import type { TenantDoc } from "./repo/types";

const OWNED = ["interviews", "survey_versions", "participants", "events", "mail_messages", "api_keys", "oauth_codes"] as const;
const OWNED_SET = new Set<string>(OWNED);
const INSTANCE_WIDE = ["oauth_clients", "login_attempts", "revoked_sessions"] as const;

async function count(db: Db, collection: string, filter: Record<string, unknown> = {}): Promise<number> {
  return db.collection(collection).countDocuments(filter);
}

async function aggregateCount(db: Db, collection: string, pipeline: Record<string, unknown>[]): Promise<number> {
  const rows = await db.collection(collection).aggregate<{ count: number }>([...pipeline, { $count: "count" }]).toArray();
  return rows[0]?.count ?? 0;
}

function effectiveTenant(path: string): Record<string, unknown> {
  return { $ifNull: [path, AXION_TENANT_ID] };
}

export async function auditTenantMigration(db: Db) {
  const counts: Record<string, { documents: number; alreadyTenantScoped: number; missingTenant: number; otherTenant: number }> = {};
  for (const collection of [...OWNED, ...INSTANCE_WIDE]) {
    const documents = await count(db, collection);
    const alreadyTenantScoped = await count(db, collection, { tenantId: { $exists: true } });
    const otherTenant = OWNED_SET.has(collection)
      ? await count(db, collection, { tenantId: { $exists: true, $ne: AXION_TENANT_ID } })
      : 0;
    counts[collection] = { documents, alreadyTenantScoped, missingTenant: documents - alreadyTenantScoped, otherTenant };
  }

  const blockingIntegrity = {
    versionsWithoutInterview: await aggregateCount(db, "survey_versions", [
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "parent" } },
      { $match: { parent: { $size: 0 } } },
    ]),
    versionsTenantMismatch: await aggregateCount(db, "survey_versions", [
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "parent" } },
      { $unwind: "$parent" },
      { $match: { $expr: { $ne: [effectiveTenant("$tenantId"), effectiveTenant("$parent.tenantId")] } } },
    ]),
    participantsWithoutInterview: await aggregateCount(db, "participants", [
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "parent" } },
      { $match: { parent: { $size: 0 } } },
    ]),
    participantsTenantMismatch: await aggregateCount(db, "participants", [
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "parent" } },
      { $unwind: "$parent" },
      { $match: { $expr: { $ne: [effectiveTenant("$tenantId"), effectiveTenant("$parent.tenantId")] } } },
    ]),
    mailWithoutInterview: await aggregateCount(db, "mail_messages", [
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "parent" } },
      { $match: { parent: { $size: 0 } } },
    ]),
    mailWithoutParticipant: await aggregateCount(db, "mail_messages", [
      { $lookup: { from: "participants", localField: "participantId", foreignField: "_id", as: "person" } },
      { $match: { person: { $size: 0 } } },
    ]),
    mailInterviewParticipantMismatch: await aggregateCount(db, "mail_messages", [
      { $lookup: { from: "participants", localField: "participantId", foreignField: "_id", as: "person" } },
      { $unwind: "$person" },
      { $match: { $expr: { $ne: ["$interviewId", "$person.interviewId"] } } },
    ]),
    mailTenantMismatch: await aggregateCount(db, "mail_messages", [
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "interview" } },
      { $lookup: { from: "participants", localField: "participantId", foreignField: "_id", as: "person" } },
      { $unwind: "$interview" },
      { $unwind: "$person" },
      { $match: { $expr: { $or: [
        { $ne: [effectiveTenant("$tenantId"), effectiveTenant("$interview.tenantId")] },
        { $ne: [effectiveTenant("$tenantId"), effectiveTenant("$person.tenantId")] },
      ] } } },
    ]),
    interviewsWithoutCurrentVersion: await aggregateCount(db, "interviews", [
      { $lookup: { from: "survey_versions", localField: "_id", foreignField: "interviewId", as: "versions" } },
      { $match: { $expr: { $not: { $in: ["$currentVersion", "$versions.version"] } } } },
    ]),
  };
  const legacyEventReferences = {
    eventsWithoutInterview: await aggregateCount(db, "events", [
      { $match: { interviewId: { $exists: true } } },
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "parent" } },
      { $match: { parent: { $size: 0 } } },
    ]),
    eventsWithoutParticipant: await aggregateCount(db, "events", [
      { $match: { participantId: { $exists: true } } },
      { $lookup: { from: "participants", localField: "participantId", foreignField: "_id", as: "person" } },
      { $match: { person: { $size: 0 } } },
    ]),
    eventsInterviewParticipantMismatch: await aggregateCount(db, "events", [
      { $match: { interviewId: { $exists: true }, participantId: { $exists: true } } },
      { $lookup: { from: "participants", localField: "participantId", foreignField: "_id", as: "person" } },
      { $unwind: "$person" },
      { $match: { $expr: { $ne: ["$interviewId", "$person.interviewId"] } } },
    ]),
    eventsTenantMismatch: await aggregateCount(db, "events", [
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "interview" } },
      { $lookup: { from: "participants", localField: "participantId", foreignField: "_id", as: "person" } },
      { $unwind: { path: "$interview", preserveNullAndEmptyArrays: true } },
      { $unwind: { path: "$person", preserveNullAndEmptyArrays: true } },
      { $match: { $expr: { $or: [
        { $and: [{ $ne: ["$interview", null] }, { $ne: [effectiveTenant("$tenantId"), effectiveTenant("$interview.tenantId")] }] },
        { $and: [{ $ne: ["$person", null] }, { $ne: [effectiveTenant("$tenantId"), effectiveTenant("$person.tenantId")] }] },
      ] } } },
    ]),
    eventsWithoutInterviewId: await count(db, "events", { interviewId: { $exists: false } }),
  };

  // Missing legacy event links are preserved, but an event that points across
  // interviews or tenant boundaries must be reviewed before assigning ownership.
  const safeReferenceGraph = Object.values(blockingIntegrity).every((value) => value === 0)
    && legacyEventReferences.eventsInterviewParticipantMismatch === 0
    && legacyEventReferences.eventsTenantMismatch === 0;
  const tenantIdsMatchAxion = OWNED.every((collection) => counts[collection].otherTenant === 0);
  const report = {
    mode: "read-only" as const,
    tenantTarget: { name: "Axion", slug: "axion", id: AXION_TENANT_ID },
    collections: counts,
    blockingIntegrity,
    legacyEventReferences,
    instanceWidePolicyCounts: {
      oauthClientsRemainInstanceWide: counts.oauth_clients.documents,
      loginAttemptsRemainInstanceWide: counts.login_attempts.documents,
      revokedSessionsRemainInstanceWide: counts.revoked_sessions.documents,
      oauthCodesNeedReissueOrTenantBinding: await count(db, "oauth_codes", { expiresAt: { $gt: new Date() } }),
      activeApiKeysNeedAxionBinding: await count(db, "api_keys", { revokedAt: { $exists: false }, $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] }),
    },
    preflight: {
      tenantIdsMatchAxion,
      safeReferenceGraph,
      readyForReviewedBackfill: tenantIdsMatchAxion && safeReferenceGraph,
    },
    note: "Counts only. Backfill assigns all unscoped legacy records to Axion and preserves incomplete event references. No document contents, identifiers, email addresses, answers, or secrets are returned.",
  };
  return report;
}

export async function backfillLegacyTenant(db: Db): Promise<Record<string, number>> {
  const report = await auditTenantMigration(db);
  if (!report.preflight.readyForReviewedBackfill) throw new Error("Tenant preflight is not ready; no records were changed.");

  const now = new Date();
  await db.collection<TenantDoc>("tenants").updateOne(
    { _id: AXION_TENANT_ID },
    { $setOnInsert: { _id: AXION_TENANT_ID, name: "Axion", slug: "axion", status: "active", createdAt: now, updatedAt: now } },
    { upsert: true },
  );
  const modified: Record<string, number> = {};
  for (const collection of OWNED) {
    const result = await db.collection(collection).updateMany(
      { tenantId: { $exists: false } },
      { $set: { tenantId: AXION_TENANT_ID } },
    );
    modified[collection] = result.modifiedCount;
  }
  return modified;
}
