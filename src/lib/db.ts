import { MongoClient, ObjectId, type ClientSession, type Collection, type Db } from "mongodb";
import { dbName, mongoUri } from "./env";
import type { AnalyticsRunDoc, ApiKeyDoc, EventDoc, InterviewDoc, LoginAttemptDoc, MailMessageDoc, MembershipDoc, OAuthClientDoc, OAuthCodeDoc, ParticipantDoc, PendingEmailChangeDoc, PendingPasswordResetDoc, PendingSignupDoc, QuestionnaireReviewDraftDoc, QuestionOrderAssignmentDoc, RateLimitBucketDoc, RevokedSessionDoc, SurveyVersionDoc, TenantDoc, UserDoc, ImageAssetDoc, WorkspaceInvitationDoc } from "./repo/types";

declare global {
  // eslint-disable-next-line no-var
  var __kqaMongo: { client: Promise<MongoClient>; indexes?: Promise<void> } | undefined;
}

function client(): Promise<MongoClient> {
  if (!globalThis.__kqaMongo) {
    const c = new MongoClient(mongoUri(), { maxPoolSize: 5, serverSelectionTimeoutMS: 8000, appName: "kqa" });
    const entry = { client: c.connect() };
    globalThis.__kqaMongo = entry;
    // A failed initial server selection leaves a rejected promise cached for
    // the lifetime of a warm worker. Let a later request create a fresh client.
    void entry.client.catch(() => {
      if (globalThis.__kqaMongo === entry) globalThis.__kqaMongo = undefined;
    });
  }
  return globalThis.__kqaMongo.client;
}

export async function db(): Promise<Db> {
  const c = await client();
  const d = c.db(dbName());
  if (!globalThis.__kqaMongo!.indexes) {
    globalThis.__kqaMongo!.indexes = ensureIndexes(d).catch((e) => {
      globalThis.__kqaMongo!.indexes = undefined;
      throw e;
    });
  }
  await globalThis.__kqaMongo!.indexes;
  return d;
}

/** Check database connectivity without running index setup or migrations. */
export async function pingDatabase(): Promise<void> {
  const c = await client();
  await c.db(dbName()).command({ ping: 1 }, { timeoutMS: 5_000 });
}

/** Run a unit of work that must commit atomically across MongoDB collections. */
export async function withMongoTransaction<T>(work: (session: ClientSession) => Promise<T>): Promise<T> {
  // Ensure collections and indexes are ready before opening a transaction.
  await db();
  const c = await client();
  const session = c.startSession();
  try {
    const result = await session.withTransaction(() => work(session));
    if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
    return result;
  } finally {
    await session.endSession();
  }
}

async function ensurePendingSignupEmailIndex(d: Db): Promise<void> {
  const signups = d.collection("pending_signups");
  const migrationBatchSize = 500;
  const hasUniqueEmailIndex = async (): Promise<boolean> => {
    const indexes = await signups.listIndexes().toArray().catch((error: unknown) => {
      if (error && typeof error === "object" && "code" in error && error.code === 26) return [];
      throw error;
    });
    return indexes.some((index) => {
      const keys = Object.entries(index.key ?? {});
      return index.unique === true && keys.length === 1 && keys[0][0] === "email" && keys[0][1] === 1;
    });
  };

  if (await hasUniqueEmailIndex()) return;
  // Deployments before this index could contain several pending rows for one
  // address. Keep the newest active claim deterministically, then enforce one
  // canonical email slot. Stream rows and flush bounded write batches so cold
  // starts do not retain the full collection and all pending writes at once.
  // Repeat on duplicate-key races with another cold start.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const now = new Date();
    await signups.deleteMany({ $or: [{ expiresAt: { $lte: now } }, { consumedAt: { $exists: true } }] });
    const seen = new Set<string>();
    let duplicateIds: ObjectId[] = [];
    let updates: { updateOne: { filter: { _id: ObjectId }; update: { $set: { email: string } } } }[] = [];
    const flush = async () => {
      if (duplicateIds.length) await signups.deleteMany({ _id: { $in: duplicateIds } });
      if (updates.length) await signups.bulkWrite(updates, { ordered: false });
      duplicateIds = [];
      updates = [];
    };
    try {
      const cursor = signups.find({}, { projection: { _id: 1, email: 1, createdAt: 1 } })
        .sort({ createdAt: -1, _id: -1 })
        .batchSize(migrationBatchSize);
      for await (const row of cursor) {
        const normalized = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
        if (!normalized || seen.has(normalized)) {
          duplicateIds.push(row._id);
        } else {
          seen.add(normalized);
          if (row.email !== normalized) updates.push({ updateOne: { filter: { _id: row._id }, update: { $set: { email: normalized } } } });
        }
        if (duplicateIds.length >= migrationBatchSize || updates.length >= migrationBatchSize) await flush();
      }
      await flush();
      await signups.createIndex({ email: 1 }, { unique: true, name: "signup_email_unique" });
      return;
    } catch (error) {
      if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
      if (await hasUniqueEmailIndex()) return;
    }
  }
  throw new Error("Could not migrate pending signup email claims to a unique index.");
}

