import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  revision: 4,
  interviewReads: 0,
  mutateOnInterviewRead: 0,
  pageReads: 0,
  singlePage: false,
  pageGate: null as Promise<void> | null,
  pageGateStarted: null as (() => void) | null,
  manifest: null as Record<string, any> | null,
  assignment: null as Record<string, any> | null,
  denied: null as Response | null,
  exportEvents: [] as { id: string; format: string }[],
  participant: {
    id: "participant-1", name: "Alex", status: "invited", createdAt: "2026-01-01T00:00:00.000Z",
    answers: {},
  },
}));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: any[]) => Promise<Response>) => handler,
  guardAdmin: async () => state.denied,
  fail: (status: number, error: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: false, error, ...extra }), { status }),
}));

vi.mock("@/lib/repo", () => ({
  getInterview: async () => {
    state.interviewReads += 1;
    if (state.mutateOnInterviewRead === state.interviewReads) state.revision += 1;
    return {
      _id: "interview-object-id", name: "Study", mode: "multi", status: "open", currentVersion: 1,
      respondentWriteRevision: state.revision, createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
  },
  getVersion: async () => ({ version: 1, manifest: state.manifest ?? { format: "kqa/1", title: "Study", questions: [] } }),
  listParticipants: async () => [state.participant],
  listParticipantPage: async (_id: string, _cursor: string | null, _limit: number, _submittedOnly: boolean, includeOrderAssignments: boolean) => {
    state.pageReads += 1;
    if (state.pageReads === 2 && state.pageGate) {
      state.pageGateStarted?.();
      await state.pageGate;
    }
    const participant = includeOrderAssignments && state.assignment
      ? { ...state.participant, questionOrderAssignments: [state.assignment] }
      : state.participant;
    return { people: [participant], nextCursor: !state.singlePage && state.pageReads === 1 ? "next" : null };
  },
  recordExportEvent: async (id: string, format: string) => { state.exportEvents.push({ id, format }); return true; },
  ParticipantExportSizeLimitError: class ParticipantExportSizeLimitError extends Error {},
  ParticipantReadLimitError: class ParticipantReadLimitError extends Error {},
}));

import { GET } from "../src/app/api/admin/interviews/[id]/export/route";
import { exportInterview } from "../src/lib/export";

function request(format: "csv-wide" | "csv-long" | "csv-records" | "json" = "csv-wide") {
  return new Request(`https://survee.example/api/admin/interviews/interview-id/export?format=${format}`);
}

const params = { params: Promise.resolve({ id: "interview-id" }) };

beforeEach(() => {
  state.revision = 4;
  state.interviewReads = 0;
  state.mutateOnInterviewRead = 0;
  state.pageReads = 0;
  state.singlePage = false;
  state.pageGate = null;
  state.pageGateStarted = null;
  state.manifest = null;
  state.assignment = null;
  state.denied = null;
  state.exportEvents.length = 0;
});

describe("export revision checks", () => {
  it("completes a CSV export when the interview revision stays stable across pages", async () => {
    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Alex");
    expect(state.pageReads).toBe(2);
    expect(state.exportEvents).toEqual([{ id: "interview-id", format: "csv-wide" }]);
  });

  it("errors the CSV stream when respondent data changes between pages", async () => {
    state.mutateOnInterviewRead = 5; // The pre-read check for page two.

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow("Interview data changed while the export was being created");
    expect(state.pageReads).toBe(1);
    expect(state.exportEvents).toEqual([]);
  });

  it("stops fetching pages and skips the completion audit when the client cancels", async () => {
    let releasePage!: () => void;
    let signalPageStarted!: () => void;
    state.pageGate = new Promise<void>((resolve) => { releasePage = resolve; });
    const pageStarted = new Promise<void>((resolve) => { signalPageStarted = resolve; });
    state.pageGateStarted = signalPageStarted;

    const response = await GET(request(), params);
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    await reader.read(); // CSV header.
    const nextChunk = reader.read();
    await pageStarted;

    const cancellation = reader.cancel();
    releasePage();
    await cancellation;
    await nextChunk;

    expect(state.pageReads).toBe(2);
    expect(state.exportEvents).toEqual([]);
  });

  it("checks the revision immediately before closing a single-page CSV stream", async () => {
    state.singlePage = true;
    state.mutateOnInterviewRead = 5; // Final check before controller.close().

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow("Interview data changed while the export was being created");
    expect(state.pageReads).toBe(1);
    expect(state.exportEvents).toEqual([]);
  });

  it.each(["csv-wide", "csv-long"] as const)("keeps question-order assignment metadata in streamed %s exports", async (format) => {
    state.singlePage = true;
    state.manifest = {
      format: "kqa/1", title: "Study", questions: [
        { id: "first", type: "text", label: "First" },
        { id: "second", type: "text", label: "Second" },
      ],
      questionOrderGroups: [{ id: "context", questionIds: ["first", "second"] }],
    };
    state.assignment = {
      surveyVersion: 1, algorithmVersion: "kqa-question-order-v1",
      groups: { context: ["second", "first"] }, assignedAt: "2026-01-02T03:04:05.000Z",
    };

    const response = await GET(request(format), params);
    expect(response.status).toBe(200);
    const streamed = await response.text();
    const buffered = await exportInterview({
      interview: { id: "interview-id", name: "Study", mode: "multi", status: "open", createdAt: "2026-01-01T00:00:00.000Z" },
      manifest: state.manifest as any,
      surveyVersion: 1,
      participants: [{ ...state.participant, status: "invited", questionOrderAssignments: [state.assignment as any] } as any],
      generatedAt: "2026-01-03T00:00:00.000Z",
    }, format);
    const expected = typeof buffered.body === "string" ? buffered.body : new TextDecoder().decode(buffered.body);
    expect(streamed).toBe(expected.replace(/^\uFEFF/, ""));
    if (format === "csv-wide") {
      expect(streamed).toContain("context | assigned question order (survey v1)");
      expect(streamed).toContain("second;first");
    } else {
      expect(streamed).toContain("presentation,1,kqa-question-order-v1,context,second;first,2026-01-02T03:04:05.000Z");
    }
  });

  it("streams repeat-record CSV identical to the buffered export", async () => {
    state.singlePage = true;
    state.manifest = {
      format: "kqa/1", title: "Study", questions: [{ id: "items", type: "repeat", label: "Items", fields: [{ id: "label", label: "Label", type: "text" }], maxRows: 5 }],
    };
    state.participant = {
      id: "participant-1", name: "Alex", status: "invited", createdAt: "2026-01-01T00:00:00.000Z",
      answers: {}, recordGroups: { items: [{ id: "row-1", values: { label: "=SUM(A1)" }, revision: 1, fieldRevisions: {} }] },
    } as any;
    const response = await GET(request("csv-records"), params);
    expect(response.status).toBe(200);
    const streamed = await response.text();
    const buffered = await exportInterview({
      interview: { id: "interview-id", name: "Study", mode: "multi", status: "open", createdAt: "2026-01-01T00:00:00.000Z" },
      manifest: state.manifest as any, surveyVersion: 1,
      participants: [{ ...state.participant, status: "invited" } as any], generatedAt: "2026-01-03T00:00:00.000Z",
    }, "csv-records");
    expect(streamed).toBe((buffered.body as string).replace(/^\uFEFF/, ""));
    expect(streamed).toContain("'=SUM(A1)");
    expect(state.exportEvents).toEqual([{ id: "interview-id", format: "csv-records" }]);
  });

  it("returns a stale conflict when respondent data changes during a buffered read", async () => {
    state.mutateOnInterviewRead = 4; // The post-read check around listParticipants.

    const response = await GET(request("json"), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "export_stale" });
  });

  it("returns a stale conflict when respondent data changes during buffered serialization", async () => {
    state.mutateOnInterviewRead = 5; // Final check after exportInterview returns.

    const response = await GET(request("json"), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "export_stale" });
    expect(state.exportEvents).toEqual([]);
  });

  it("records a minimal audit event after a successful buffered export", async () => {
    const response = await GET(request("json"), params);

    expect(response.status).toBe(200);
    expect(state.exportEvents).toEqual([{ id: "interview-id", format: "json" }]);
  });
});
