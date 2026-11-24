import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ deleted: true as boolean | "invite_pending" | "confirmation_mismatch", denied: null as Response | null, deleteArgs: [] as unknown[] }));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  guardAdmin: async () => state.denied,
  readJson: async () => ({ ok: true, data: { confirmName: "Study" } }),
  fail: (status: number, error: string, extra?: Record<string, unknown>) => new Response(JSON.stringify({ ok: false, error, ...extra }), { status }),
  json: (data: unknown) => new Response(JSON.stringify(data), { status: 200 }),
}));

vi.mock("@/lib/repo", () => ({
  deleteInterview: async (...args: unknown[]) => { state.deleteArgs = args; return state.deleted; },
  getInterview: async () => ({ name: "Study" }),
  listParticipants: async () => [],
  listVersions: async () => [],
  recentEvents: async () => [],
  updateInterview: async () => null,
}));

import { DELETE } from "../src/app/api/admin/interviews/[id]/route";

const params = { params: Promise.resolve({ id: "0123456789abcdef01234567" }) };
const request = () => new Request("https://kqa.local/api/admin/interviews/0123456789abcdef01234567", {
  method: "DELETE",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ confirmName: "Study" }),
});

beforeEach(() => {
  state.deleted = true;
  state.denied = null;
  state.deleteArgs = [];
});

describe("admin interview delete route", () => {
  it("does not claim success if the tenant-scoped record disappears before deletion", async () => {
    state.deleted = false;

    const response = await DELETE(request(), params);

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "Interview not found." });
  });

  it("confirms success after a completed deletion", async () => {
    const response = await DELETE(request(), params);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(state.deleteArgs).toEqual(["0123456789abcdef01234567", "Study"]);
  });

  it("returns a conflict when the interview was renamed after the user confirmed its old name", async () => {
    state.deleted = "confirmation_mismatch";

    const response = await DELETE(request(), params);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ ok: false, code: "confirmation_mismatch" });
  });
});
