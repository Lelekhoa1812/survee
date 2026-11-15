import type { ParticipantStatus } from "../repo/types";

export const ANALYTICS_STATUSES = ["invited", "in_progress", "submitted"] as const satisfies readonly ParticipantStatus[];

export const ANALYTICS_COHORTS = [
  { key: "everyone", label: "Everyone", statuses: ["invited", "in_progress", "submitted"] },
  { key: "invited", label: "Invited only", statuses: ["invited"] },
  { key: "in_progress", label: "In progress only", statuses: ["in_progress"] },
  { key: "submitted", label: "Submitted only", statuses: ["submitted"] },
  { key: "invited,in_progress", label: "Invited + in progress", statuses: ["invited", "in_progress"] },
  { key: "invited,submitted", label: "Invited + submitted", statuses: ["invited", "submitted"] },
  { key: "in_progress,submitted", label: "In progress + submitted", statuses: ["in_progress", "submitted"] },
] as const satisfies readonly { key: string; label: string; statuses: readonly ParticipantStatus[] }[];

export type AnalyticsCohortKey = typeof ANALYTICS_COHORTS[number]["key"];

export function analyticsCohortForStatuses(statuses: readonly ParticipantStatus[]) {
  const normalized = ANALYTICS_STATUSES.filter((status) => statuses.includes(status));
  return ANALYTICS_COHORTS.find((cohort) => cohort.statuses.length === normalized.length
    && cohort.statuses.every((status, index) => status === normalized[index])) ?? null;
}
