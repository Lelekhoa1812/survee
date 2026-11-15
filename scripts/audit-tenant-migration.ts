/**
 * Read-only preflight for assigning the existing single-host records to a tenant.
 * This script never creates indexes or writes documents. It intentionally reports
 * counts and integrity findings only; it does not print emails, answers, or tokens.
 *
 *   npm run audit:tenant-migration
 */
import { loadEnvConfig } from "@next/env";
import { MongoClient, type Db } from "mongodb";

loadEnvConfig(process.cwd());

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error("MONGODB_URI is not configured.");
  process.exit(2);
}

const dbName = process.env.MONGODB_DB || "kqa";
const client = new MongoClient(uri, { maxPoolSize: 2, serverSelectionTimeoutMS: 8000, appName: "kqa-tenant-migration-audit" });

async function count(db: Db, name: string, filter: Record<string, unknown> = {}) {
  return db.collection(name).countDocuments(filter);
}

async function aggregateCount(db: Db, name: string, pipeline: Record<string, unknown>[]) {
  const rows = await db.collection(name).aggregate<{ count: number }>([...pipeline, { $count: "count" }]).toArray();
  return rows[0]?.count ?? 0;
}

async function main() {
  await client.connect();
  const db = client.db(dbName);
  const collections = ["interviews", "survey_versions", "participants", "events", "mail_messages", "api_keys", "oauth_clients", "oauth_codes", "login_attempts", "revoked_sessions"];
  const tenantOwnedCollections = new Set(["interviews", "survey_versions", "participants", "events", "mail_messages", "api_keys", "oauth_codes"]);
  const counts: Record<string, { documents: number; alreadyTenantScoped: number; missingTenant: number }> = {};
  const tenantIdGroups = new Set<string>();
  for (const name of collections) {
    const documents = await count(db, name);
    const alreadyTenantScoped = await count(db, name, { tenantId: { $exists: true } });
    counts[name] = { documents, alreadyTenantScoped, missingTenant: documents - alreadyTenantScoped };
    if (tenantOwnedCollections.has(name)) {
      const grouped = await db.collection(name).aggregate<{ _id: unknown }>([{ $match: { tenantId: { $exists: true } } }, { $group: { _id: "$tenantId" } }]).toArray();
      for (const row of grouped) tenantIdGroups.add(String(row._id));
    }
  }

  const blockingIntegrity = {
    versionsWithoutInterview: await aggregateCount(db, "survey_versions", [
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "parent" } },
      { $match: { parent: { $size: 0 } } },
    ]),
    participantsWithoutInterview: await aggregateCount(db, "participants", [
      { $lookup: { from: "interviews", localField: "interviewId", foreignField: "_id", as: "parent" } },
      { $match: { parent: { $size: 0 } } },
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
    eventsWithoutInterviewId: await count(db, "events", { interviewId: { $exists: false } }),
  };

  const checks = Object.values(blockingIntegrity);
  const tenantRows = [...tenantOwnedCollections].map((name) => counts[name]);
  const allUnscoped = tenantRows.every((row) => row.alreadyTenantScoped === 0);
  const allScoped = tenantRows.every((row) => row.missingTenant === 0);
  const oneTenantIdAcrossScopedCollections = tenantIdGroups.size <= 1;
  const noPartialMigration = allUnscoped || (allScoped && oneTenantIdAcrossScopedCollections);
  const safeReferenceGraph = checks.every((n) => n === 0);
  const report = {
    mode: "read-only",
    database: dbName,
    tenantTarget: { name: "Axion", slug: "axion" },
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
    preflight: { noPartialMigration, oneTenantIdAcrossScopedCollections, safeReferenceGraph, readyForReviewedBackfill: noPartialMigration && safeReferenceGraph },
    note: "Counts only. Legacy events are assigned to Axion as a collection per the approved ownership decision; event references are reported for review but do not prevent ownership backfill. No document values, secrets, answers, or identifiers were emitted; no writes or index creation were performed.",
  };
  console.log(JSON.stringify(report, null, 2));
  if (!report.preflight.readyForReviewedBackfill) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error("Tenant migration audit failed:", error instanceof Error ? error.message : "unknown error");
  process.exitCode = 1;
}).finally(async () => {
  await client.close().catch(() => {});
});
