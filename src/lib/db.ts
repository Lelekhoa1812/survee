import { MongoClient, type ClientSession, type Collection, type Db } from "mongodb";
import { dbName, mongoUri } from "./env";
import type { AnalyticsRunDoc, ApiKeyDoc, EventDoc, InterviewDoc, LoginAttemptDoc, MailMessageDoc, MembershipDoc, OAuthClientDoc, OAuthCodeDoc, ParticipantDoc, PendingEmailChangeDoc, PendingPasswordResetDoc, PendingSignupDoc, QuestionnaireReviewDraftDoc, RateLimitBucketDoc, RevokedSessionDoc, SurveyVersionDoc, TenantDoc, UserDoc } from "./repo/types";

declare global {
  // eslint-disable-next-line no-var
  var __kqaMongo: { client: Promise<MongoClient>; indexes?: Promise<void> } | undefined;
}

function client(): Promise<MongoClient> {
  if (!globalThis.__kqaMongo) {
    const c = new MongoClient(mongoUri(), { maxPoolSize: 5, serverSelectionTimeoutMS: 8000, appName: "kqa" });
    globalThis.__kqaMongo = { client: c.connect() };
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

async function ensureIndexes(d: Db) {
  await Promise.all([
    d.collection("tenants").createIndex({ slug: 1 }, { unique: true, name: "tenant_slug_unique" }),
    d.collection("users").createIndex({ email: 1 }, { unique: true, name: "user_email_unique" }),
    d.collection("memberships").createIndex({ tenantId: 1, userId: 1 }, { unique: true, name: "tenant_user_unique" }),
    d.collection("memberships").createIndex({ userId: 1 }, { name: "memberships_by_user" }),
    d.collection("pending_signups").createIndex({ tokenHash: 1 }, { unique: true, name: "signup_token_unique" }),
    d.collection("pending_signups").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "signup_expiry" }),
    d.collection("pending_signups").createIndex({ email: 1, createdAt: -1 }, { name: "signups_by_email" }),
    d.collection("pending_email_changes").createIndex({ tokenHash: 1 }, { unique: true, name: "email_change_token_unique" }),
    d.collection("pending_email_changes").createIndex({ userId: 1 }, { unique: true, name: "email_change_by_user" }),
    d.collection("pending_email_changes").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "email_change_expiry" }),
    d.collection("pending_password_resets").createIndex({ tokenHash: 1 }, { unique: true, name: "password_reset_token_unique" }),
    d.collection("pending_password_resets").createIndex({ userId: 1 }, { unique: true, name: "password_reset_by_user" }),
    d.collection("pending_password_resets").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "password_reset_expiry" }),
    d.collection("participants").createIndex({ token: 1 }, { unique: true, name: "token_unique" }),
    d.collection("interviews").createIndex({ tenantId: 1, updatedAt: -1 }, { name: "tenant_recent" }),
    d.collection("participants").createIndex({ tenantId: 1, interviewId: 1, createdAt: 1 }, { name: "tenant_people" }),
    d.collection("survey_versions").createIndex({ tenantId: 1, interviewId: 1, version: -1 }, { name: "tenant_versions" }),
    d.collection("events").createIndex({ tenantId: 1, interviewId: 1, at: -1 }, { name: "tenant_events" }),
    d.collection("analytics_runs").createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "analytics_runs_ttl" }),
    d.collection("analytics_runs").createIndex({ tenantId: 1, slot: 1 }, { unique: true, name: "analytics_runs_tenant_slot" }),
    d.collection("analytics_runs").createIndex({ tenantId: 1, interviewId: 1, createdAt: -1 }, { name: "analytics_runs_interview" }),
    d.collection("questionnaire_review_drafts").createIndex({ tenantId: 1, interviewId: 1 }, { unique: true, name: "questionnaire_review_by_interview" }),
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
  signups: async (): Promise<Collection<PendingSignupDoc>> => (await db()).collection<PendingSignupDoc>("pending_signups"),
  emailChanges: async (): Promise<Collection<PendingEmailChangeDoc>> => (await db()).collection<PendingEmailChangeDoc>("pending_email_changes"),
  passwordResets: async (): Promise<Collection<PendingPasswordResetDoc>> => (await db()).collection<PendingPasswordResetDoc>("pending_password_resets"),
  interviews: async (): Promise<Collection<InterviewDoc>> => (await db()).collection<InterviewDoc>("interviews"),
  versions: async (): Promise<Collection<SurveyVersionDoc>> => (await db()).collection<SurveyVersionDoc>("survey_versions"),
  participants: async (): Promise<Collection<ParticipantDoc>> => (await db()).collection<ParticipantDoc>("participants"),
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
