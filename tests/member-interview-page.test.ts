import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "member" as "owner" | "admin" | "member",
  listParticipantPage: vi.fn(async () => ({ people: [{ id: "person-1", interviewId: "interview-1", token: "private-link", name: "Respondent", email: "private@example.test", answers: { answer: { value: "private response" } }, status: "submitted" as const, createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z", revision: 1 }], nextCursor: null as string | null })),
  listCurrentMailByParticipants: vi.fn(async () => [{ participantId: { toHexString: () => "person-1" } }]),
  listEventPage: vi.fn(async () => ({ events: [{ id: "event-1", participantId: "person-1", type: "submit", at: "2026-11-16T00:00:00.000Z" }], nextCursor: "next-events" })),
  hostSummaryCache: vi.fn(async (_key: unknown, compute: () => Promise<unknown>) => compute()),
  summary: { asOf: "2026-11-16T00:00:00.000Z", statusCounts: { invited: 0, in_progress: 0, submitted: 1 }, summaries: {} as Record<string, Record<string, unknown>> },
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/http", () => ({ adminSession: async () => ({ role: state.role, tenantId: "tenant-1" }) }));
vi.mock("@/lib/env", () => ({ publicBaseUrl: () => ({ ok: true, origin: "https://kqa.test" }) }));
vi.mock("@/lib/analytics/summary", () => ({ summarizeQuestionCohorts: async () => state.summary, withCurrentEligibility: (_manifest: unknown, respondents: unknown) => respondents }));
vi.mock("@/lib/analytics/host-summary-cache", () => ({ getCachedHostSummary: state.hostSummaryCache }));
vi.mock("@/lib/repo/workspace-analytics", () => ({ getWorkspaceAnalytics: async () => ({ analyticsMinimumCellSize: 5 }) }));
vi.mock("@/lib/format/answers", () => ({ progress: () => ({ answered: 1, total: 1, missingRequired: [] }), eligibilityQuestionIds: (_manifest: unknown, ids: string[]) => ids }));
vi.mock("@/lib/mail/state", () => ({ currentMail: () => ({ state: "sent", sentAt: "2026-11-16T00:00:00.000Z", delivery: "unknown" }) }));
vi.mock("@/lib/repo/mail", () => ({ listCurrentMailByParticipants: state.listCurrentMailByParticipants, mailRecord: (row: unknown) => row }));
vi.mock("@/lib/host/participant-rows", () => ({ participantRows: (_manifest: unknown, people: unknown[]) => people }));
vi.mock("@/lib/repo", () => ({
  getInterview: async () => ({ _id: "interview-1", name: "Study", description: "Research", mode: "multi", status: "open", currentVersion: 1, createdAt: new Date("2026-11-16T00:00:00.000Z") }),
  getInterviewParticipantCounts: async () => ({ people: 1, invited: 0, inProgress: 0, submitted: 1 }),
  getVersion: async () => ({ manifest: { format: "kqa/1", title: "Study", questions: [], sections: [] }, version: 1 }),
  iterateAnalyticsParticipants: async function* () { yield { status: "submitted", answers: {} }; },
  listParticipantPage: state.listParticipantPage,
  listVersions: async () => [{ version: 1, fileName: "study.html", bytes: 10, createdAt: new Date("2026-11-16T00:00:00.000Z"), check: { errors: 0, warnings: 0, info: 0 }, manifest: { questions: [] } }],
  listEventPage: state.listEventPage,
}));

import InterviewPage from "../src/app/admin/(shell)/interviews/[id]/page";

beforeEach(() => {
  state.role = "member";
  vi.clearAllMocks();
});

describe("member interview server page", () => {
  it("does not fetch or pass respondent records, mail, or activity into the member UI", async () => {
    const element = await InterviewPage({ params: Promise.resolve({ id: "0123456789abcdef01234567" }), searchParams: Promise.resolve({ tab: "overview" }) });

    expect(element.props.canManage).toBe(false);
    expect(element.props.data.people).toEqual([]);
    expect(element.props.data.events).toEqual([]);
    expect(element.props.data.counts).toEqual({ people: 1, invited: 0, inProgress: 0, submitted: 1 });
    expect(state.listParticipantPage).not.toHaveBeenCalled();
    expect(state.listCurrentMailByParticipants).not.toHaveBeenCalled();
    expect(state.listEventPage).not.toHaveBeenCalled();
  });

  it("supplies aggregate analysis for member access without respondent records", async () => {
    const element = await InterviewPage({ params: Promise.resolve({ id: "0123456789abcdef01234567" }), searchParams: Promise.resolve({ tab: "analysis" }) });

    expect(element.props.initialTab).toBe("analysis");
    expect(element.props.data.analysis).toBeUndefined();
    expect(element.props.data.analysisSuppressed).toEqual({ minimumCellSize: 5 });
    expect(element.props.data.people).toEqual([]);
    expect(state.listParticipantPage).not.toHaveBeenCalled();
    expect(state.hostSummaryCache).toHaveBeenCalledWith({ tenantId: "tenant-1", interviewId: "0123456789abcdef01234567", surveyVersion: 1, respondentRevision: 0 }, expect.any(Function));
  });

  it("loads respondent details for admins", async () => {
    state.role = "admin";
    const element = await InterviewPage({ params: Promise.resolve({ id: "0123456789abcdef01234567" }), searchParams: Promise.resolve({ tab: "overview" }) });

    expect(element.props.canManage).toBe(true);
    expect(element.props.data.people[0]).toMatchObject({ name: "Respondent", email: "private@example.test", token: "private-link" });
    expect(state.listParticipantPage).toHaveBeenCalledOnce();
    expect(element.props.data.peopleNextCursor).toBeNull();
    expect(element.props.data.eventsNextCursor).toBe("next-events");
  });

  it("keeps safe Everyone analysis available when an unrelated status group is small", async () => {
    const summaryFor = (cohortCount: number) => ({
      cohortCount, eligibleCount: cohortCount, inactiveCount: 0, answeredCount: cohortCount, noAnswerCount: 0, missingCount: 0,
      noteOnlyCount: 0, unmappedResponseCount: 0, distributionDenominator: cohortCount, distribution: [], numeric: null,
      numericUnmappedResponseCount: 0, numericCount: cohortCount, disclosureRisk: { singletonCohort: false, singletonAnsweredCount: false,
        singletonNoAnswerCount: false, singletonNoteOnlyCount: false, singletonUnmappedResponseCount: false,
        singletonDistributionDenominator: false, singletonDistributionValues: [], singletonNumericSummary: false },
    });
    state.summary = {
      asOf: "2026-11-16T00:00:00.000Z",
      statusCounts: { invited: 2, in_progress: 2, submitted: 5 },
      summaries: {
        everyone: { q1: summaryFor(9) }, invited: { q1: summaryFor(2) }, in_progress: { q1: summaryFor(2) }, submitted: { q1: summaryFor(5) },
        "invited,in_progress": { q1: summaryFor(4) }, "invited,submitted": { q1: summaryFor(7) }, "in_progress,submitted": { q1: summaryFor(7) },
      },
    };

    const element = await InterviewPage({ params: Promise.resolve({ id: "0123456789abcdef01234567" }), searchParams: Promise.resolve({ tab: "analysis" }) });

    expect(element.props.data.analysisSuppressed).toBeUndefined();
    expect(element.props.data.analysis.availableCohorts).toEqual(["everyone", "submitted"]);
    expect(element.props.data.analysis.statusCounts).toBeUndefined();
    expect(element.props.data.analysis.canCompareStatuses).toBe(false);
    expect(element.props.data.analysis.summaries.everyone.q1.cohortCount).toBe(9);
    expect(element.props.data.analysis.summaries.invited).toBeUndefined();
  });
});