async function ensureReviewDraftSlotMigration(d: Db): Promise<void> {
  const migrationId = "questionnaire_review_slots_v1";
  const migrations = d.collection<{ _id: string; completedAt: Date }>("schema_migrations");
  if (await migrations.findOne({ _id: migrationId }, { projection: { _id: 1 } })) return;

  const reviewDrafts = d.collection("questionnaire_review_drafts");
  try {
    await reviewDrafts.dropIndex("questionnaire_review_by_interview");
  } catch (error) {
    const code = (error as { code?: number }).code;
    if (code !== 26 && code !== 27) throw error;
  }
  // Existing releases stored at most one active candidate per interview. Assign it
  // to the first slot before enforcing the expanded slot index. This idempotent
  // backfill is shared across cold isolates using the durable completion marker.
  await reviewDrafts.updateMany({ slot: { $exists: false } }, { $set: { slot: 0 } });
  try {
    await migrations.insertOne({ _id: migrationId, completedAt: new Date() });
  } catch (error) {
    // Another isolate may have completed the same idempotent backfill first.
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
  }
}

async function ensureIndexes(d: Db) {
  await ensureReviewDraftSlotMigration(d);
  await ensurePendingSignupEmailIndex(d);
  const reviewDrafts = d.collection("questionnaire_review_drafts");
  await Promise.all([
    d.collection("tenants").createIndex({ slug: 1 }, { unique: true, name: "tenant_slug_unique" }),
    d.collection("users").createIndex({ email: 1 }, { unique: true, name: "user_email_unique" }),
    d.collection("memberships").createIndex({ tenantId: 1, userId: 1 }, { unique: true, name: "tenant_user_unique" }),
    d.collection("memberships").createIndex({ userId: 1 }, { name: "memberships_by_user" }),
    d.collection("workspace_invitations").createIndex({ tenantId: 1, email: 1 }, { unique: true, name: "workspace_invite_by_email" }),
    d.collection("workspace_invitations").createIndex({ tokenHash: 1 }, { unique: true, name: "workspace_invite_token_unique" }),
    d.collection("workspace_invitations").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "workspace_invite_expiry" }),
    d.collection("pending_signups").createIndex({ tokenHash: 1 }, { unique: true, name: "signup_token_unique" }),
    d.collection("pending_signups").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "signup_expiry" }),
    d.collection("pending_signups").createIndex({ email: 1, createdAt: -1 }, { name: "signups_by_email" }),
    d.collection("pending_email_changes").createIndex({ tokenHash: 1 }, { unique: true, name: "email_change_token_unique" }),
    d.collection("pending_email_changes").createIndex({ userId: 1 }, { unique: true, name: "email_change_by_user" }),
    d.collection("pending_email_changes").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "email_change_expiry" }),
    d.collection("pending_password_resets").createIndex({ tokenHash: 1 }, { unique: true, name: "password_reset_token_unique" }),
    d.collection("pending_password_resets").createIndex({ userId: 1 }, { unique: true, name: "password_reset_by_user" }),
    d.collection("pending_password_resets").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "password_reset_expiry" }),
    d.collection("image_assets").createIndex({ publicId: 1 }, { unique: true, name: "image_asset_public_id_unique" }),
    d.collection("image_assets").createIndex({ tenantId: 1, _id: -1 }, { name: "image_assets_by_tenant" }),
    d.collection("participants").createIndex({ token: 1 }, { unique: true, name: "token_unique" }),
    d.collection("question_order_assignments").createIndex({ participantId: 1, surveyVersion: 1 }, { unique: true, name: "participant_version_order_unique" }),
    d.collection("question_order_assignments").createIndex({ tenantId: 1, interviewId: 1, surveyVersion: 1 }, { name: "interview_version_orders" }),
    d.collection("interviews").createIndex({ tenantId: 1, updatedAt: -1 }, { name: "tenant_recent" }),
    d.collection("interviews").createIndex({ tenantId: 1, updatedAt: -1, _id: -1 }, { name: "tenant_recent_cursor" }),
    d.collection("participants").createIndex({ tenantId: 1, interviewId: 1, createdAt: 1 }, { name: "tenant_people" }),
    d.collection("participants").createIndex({ tenantId: 1, interviewId: 1, createdAt: -1, _id: -1 }, { name: "tenant_people_cursor" }),
    d.collection("survey_versions").createIndex({ tenantId: 1, interviewId: 1, version: -1 }, { name: "tenant_versions" }),
    d.collection("events").createIndex({ tenantId: 1, interviewId: 1, at: -1 }, { name: "tenant_events" }),
    d.collection("events").createIndex({ tenantId: 1, interviewId: 1, at: -1, _id: -1 }, { name: "tenant_events_cursor" }),
    d.collection("events").createIndex({ participantId: 1, tenantId: 1, at: -1 }, { partialFilterExpression: { participantId: { $exists: true } }, name: "participant_event_cleanup" }),
    d.collection("analytics_runs").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "analytics_runs_ttl" }),
    d.collection("analytics_runs").createIndex({ tenantId: 1, slot: 1 }, { unique: true, name: "analytics_runs_tenant_slot" }),
    d.collection("analytics_runs").createIndex({ tenantId: 1, interviewId: 1, createdAt: -1 }, { name: "analytics_runs_interview" }),
    reviewDrafts.createIndex({ tenantId: 1, interviewId: 1, slot: 1 }, { unique: true, name: "questionnaire_review_interview_slot" }),
    d.collection("questionnaire_review_drafts").createIndex({ reviewIdHash: 1 }, { unique: true, name: "questionnaire_review_id_unique" }),
    d.collection("questionnaire_review_drafts").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "questionnaire_review_ttl" }),
    d.collection("mail_messages").createIndex({ tenantId: 1, interviewId: 1, sentAt: -1 }, { name: "tenant_mail" }),
    d.collection("api_keys").createIndex({ tenantId: 1, createdAt: -1 }, { name: "tenant_keys" }),
    d.collection("participants").createIndex({ interviewId: 1, createdAt: 1 }, { name: "by_interview" }),
    d.collection("survey_versions").createIndex({ interviewId: 1, version: -1 }, { unique: true, name: "interview_version" }),
    d.collection("interviews").createIndex({ updatedAt: -1 }, { name: "recent" }),
    d.collection("events").createIndex({ interviewId: 1, at: -1 }, { name: "by_interview_time" }),
    d.collection("events").createIndex({ at: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 180, name: "ttl_180d" }),
    d.collection("login_attempts").createIndex({ at: 1 }, { expireAfterSeconds: 60 * 30, name: "ttl_30m" }),
    d.collection("login_attempts").createIndex({ key: 1, at: -1 }, { name: "by_key" }),
    d.collection("rate_limits").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: "ttl_expiry" }),
    d.collection("revoked_sessions").createIndex({ sid: 1 }, { unique: true, name: "sid_unique" }),
    d.collection("revoked_sessions").createIndex({ expireAt: 1 }, { expireAfterSeconds: 0, name: "ttl_expiry" }),
    d.collection("mail_messages").createIndex({ participantId: 1, sentAt: -1 }, { name: "by_participant" }),
    d.collection("mail_messages").createIndex({ interviewId: 1, sentAt: -1 }, { name: "by_interview" }),
    d.collection("api_keys").createIndex({ hash: 1 }, { unique: true, name: "hash_unique" }),
    d.collection("api_keys").createIndex({ refreshHash: 1 }, { unique: true, sparse: true, name: "refresh_unique" }),
    d.collection("api_keys").createIndex({ createdAt: -1 }, { name: "recent_keys" }),
    d.collection("oauth_clients").createIndex({ clientId: 1 }, { unique: true, name: "client_unique" }),
    d.collection("oauth_codes").createIndex({ hash: 1 }, { unique: true, name: "code_unique" }),
    d.collection("oauth_codes").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ttl_code" }),
  ]);
}

