import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  cursorError: false,
  ParticipantCursorError: class ParticipantCursorError extends Error {},
  listParticipantPage: vi.fn(async (..._args: unknown[]) => ({ people: [{ id: "person-1" }], nextCursor: "next-page" })),
  listCurrentMailByParticipants: vi.fn(async () => []),
}));

vi.mock("@/lib/http", () => ({
  fail: (status: number, error: string, extra = {}) => Response.json({ ok: false, error, ...extra }, { status }),
  guardAdmin: async () => state.denied ? Response.json({ ok: false }, { status: 401 }) : null,
  json: (value: unknown) => Response.json(value),
  withServerErrors: (_route: string, handler: (...args: any[]) => Promise<Response>) => handler,
}));
vi.mock("@/lib/repo", () => ({
  getInterview: async () => ({ _id: "interview-object-id", currentVersion: 2 }),
  getVersion: async () => ({ manifest: { format: "kqa/1", title: "Study", questions: [], sections: [] } }),
  listParticipantPage: (...args: unknown[]) => {
    if (state.cursorError) return Promise.reject(new state.ParticipantCursorError());
    return state.listParticipantPage(...args as any);
  },
  ParticipantCursorError: state.ParticipantCursorError,
}));
vi.mock("@/lib/repo/mail", () => ({ listCurrentMailByParticipants: state.listCurrentMailByParticipants, mailRecord: (row: unknown) => row }));
vi.mock("@/lib/host/participant-rows", () => ({ participantRows: (_manifest: unknown, people: unknown[]) => people.map((person) => ({ ...(person as Record<string, unknown>), progress: true })) }));

import { GET } from "../src/app/api/admin/interviews/[id]/participants/route";

function request(query = "") {
  return new Request(`https://survee.example/api/admin/interviews/interview-id/participants${query}`);
}

beforeEach(() => {
  state.denied = false;
  state.cursorError = false;
  state.listParticipantPage.mockReset().mockResolvedValue({ people: [{ id: "person-1" }], nextCursor: "next-page" });
  state.listCurrentMailByParticipants.mockReset().mockResolvedValue([]);
});

describe("admin participant cursor pages", () => {
  it("returns a bounded page and forwards the opaque cursor", async () => {
    const response = await GET(request("?cursor=opaque%2Bcursor&limit=40"), { params: Promise.resolve({ id: "interview-id" }) });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, people: [{ progress: true }], nextCursor: "next-page" });
    expect(state.listParticipantPage).toHaveBeenCalledWith("interview-id", "opaque+cursor", 40, false, false);
  });

  it("loads answer details only for an explicit answer-page request", async () => {
    const response = await GET(request("?cursor=older-page&includeAnswers=1"), { params: Promise.resolve({ id: "interview-id" }) });

    expect(response.status).toBe(200);
    expect(state.listParticipantPage).toHaveBeenCalledWith("interview-id", "older-page", undefined, false, true);
    expect(state.listCurrentMailByParticipants).not.toHaveBeenCalled();
  });

  it("rejects unrecognized answer-page flags", async () => {
    const response = await GET(request("?includeAnswers=true"), { params: Promise.resolve({ id: "interview-id" }) });

    expect(response.status).toBe(400);
    expect(state.listParticipantPage).not.toHaveBeenCalled();
  });

  it("rejects an oversized page before loading respondent data", async () => {
    const response = await GET(request("?limit=101"), { params: Promise.resolve({ id: "interview-id" }) });

    expect(response.status).toBe(400);
    expect(state.listParticipantPage).not.toHaveBeenCalled();
  });

  it("maps a malformed or expired cursor to a refreshable client error", async () => {
    state.cursorError = true;
    const response = await GET(request("?cursor=broken"), { params: Promise.resolve({ id: "interview-id" }) });

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "participant_cursor_invalid" });
  });

  it("does not read participant records without an authorized host session", async () => {
    state.denied = true;

    const response = await GET(request(), { params: Promise.resolve({ id: "interview-id" }) });

    expect(response.status).toBe(401);
    expect(state.listParticipantPage).not.toHaveBeenCalled();
  });
});
