import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  revision: 4,
  interviewReads: 0,
  mutateOnInterviewRead: 0,
  pageReads: 0,
  denied: null as Response | null,
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
  getVersion: async () => ({ version: 1, manifest: { format: "kqa/1", title: "Study", questions: [] } }),
  listParticipants: async () => [state.participant],
  listParticipantPage: async () => {
    state.pageReads += 1;
    return { people: [state.participant], nextCursor: state.pageReads === 1 ? "next" : null };
  },
  ParticipantExportSizeLimitError: class ParticipantExportSizeLimitError extends Error {},
  ParticipantReadLimitError: class ParticipantReadLimitError extends Error {},
}));

import { GET } from "../src/app/api/admin/interviews/[id]/export/route";

function request(format: "csv-wide" | "json" = "csv-wide") {
  return new Request(`https://survee.example/api/admin/interviews/interview-id/export?format=${format}`);
}

const params = { params: Promise.resolve({ id: "interview-id" }) };

beforeEach(() => {
  state.revision = 4;
  state.interviewReads = 0;
  state.mutateOnInterviewRead = 0;
  state.pageReads = 0;
  state.denied = null;
});

describe("export revision checks", () => {
  it("completes a CSV export when the interview revision stays stable across pages", async () => {
    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Alex");
    expect(state.pageReads).toBe(2);
  });

  it("errors the CSV stream when respondent data changes between pages", async () => {
    state.mutateOnInterviewRead = 5; // The pre-read check for page two.

    const response = await GET(request(), params);

    expect(response.status).toBe(200);
    await expect(response.text()).rejects.toThrow("Interview data changed while the export was being created");
    expect(state.pageReads).toBe(1);
  });

  it("returns a stale conflict when respondent data changes during a buffered read", async () => {
    state.mutateOnInterviewRead = 4; // The post-read check around listParticipants.

    const response = await GET(request("json"), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "export_stale" });
  });
});
