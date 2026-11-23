import { notFound } from "next/navigation";
import { InterviewView } from "@/components/InterviewView";
import type { InterviewData } from "@/components/interview-types";
import { publicBaseUrl } from "@/lib/env";
import { eligibilityQuestionIds } from "@/lib/format/answers";
import { summarizeQuestionCohorts, withCurrentEligibility } from "@/lib/analytics/summary";
import { getCachedHostSummary } from "@/lib/analytics/host-summary-cache";
import { suppressSmallCohortAnalytics } from "@/lib/analytics/disclosure";
import { getInterview, getInterviewParticipantCounts, getVersion, iterateAnalyticsParticipants, listEventPage, listParticipantPage, listVersions } from "@/lib/repo";
import { listCurrentMailByParticipants, mailRecord } from "@/lib/repo/mail";
import { participantRows } from "@/lib/host/participant-rows";
import { adminSession } from "@/lib/http";
import { getWorkspacePolicy } from "@/lib/repo/workspace-policy";
import { ANALYTICS_COHORTS, type AnalyticsCohortKey } from "@/lib/analytics/cohorts";
import type { QuestionSummary } from "@/lib/analytics/summary";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const i = await getInterview(id).catch(() => null);
  return { title: i?.name ?? "Interview" };
}

export default async function InterviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const session = await adminSession();
  if (!session) notFound();
  const canManage = session.role === "owner" || session.role === "admin";
  const interview = await getInterview(id);
  if (!interview) notFound();
  const analysisOnly = tab === "analysis";
  const answersIncluded = canManage && tab === "answers";
  const [current, counts, peoplePage, versions, eventPage] = await Promise.all([
    getVersion(interview._id, interview.currentVersion),
    getInterviewParticipantCounts(id),
    !canManage || analysisOnly ? Promise.resolve({ people: [], nextCursor: null }) : listParticipantPage(id, null, undefined, false, answersIncluded),
    analysisOnly ? Promise.resolve([]) : listVersions(interview._id),
    !canManage || analysisOnly ? Promise.resolve({ events: [], nextCursor: null }) : listEventPage(id, null, 25),
  ]);
  if (!current) notFound();
  const mailRows = !canManage || analysisOnly ? [] : await listCurrentMailByParticipants(interview._id, peoplePage.people);
  const people = participantRows(current.manifest, peoplePage.people, mailRows.map(mailRecord), answersIncluded);
  let analysis: InterviewData["analysis"];
  let analysisSuppressed: InterviewData["analysisSuppressed"];
  if (analysisOnly) {
    const questionIds = current.manifest.questions.map((question) => question.id);
    const [summary, workspacePolicy] = await Promise.all([getCachedHostSummary({
      tenantId: session.tenantId,
      interviewId: id,
      surveyVersion: current.version,
      respondentRevision: interview.respondentWriteRevision ?? 0,
    }, () => summarizeQuestionCohorts(current.manifest.questions, withCurrentEligibility(current.manifest, iterateAnalyticsParticipants(id, eligibilityQuestionIds(current.manifest, questionIds))))), getWorkspacePolicy(session.tenantId)]);
    const minimumCellSize = workspacePolicy?.analyticsMinimumCellSize ?? 5;
    const statusCountsAreSafe = Object.values(summary.statusCounts).every((count) => count === 0 || count >= minimumCellSize);
    const summaries: Partial<Record<AnalyticsCohortKey, Record<string, QuestionSummary>>> = {};
    const baseCohortSafe = new Set<string>();
    const statusPayloadSafe = new Set<string>();
    for (const cohort of ANALYTICS_COHORTS.filter((item) => item.key !== "everyone" && item.statuses.length === 1)) {
      const count = summary.statusCounts[cohort.statuses[0]];
      const cohortSummary = summary.summaries[cohort.key] ?? {};
      const result = count === 0 || count >= minimumCellSize ? suppressSmallCohortAnalytics(cohortSummary, minimumCellSize) : null;
      if (result && !result.suppressed && Object.keys(result.value).length > 0) statusPayloadSafe.add(cohort.key);
      if (result && !result.suppressed && Object.keys(result.value).length > 0) {
        if (count === 0 || count >= minimumCellSize) {
          summaries[cohort.key] = result.value;
          baseCohortSafe.add(cohort.key);
        }
      }
    }
    for (const cohort of ANALYTICS_COHORTS) {
      if (cohort.key === "everyone") {
        const result = suppressSmallCohortAnalytics(summary.summaries[cohort.key] ?? {}, minimumCellSize);
        if (!result.suppressed && Object.keys(result.value).length > 0) summaries[cohort.key] = result.value;
        continue;
      }
      if (cohort.statuses.length < 2 || !cohort.statuses.every((status) => baseCohortSafe.has(status))) continue;
      const result = suppressSmallCohortAnalytics(summary.summaries[cohort.key] ?? {}, minimumCellSize);
      if (!result.suppressed && Object.keys(result.value).length > 0) summaries[cohort.key] = result.value;
    }
    const canCompareStatuses = statusCountsAreSafe
      && ["invited", "in_progress", "submitted"].every((status) => statusPayloadSafe.has(status));
    if (Object.keys(summaries).length) {
      analysis = {
        asOf: summary.asOf,
        summaries,
        availableCohorts: ANALYTICS_COHORTS.filter((cohort) => cohort.key in summaries).map((cohort) => cohort.key),
        canCompareStatuses,
        ...(canCompareStatuses ? { statusCounts: summary.statusCounts } : {}),
      };
    } else {
      analysisSuppressed = { minimumCellSize };
    }
  }
  const base = publicBaseUrl();

  const data: InterviewData = {
    interview: { id, name: interview.name, description: interview.description, mode: interview.mode, status: interview.status, currentVersion: interview.currentVersion, createdAt: interview.createdAt.toISOString() },
    counts,
    manifest: current.manifest,
    publicOrigin: base.ok ? base.origin : null,
    ...(analysis ? { analysis } : {}),
    ...(analysisSuppressed ? { analysisSuppressed } : {}),
    people,
    answersIncluded,
    peopleNextCursor: peoplePage.nextCursor,
    versions: versions.map((v) => ({ version: v.version, fileName: v.fileName, bytes: v.bytes, createdAt: v.createdAt.toISOString(), check: { errors: v.check.errors, warnings: v.check.warnings, info: v.check.info }, questions: v.manifest.questions.length })),
    events: eventPage.events.map((e) => ({ id: e.id, type: e.type, at: e.at, person: e.participantId ? people.find((person) => person.id === e.participantId)?.name : undefined, meta: e.meta })),
    eventsNextCursor: eventPage.nextCursor,
  };
  const allowedTabs = canManage ? ["overview", "people", "answers", "analysis", "survey", "export"] : ["overview", "analysis", "survey"];
  const initial = allowedTabs.includes(tab ?? "") ? (tab as string) : "overview";
  return <InterviewView key={initial} data={data} initialTab={initial} analysisOnly={initial === "analysis"} canManage={canManage} />;
}
