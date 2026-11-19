import type { AnswerMap, Manifest, RepeatRecordMap } from "@/lib/format/schema";
import type { AnalyticsCohortKey } from "@/lib/analytics/cohorts";
import type { QuestionSummary } from "@/lib/analytics/summary";
import type { ParticipantStatus } from "@/lib/repo/types";

export interface PersonMail {
  state: "unsent" | "sent" | "failed";
  sentAt?: string;
  error?: string;
  delivery: "delivered" | "bounced" | "unknown";
  deliveryCheckedAt?: string;
  deliveryDetail?: string;
}

export interface PersonRow {
  id: string;
  token: string;
  name: string;
  email?: string;
  note?: string;
  mail: PersonMail;
  status: "invited" | "in_progress" | "submitted";
  answered: number;
  total: number;
  requiredMissing: number;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
  lastSavedAt?: string;
  submittedAt?: string;
  answers: AnswerMap;
  recordGroups?: RepeatRecordMap;
}

export interface VersionRow {
  version: number;
  fileName?: string;
  bytes: number;
  createdAt: string;
  check: { errors: number; warnings: number; info: number };
  questions: number;
}

export interface EventRow {
  id: string;
  type: string;
  at: string;
  person?: string;
  meta?: Record<string, unknown>;
}

export interface InterviewData {
  interview: { id: string; name: string; description?: string; mode: "single" | "multi"; status: "open" | "closed"; currentVersion: number; createdAt: string };
  /** Aggregate-only counts; available to workspace members without exposing respondent records. */
  counts: { people: number; invited: number; inProgress: number; submitted: number };
  people: PersonRow[];
  versions: VersionRow[];
  events: EventRow[];
  manifest: Manifest;
  /** Public origin used inside invite emails. Null when KQA_PUBLIC_URL is unset. */
  publicOrigin: string | null;
  /** Aggregate-only answers for analysis routes. No respondent identifiers or raw text values. */
  analysis?: {
    asOf: string;
    statusCounts: Record<ParticipantStatus, number>;
    summaries: Record<AnalyticsCohortKey, Record<string, QuestionSummary>>;
  };
}
