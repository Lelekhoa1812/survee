import type { ObjectId } from "mongodb";
import type { AnswerMap, Manifest } from "../format/schema";
import type { McpCapability } from "../mcp/capabilities";

export type InterviewMode = "single" | "multi";
export type InterviewStatus = "open" | "closed";
export type ParticipantStatus = "invited" | "in_progress" | "submitted";
export type MailStatus = "sent" | "failed";
export type MailDelivery = "delivered" | "bounced" | "unknown";
export type MailTrigger = "admin" | "mcp";
export type TenantRole = "owner" | "admin" | "member";

/** collection: tenants */
export interface TenantDoc {
  _id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  createdAt: Date;
  updatedAt: Date;
}

/** collection: users */
export interface UserDoc {
  _id: ObjectId;
  email: string;
  passwordHash: string;
  emailVerifiedAt?: Date;
  /** Existing Axion owner authenticated through the pre-account host credential during one-time bootstrap. */
  legacyBootstrap?: boolean;
  /** Bumped on password reset/change to expire previously issued sessions. */
  authVersion?: number;
  createdAt: Date;
  updatedAt: Date;
}

/** collection: memberships. Current product accounts have one default tenant; roles are explicit for future team access. */
export interface MembershipDoc {
  _id: ObjectId;
  tenantId: string;
  userId: ObjectId;
  role: TenantRole;
  createdAt: Date;
}

/** collection: pending_signups. Passwords are already scrypt-hashed; the one-time token is stored as a SHA-256 hash. */
export interface PendingSignupDoc {
  _id: ObjectId;
  userId: ObjectId;
  tenantId: string;
  tenantName: string;
  tenantSlug: string;
  email: string;
  passwordHash: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
}

/** collection: pending_email_changes. A verification link is one use and expires after 30 minutes. */
export interface PendingEmailChangeDoc {
  _id: ObjectId;
  userId: ObjectId;
  email: string;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
}

/** collection: pending_password_resets. The one-time token is stored only as a SHA-256 hash. */
export interface PendingPasswordResetDoc {
  _id: ObjectId;
  userId: ObjectId;
  tokenHash: string;
  /** Account password version when the reset was requested; null represents a pre-versioned account. */
  authVersion?: number | null;
  createdAt: Date;
  expiresAt: Date;
}

/** collection: rate_limits. One atomic, expiring counter per privacy-preserving request key. */
export interface RateLimitBucketDoc {
  _id: string;
  count: number;
  windowEndsAt: Date;
  expireAt: Date;
}

/** collection: interviews */
export interface InterviewDoc {
  _id: ObjectId;
  tenantId?: string;
  name: string;
  description?: string;
  mode: InterviewMode;
  status: InterviewStatus;
  /** The survey version people are answering now. */
  currentVersion: number;
  /** Written by respondent saves/submits and version publication to serialize the version fence. */
  respondentWriteRevision?: number;
  createdAt: Date;
  updatedAt: Date;
}

/** collection: survey_versions. One row per uploaded HTML file; never edited, so old exports stay reproducible. */
export interface SurveyVersionDoc {
  _id: ObjectId;
  tenantId?: string;
  interviewId: ObjectId;
  version: number;
  fileName?: string;
  html: string;
  htmlSha256: string;
  bytes: number;
  manifest: Manifest;
  /** Diagnostic counts at upload time, kept for the audit trail. */
  check: { errors: number; warnings: number; info: number; checkedAt: string; checkerVersion: string };
  createdAt: Date;
}

/** collection: participants. The `token` is the secret in the respondent's link. `email` is optional and is only used to send that link. */
export interface ParticipantDoc {
  _id: ObjectId;
  tenantId?: string;
  interviewId: ObjectId;
  token: string;
  name: string;
  /** Parsed address only. Empty means the host copies the link instead of emailing it. */
  email?: string;
  note?: string;
  status: ParticipantStatus;
  /** keyed by question id */
  answers: AnswerMap;
  /** Incremented on every successful save. */
  revision: number;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt?: Date;
  lastSavedAt?: Date;
  submittedAt?: Date;
}