export const col = {
  tenants: async (): Promise<Collection<TenantDoc>> => (await db()).collection<TenantDoc>("tenants"),
  users: async (): Promise<Collection<UserDoc>> => (await db()).collection<UserDoc>("users"),
  memberships: async (): Promise<Collection<MembershipDoc>> => (await db()).collection<MembershipDoc>("memberships"),
  workspaceInvitations: async (): Promise<Collection<WorkspaceInvitationDoc>> => (await db()).collection<WorkspaceInvitationDoc>("workspace_invitations"),
  signups: async (): Promise<Collection<PendingSignupDoc>> => (await db()).collection<PendingSignupDoc>("pending_signups"),
  imageAssets: async (): Promise<Collection<ImageAssetDoc>> => (await db()).collection<ImageAssetDoc>("image_assets"),
  emailChanges: async (): Promise<Collection<PendingEmailChangeDoc>> => (await db()).collection<PendingEmailChangeDoc>("pending_email_changes"),
  passwordResets: async (): Promise<Collection<PendingPasswordResetDoc>> => (await db()).collection<PendingPasswordResetDoc>("pending_password_resets"),
  interviews: async (): Promise<Collection<InterviewDoc>> => (await db()).collection<InterviewDoc>("interviews"),
  versions: async (): Promise<Collection<SurveyVersionDoc>> => (await db()).collection<SurveyVersionDoc>("survey_versions"),
  participants: async (): Promise<Collection<ParticipantDoc>> => (await db()).collection<ParticipantDoc>("participants"),
  questionOrderAssignments: async (): Promise<Collection<QuestionOrderAssignmentDoc>> => (await db()).collection<QuestionOrderAssignmentDoc>("question_order_assignments"),
  events: async (): Promise<Collection<EventDoc>> => (await db()).collection<EventDoc>("events"),
  analyticsRuns: async (): Promise<Collection<AnalyticsRunDoc>> => (await db()).collection<AnalyticsRunDoc>("analytics_runs"),
  questionnaireReviewDrafts: async (): Promise<Collection<QuestionnaireReviewDraftDoc>> => (await db()).collection<QuestionnaireReviewDraftDoc>("questionnaire_review_drafts"),
  logins: async (): Promise<Collection<LoginAttemptDoc>> => (await db()).collection<LoginAttemptDoc>("login_attempts"),
  rateLimits: async (): Promise<Collection<RateLimitBucketDoc>> => (await db()).collection<RateLimitBucketDoc>("rate_limits"),
  revoked: async (): Promise<Collection<RevokedSessionDoc>> => (await db()).collection<RevokedSessionDoc>("revoked_sessions"),
  mail: async (): Promise<Collection<MailMessageDoc>> => (await db()).collection<MailMessageDoc>("mail_messages"),
  apiKeys: async (): Promise<Collection<ApiKeyDoc>> => (await db()).collection<ApiKeyDoc>("api_keys"),
  oauthClients: async (): Promise<Collection<OAuthClientDoc>> => (await db()).collection<OAuthClientDoc>("oauth_clients"),
  oauthCodes: async (): Promise<Collection<OAuthCodeDoc>> => (await db()).collection<OAuthCodeDoc>("oauth_codes"),
};
