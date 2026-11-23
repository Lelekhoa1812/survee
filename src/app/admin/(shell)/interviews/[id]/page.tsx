import { notFound } from "next/navigation";
import { InterviewView } from "@/components/InterviewView";
import type { InterviewData } from "@/components/interview-types";
import { publicBaseUrl } from "@/lib/env";
import { eligibilityQuestionIds } from "@/lib/format/answers";
import { summarizeQuestionCohorts, withCurrentEligibility } from "@/lib/analytics/summary";
import { getInterview, getInterviewParticipantCounts, getVersion, iterateAnalyticsParticipants, listParticipantPage, listVersions, recentEvents } from "@/lib/repo";
import { listCurrentMailByParticipants, mailRecord } from "@/lib/repo/mail";
import { participantRows } from "@/lib/host/participant-rows";
import { adminSession } from "@/lib/http";

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
  const [current, counts, peoplePage, versions, events] = await Promise.all([
    getVersion(interview._id, interview.currentVersion),
    getInterviewParticipantCounts(id),
    !canManage || analysisOnly ? Promise.resolve({ people: [], nextCursor: null }) : listParticipantPage(id),
    analysisOnly ? Promise.resolve([]) : listVersions(interview._id),
    !canManage || analysisOnly ? Promise.resolve([]) : recentEvents(id, 25),
  ]);
  if (!current) notFound();
  const mailRows = !canManage || analysisOnly ? [] : await listCurrentMailByParticipants(interview._id, peoplePage.people);
  const people = participantRows(current.manifest, peoplePage.people, mailRows.map(mailRecord));
  let analysis: InterviewData["analysis"];
  if (analysisOnly) {
    const questionIds = current.manifest.questions.map((question) => question.id);
    analysis = await summarizeQuestionCohorts(current.manifest.questions, withCurrentEligibility(current.manifest, iterateAnalyticsParticipants(id, eligibilityQuestionIds(current.manifest, questionIds))));
  }
  const base = publicBaseUrl();

  const data: InterviewData = {
    interview: { id, name: interview.name, description: interview.description, mode: interview.mode, status: interview.status, currentVersion: interview.currentVersion, createdAt: interview.createdAt.toISOString() },
    counts,
    manifest: current.manifest,
    publicOrigin: base.ok ? base.origin : null,
    ...(analysis ? { analysis } : {}),
    people,
    peopleNextCursor: peoplePage.nextCursor,
    versions: versions.map((v) => ({ version: v.version, fileName: v.fileName, bytes: v.bytes, createdAt: v.createdAt.toISOString(), check: { errors: v.check.errors, warnings: v.check.warnings, info: v.check.info }, questions: v.manifest.questions.length })),
    events: events.map((e) => ({ id: e.id, type: e.type, at: e.at, person: e.participantId ? people.find((person) => person.id === e.participantId)?.name : undefined, meta: e.meta })),
  };
  const allowedTabs = canManage ? ["overview", "people", "answers", "analysis", "survey", "export"] : ["overview", "analysis", "survey"];
  const initial = allowedTabs.includes(tab ?? "") ? (tab as string) : "overview";
  return <InterviewView key={initial} data={data} initialTab={initial} analysisOnly={initial === "analysis"} canManage={canManage} />;
}
