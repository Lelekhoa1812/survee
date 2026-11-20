import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ip: "203.0.113.10",
  blocked: new Set<string>(),
  throttleFails: false,
  principal: null as null | { userId: string; tenantId: string; email: string; role: "owner" },
  checked: [] as string[],
  recorded: [] as string[],
  cleared: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-vercel-forwarded-for": state.ip }),
}));
vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "kqa_admin",
  createSession: () => ({ value: "signed-session", maxAge: 3600 }),
}));
vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  fail: (status: number, error: string) => Response.json({ ok: false, error }, { status }),
  json: (data: unknown) => Object.assign(Response.json(data), { cookies: { set: () => {} } }),
  readJson: async (req: Request) => ({ ok: true, data: await req.json() }),
  sameOrigin: async () => true,
  str: (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
}));
vi.mock("@/lib/repo", () => ({
  loginBlocked: async (key: string) => {
    state.checked.push(key);
    if (state.throttleFails) throw new Error("database unavailable");
    return state.blocked.has(key);
  },
  recordLoginFailure: async (key: string) => { state.recorded.push(key); },
  clearLoginFailures: async (key: string) => { state.cleared.push(key); },
}));
vi.mock("@/lib/repo/accounts", () => ({
  authenticateAccount: async () => state.principal,
  bootstrapLegacyAxionOwner: async () => null,
}));

import { POST } from "../src/app/api/admin/login/route";

function request() {
  return new Request("https://kqa.test/api/admin/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "host@example.test", password: "correct horse battery staple" }),
  });
}

beforeEach(() => {
  state.ip = "203.0.113.10";
  state.blocked.clear();
  state.throttleFails = false;
  state.principal = null;
  state.checked.length = 0;
  state.recorded.length = 0;
  state.cleared.length = 0;
});

describe("host login throttling", () => {
  it("limits repeated failures by source without a shared account lockout bucket", async () => {
    const failed = await POST(request());
    expect(failed.status).toBe(401);
    expect(state.checked).toEqual(["ip:203.0.113.10"]);
    expect(state.recorded).toEqual(["ip:203.0.113.10"]);

    state.ip = "203.0.113.11";
    state.principal = { userId: "user-1", tenantId: "tenant-1", email: "host@example.test", role: "owner" };
    const allowed = await POST(request());
    expect(allowed.status).toBe(200);
    expect(state.checked).toEqual(["ip:203.0.113.10", "ip:203.0.113.11"]);
    expect(state.cleared).toEqual(["ip:203.0.113.11"]);
  });

  it("continues to block a source after its failure limit is reached", async () => {
    state.blocked.add("ip:203.0.113.10");
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(state.recorded).toHaveLength(0);
  });

  it("fails closed when the throttle store is unavailable", async () => {
    state.throttleFails = true;
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(state.recorded).toHaveLength(0);
  });
});
