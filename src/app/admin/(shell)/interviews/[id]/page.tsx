import { notFound } from "next/navigation";
import { InterviewView } from "@/components/InterviewView";
import type { InterviewData } from "@/components/interview-types";
import { progress } from "@/lib/format/answers";
import { getInterview, getVersion, listParticipants, listVersions, recentEvents } from "@/lib/repo";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const i = await getInterview(id).catch(() => null);
  return { title: i?.name ?? "Interview" };
}

export default async function InterviewPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const { tab } = await searchParams;
  const interview = await getInterview(id);
  if (!interview) notFound();
  const [current, people, versions, events] = await Promise.all([getVersion(interview._id, interview.currentVersion), listParticipants(id), listVersions(interview._id), recentEvents(id, 25)]);
  if (!current) notFound();
  const names = new Map(people.map((p) => [p.id, p.name]));

  const data: InterviewData = {
    interview: { id, name: interview.name, description: interview.description, mode: interview.mode, status: interview.status, currentVersion: interview.currentVersion, createdAt: interview.createdAt.toISOString() },
    manifest: current.manifest,
    people: people.map((p) => {
      const pr = progress(current.manifest, p.answers);
      return { id: p.id, token: p.token, name: p.name, note: p.note, status: p.status, answered: pr.answered, total: pr.total, requiredMissing: pr.missingRequired.length, createdAt: p.createdAt, updatedAt: p.updatedAt, lastSeenAt: p.lastSeenAt, lastSavedAt: p.lastSavedAt, submittedAt: p.submittedAt, answers: p.answers };
    }),
    versions: versions.map((v) => ({ version: v.version, fileName: v.fileName, bytes: v.bytes, createdAt: v.createdAt.toISOString(), check: { errors: v.check.errors, warnings: v.check.warnings, info: v.check.info }, questions: v.manifest.questions.length })),
    events: events.map((e) => ({ id: e.id, type: e.type, at: e.at, person: e.participantId ? names.get(e.participantId) : undefined, meta: e.meta })),
  };
  const initial = ["overview", "people", "answers", "survey", "export"].includes(tab ?? "") ? (tab as string) : "overview";
  return <InterviewView data={data} initialTab={initial} />;
}