/** collection: events. A light audit trail, expires after 180 days. */
export interface EventDoc {
  _id: ObjectId;
  tenantId?: string;
  /** Absent only for an agent call that is not about one interview. */
  interviewId?: ObjectId;
  participantId?: ObjectId;
  type: "open" | "save" | "submit" | "reopen" | "created" | "version" | "status" | "export" | "invite" | "mcp";
  at: Date;
  meta?: Record<string, unknown>;
}

/** collection: analytics_runs. Aggregate-only output retained briefly for repeatable paging. */
export interface AnalyticsRunDoc {
  _id: ObjectId;
  tenantId: string;
  interviewId: ObjectId;
  /** Fixed slot count bounds active stored runs for each tenant. */
  slot: number;
  surveyVersion: number;
  createdAt: Date;
  expiresAt: Date;
  /** Completed aggregate output only; never raw participant records or free-text answers. */
  result: Record<string, unknown>;
}

/**
 * collection: mail_messages. One row per send attempt. The body is not stored.
 * "Sent" for the current person is the latest row whose `to` and `token` still match them.
 */
export interface MailMessageDoc {
  _id: ObjectId;
  tenantId?: string;
  interviewId: ObjectId;
  participantId: ObjectId;
  kind: "invite";
  to: string;
  token: string;
  status: MailStatus;
  error?: string;
  messageId?: string;
  sentAt: Date;
  triggeredBy: MailTrigger;
  delivery?: MailDelivery;
  deliveryCheckedAt?: Date;
  deliveryDetail?: string;
}

/** collection: login_attempts. Expires after 30 minutes. */
export interface LoginAttemptDoc {
  _id: ObjectId;
  key: string;
  at: Date;
}

/** collection: revoked_sessions. A signed-out session id stays here until the session would have expired anyway. */
export interface RevokedSessionDoc {
  _id: ObjectId;
  sid: string;
  expireAt: Date;
}

/** collection: oauth_clients. A public OAuth client registered by ChatGPT or another MCP app. */
export interface OAuthClientDoc {
  _id: ObjectId;
  clientId: string;
  name: string;
  redirectUris: string[];
  createdAt: Date;
}

/** collection: oauth_codes. One-time authorization code. Only the hash is stored. */
export interface OAuthCodeDoc {
  _id: ObjectId;
  tenantId?: string;
  userId?: ObjectId;
  hash: string;
  clientId: string;
  redirectUri: string;
  challenge: string;
  email: string;
  /** Missing only on short-lived codes created before capability consent shipped. */
  capabilities?: McpCapability[];
  expiresAt: Date;
}

/** collection: api_keys. The secret is stored only as a SHA-256 hash. prefix and suffix are for the host to recognize a key. */
export interface ApiKeyDoc {
  _id: ObjectId;
  tenantId?: string;
  name: string;
  note?: string;
  prefix: string;
  suffix: string;
  hash: string;
  createdAt: Date;
  createdBy: string;
  lastUsedAt?: Date;
  expiresAt?: Date;
  revokedAt?: Date;
  /** Missing on older API keys, which retain full tool access until an owner assigns capabilities. */
  capabilities?: McpCapability[];
  /** Set when ChatGPT or another OAuth client created this key. */
  oauthClientId?: string;
  refreshHash?: string;
}

export interface ApiKeyView {
  id: string;
  name: string;
  note: string;
  prefix: string;
  suffix: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked" | "expired";
  via: "key" | "oauth";
  /** Missing means a legacy full-access key. */
  capabilities?: McpCapability[];
}

// ---- shapes handed to pages and APIs (plain JSON, ids and dates as strings)
export interface InterviewSummary {
  id: string;
  name: string;
  description?: string;
  mode: InterviewMode;
  status: InterviewStatus;
  currentVersion: number;
  createdAt: string;
  updatedAt: string;
  counts: { people: number; invited: number; inProgress: number; submitted: number };
  lastActivityAt?: string;
}

export interface ParticipantView {
  id: string;
  interviewId: string;
  token: string;
  name: string;
  email?: string;
  note?: string;
  status: ParticipantStatus;
  answers: AnswerMap;
  revision: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastSavedAt?: string;
  submittedAt?: string;
}
