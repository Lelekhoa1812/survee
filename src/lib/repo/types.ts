import type { ObjectId } from "mongodb";
import type { AnswerMap, Manifest } from "../format/schema";

export type InterviewMode = "single" | "multi";
export type InterviewStatus = "open" | "closed";
export type ParticipantStatus = "invited" | "in_progress" | "submitted";
export type MailStatus = "sent" | "failed";
export type MailDelivery = "delivered" | "bounced" | "unknown";
export type MailTrigger = "admin" | "mcp";

/** collection: interviews */
export interface InterviewDoc {
  _id: ObjectId;
  name: string;
  description?: string;
  mode: InterviewMode;
  status: InterviewStatus;
  /** The survey version people are answering now. */
  currentVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

/** collection: survey_versions. One row per uploaded HTML file; never edited, so old exports stay reproducible. */
export interface SurveyVersionDoc {
  _id: ObjectId;
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
  /** Absent only for an agent call that is not about one interview. */
  interviewId?: ObjectId;
  participantId?: ObjectId;
  type: "open" | "save" | "submit" | "reopen" | "created" | "version" | "status" | "export" | "invite" | "mcp";
  at: Date;
  meta?: Record<string, unknown>;
}

/**
 * collection: mail_messages. One row per send attempt. The body is not stored.
 * "Sent" for the current person is the latest row whose `to` and `token` still match them.
 */
export interface MailMessageDoc {
  _id: ObjectId;
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
