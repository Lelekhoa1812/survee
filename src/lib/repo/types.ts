import type { Binary, ObjectId } from "mongodb";
import type { AnswerMap, Manifest, Question, RepeatRecordMap } from "../format/schema";
import type { McpCapability } from "../mcp/capabilities";

export type InterviewMode = "single" | "multi";
export type InterviewStatus = "open" | "closed";
export type ParticipantStatus = "invited" | "in_progress" | "submitted";
export type MailStatus = "pending" | "sent" | "failed";
export type MailDelivery = "delivered" | "bounced" | "unknown";
export type MailTrigger = "admin" | "mcp";
export type TenantRole = "owner" | "admin" | "member";
export type MailResolutionPurpose = "email_change" | "token_rotation";

/** collection: tenants */
export interface TenantDoc {
  _id: string;
  name: string;
  slug: string;
  status: "active" | "suspended";
  /** Incremented transactionally on membership removal to serialize last-owner and OAuth-consent checks. */
  membershipEpoch?: number;
  /** Incremented transactionally to serialize workspace image quota checks with asset deletions. */
  imageAssetWriteEpoch?: number;
  /** Lease and per-collection checkpoints for the reviewed legacy tenant backfill. */
  legacyTenantMigration?: {
    owner?: string;
    leaseExpiresAt?: Date;
    state?: "running" | "interrupted" | "needs_review" | "complete";
    startedAt?: Date;
    finishedAt?: Date;
    completedCollections?: string[];
    modifiedByCollection?: Record<string, number>;
  };
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
  /** Preferred tenant for the next sign-in; membership is still checked independently. */
  lastTenantId?: string;
  createdAt: Date;
  updatedAt: Date;
}

/** collection: memberships. One user can belong to several workspaces, with a role in each. */
export interface MembershipDoc {
  _id: ObjectId;
  tenantId: string;
  userId: ObjectId;
  role: TenantRole;
  createdAt: Date;
}

/** collection: workspace_invitations. The single pending invite per tenant/email stores only a token hash. */
export interface WorkspaceInvitationDoc {
  _id: ObjectId;
  tenantId: string;
  email: string;
  role: "admin" | "member";
  invitedBy: ObjectId;
  tokenHash: string;
  createdAt: Date;
  expiresAt: Date;
  messageId?: string;
  mailStatus?: "pending" | "sent";
  delivery?: MailDelivery;
  deliveryCheckedAt?: Date;
  deliveryDetail?: string;
  acceptedAt?: Date;
  acceptedByUserId?: ObjectId;
  revokedAt?: Date;
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

/** collection: image_assets. Every asset belongs to one workspace; publicId is a random read capability embedded in questionnaire HTML. */
export interface ImageAssetDoc {
  _id: ObjectId;
  tenantId: string;
  publicId: string;
  name: string;
  fileName: string;
  mimeType: string;
  bytes: number;
  sha256: string;
  data: Buffer | Binary;
  createdAt: Date;
  updatedAt: Date;
  /** Transactional coordination point for publication and deletion. */
  referenceRevision?: number;
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
  /** Advances on export-visible interview, participant, assignment, and version changes. */
  respondentWriteRevision?: number;
  /** Updated when an aggregate cache is created so cache creation conflicts with participant erasure. */
  analyticsRunRevision?: number;
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
  /** Repeatable record answers keyed by repeat question id; kept separate from scalar AnswerValue. */
  recordGroups?: RepeatRecordMap;
  /** Incremented on every successful save. */
  revision: number;
  /** Incremented on submit and reopen to invalidate respondent tabs from an earlier state. */
  writeEpoch?: number;
  /** Incremented when reserving an invite attempt so deletion serializes with SMTP preflight. */
  inviteAttemptRevision?: number;
  createdAt: Date;
  updatedAt: Date;
  lastSeenAt?: Date;
  lastSavedAt?: Date;
  submittedAt?: Date;
}

/** Immutable question-order assignment delivered to one participant for one survey version. */
export interface QuestionOrderAssignmentDoc {
  _id: ObjectId;
  tenantId: string;
  interviewId: ObjectId;
  participantId: ObjectId;
  surveyVersion: number;
  algorithmVersion: string;
  groups: Record<string, string[]>;
  assignedAt: Date;
}

export interface QuestionOrderAssignmentView {
  surveyVersion: number;
  algorithmVersion: string;
  groups: Record<string, string[]>;
  assignedAt: string;
}

/** collection: events. A light audit trail, expires after 180 days. */
export interface EventDoc {
  _id: ObjectId;
  tenantId?: string;
  /** Absent for workspace-level or agent events that are not about one interview. */
  interviewId?: ObjectId;
  participantId?: ObjectId;
  type: "open" | "save" | "submit" | "reopen" | "created" | "version" | "status" | "export" | "invite" | "mcp" | "update" | "workspace_member_removed" | "workspace_owner_transferred" | "workspace_member_role_changed" | "workspace_invitation_created" | "workspace_invitation_accepted" | "workspace_invitation_revoked";
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

/** collection: questionnaire_review_drafts. Candidate HTML is accessible only during the signed window; TTL cleanup is asynchronous. */
export interface QuestionnaireReviewDraftDoc {
  _id: ObjectId;
  tenantId: string;
  interviewId: ObjectId;
  /** Fixed slot bounds the number of active candidates per tenant/interview. */
  slot: number;
  /** SHA-256 of a high-entropy review id. The id itself is returned only once to the MCP caller. */
  reviewIdHash: string;
  expectedVersion: number;
  candidateHash: string;
  fileName?: string;
  html: string;
  questions: Question[];
  createdAt: Date;
  expiresAt: Date;
}

/**
 * collection: mail_messages. One row per send attempt. The body is not stored.
 * Pending rows represent an unconfirmed SMTP outcome and are not retried automatically.
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
  /** Host acknowledgement of an ambiguous attempt; this never changes send or delivery truth. */
  resolution?: {
    purpose: MailResolutionPurpose;
    acknowledgedAt: Date;
    acknowledgedBy: string;
    reason: string;
  };
  /** Computed only for bounded host pages; never persisted. */
  pendingAttemptCount?: number;
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
  /** User who consented to an OAuth connection; used to enforce current workspace role. */
  oauthUserId?: ObjectId;
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
  recordGroups?: RepeatRecordMap;
  questionOrderAssignments?: QuestionOrderAssignmentView[];
  revision: number;
  writeEpoch?: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastSavedAt?: string;
  submittedAt?: string;
}
