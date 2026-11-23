import type { AnswerMap, Manifest, RepeatRecordMap } from "@/lib/format/schema";
import type { AnalyticsCohortKey } from "@/lib/analytics/cohorts";
import type { QuestionSummary } from "@/lib/analytics/summary";
import type { ParticipantStatus, QuestionOrderAssignmentView } from "@/lib/repo/types";

export interface PersonMail {
  state: "unsent" | "pending" | "sent" | "failed";
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
  questionOrderAssignments?: QuestionOrderAssignmentView[];
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
  participantId?: string;
  meta?: Record<string, unknown>;
}

export interface InterviewData {
  interview: { id: string; name: string; description?: string; mode: "single" | "multi"; status: "open" | "closed"; currentVersion: number; createdAt: string };
  /** Aggregate-only counts; available to workspace members without exposing respondent records. */
  counts: { people: number; invited: number; inProgress: number; submitted: number };
  people: PersonRow[];
  /** Whether the bounded participant page contains raw answers and order-assignment history. */
  answersIncluded?: boolean;
  /** Opaque cursor for fetching the next bounded host participant page. */
  peopleNextCursor?: string | null;
  versions: VersionRow[];
  events: EventRow[];
  eventsNextCursor?: string | null;
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
