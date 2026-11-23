import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { userId: "000000000000000000000001", tenantId: "workspace-a", email: "owner@example.test", role: "owner" as const, authVersion: 3, sid: "current-sid", exp: 1_900_000_000 },
  denied: null as Response | null,
  authVersion: 4 as number | null,
  sessions: [{ current: true, createdAt: "2026-11-24T00:00:00.000Z", expiresAt: "2026-11-24T12:00:00.000Z" }],
  registered: [] as unknown[],
  listed: [] as unknown[],
}));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  adminSession: async () => state.session,
  guardAdmin: async () => state.denied,
  sameOrigin: async () => true,
  fail: (status: number, error: string) => Response.json({ ok: false, error }, { status }),
  json: (data: unknown) => {
    const response = Response.json(data);
    (response as any).cookies = { set: (name: string, value: string) => response.headers.append("set-cookie", name + "=" + encodeURIComponent(value)) };
    return response;
  },
}));
vi.mock("@/lib/auth", () => ({ SESSION_COOKIE: "kqa_admin", createSession: () => ({ value: "fresh-cookie", sid: "fresh-sid", maxAge: 43_200 }) }));
vi.mock("@/lib/repo/accounts", () => ({ invalidateAccountSessions: async () => state.authVersion }));
vi.mock("@/lib/repo", () => ({
  registerUserSession: async (input: unknown) => { state.registered.push(input); },
  listUserSessions: async (input: unknown) => { state.listed.push(input); return state.sessions; },
}));

import { GET, POST } from "../src/app/api/admin/account/sessions/route";

beforeEach(() => {
  state.denied = null;
  state.authVersion = 4;
  state.registered.length = 0;
  state.listed.length = 0;
});

describe("account session inventory", () => {
  it("registers the current session and returns only safe session metadata", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, sessions: state.sessions });
    expect(state.registered).toEqual([{ sid: "current-sid", userId: state.session.userId, tenantId: "workspace-a", authVersion: 3, exp: state.session.exp }]);
    expect(state.listed).toEqual([{ userId: state.session.userId, authVersion: 3, currentSid: "current-sid" }]);
  });

  it("invalidates all older auth versions and issues a fresh current cookie", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(response.headers.get("set-cookie")).toContain("kqa_admin=fresh-cookie");
    expect(state.registered).toHaveLength(1);
    expect(state.registered[0]).toMatchObject({ sid: "fresh-sid", userId: state.session.userId, tenantId: "workspace-a", authVersion: 4 });
  });

  it("does not change sessions when the host mutation guard denies access", async () => {
    state.denied = new Response("denied", { status: 403 });
    const response = await POST();
    expect(response.status).toBe(403);
    expect(state.registered).toHaveLength(0);
  });
});
