import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "member" as "owner" | "admin" | "member",
  listParticipantPage: vi.fn(async () => ({ people: [{ id: "person-1", interviewId: "interview-1", token: "private-link", name: "Respondent", email: "private@example.test", answers: { answer: { value: "private response" } }, status: "submitted" as const, createdAt: "2026-11-16T00:00:00.000Z", updatedAt: "2026-11-16T00:00:00.000Z", revision: 1 }], nextCursor: null as string | null })),
  listCurrentMailByParticipants: vi.fn(async () => [{ participantId: { toHexString: () => "person-1" } }]),
  recentEvents: vi.fn(async () => [{ id: "event-1", participantId: "person-1", type: "submit", at: "2026-11-16T00:00:00.000Z" }]),
  hostSummaryCache: vi.fn(async (_key: unknown, compute: () => Promise<unknown>) => compute()),
}));

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("not found"); } }));
vi.mock("@/lib/http", () => ({ adminSession: async () => ({ role: state.role, tenantId: "tenant-1" }) }));
vi.mock("@/lib/env", () => ({ publicBaseUrl: () => ({ ok: true, origin: "https://kqa.test" }) }));
vi.mock("@/lib/analytics/summary", () => ({ summarizeQuestionCohorts: async () => ({ asOf: "2026-11-16T00:00:00.000Z", statusCounts: { invited: 0, in_progress: 0, submitted: 1 }, summaries: {} }), withCurrentEligibility: (_manifest: unknown, respondents: unknown) => respondents }));
vi.mock("@/lib/analytics/host-summary-cache", () => ({ getCachedHostSummary: state.hostSummaryCache }));
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
  recentEvents: state.recentEvents,
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
    expect(state.recentEvents).not.toHaveBeenCalled();
  });

  it("supplies aggregate analysis for member access without respondent records", async () => {
    const element = await InterviewPage({ params: Promise.resolve({ id: "0123456789abcdef01234567" }), searchParams: Promise.resolve({ tab: "analysis" }) });

    expect(element.props.initialTab).toBe("analysis");
    expect(element.props.data.analysis).toMatchObject({ statusCounts: { submitted: 1 } });
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
  });
});
