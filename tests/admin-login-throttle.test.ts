import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  ip: "203.0.113.10",
  email: "host@example.test",
  blocked: new Set<string>(),
  throttleFails: false,
  counts: new Map<string, number>(),
  principal: null as null | { userId: string; tenantId: string; email: string; role: "owner" },
  checked: [] as string[],
  cleared: [] as string[],
}));

vi.mock("next/headers", () => ({
  headers: async () => new Headers({ "x-vercel-forwarded-for": state.ip }),
}));
vi.mock("@/lib/auth", () => ({
  SESSION_COOKIE: "kqa_admin",
  createSession: () => ({ value: "signed-session", maxAge: 3600 }),
}));
vi.mock("@/lib/env", () => ({ sessionSecret: () => "test-login-throttle-secret-with-enough-length" }));
vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  fail: (status: number, error: string) => Response.json({ ok: false, error }, { status }),
  json: (data: unknown) => Object.assign(Response.json(data), { cookies: { set: () => {} } }),
  readJson: async (req: Request) => ({ ok: true, data: await req.json() }),
  sameOrigin: async () => true,
  str: (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
}));
vi.mock("@/lib/repo", () => ({
  consumeRateLimit: async (key: string, maximum: number) => {
    state.checked.push(key);
    if (state.throttleFails) throw new Error("database unavailable");
    const count = (state.counts.get(key) ?? 0) + 1;
    state.counts.set(key, count);
    return !state.blocked.has(key) && count <= maximum;
  },
  clearRateLimit: async (key: string) => { state.cleared.push(key); state.counts.delete(key); },
  registerUserSession: async () => {},
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
    body: JSON.stringify({ email: state.email, password: "correct horse battery staple" }),
  });
}

beforeEach(() => {
  state.ip = "203.0.113.10";
  state.email = "host@example.test";
  state.blocked.clear();
  state.counts.clear();
  state.throttleFails = false;
  state.principal = null;
  state.checked.length = 0;
  state.cleared.length = 0;
});

describe("host login throttling", () => {
  it("limits attempts by source and normalized account", async () => {
    const failed = await POST(request());
    expect(failed.status).toBe(401);
    expect(state.checked).toHaveLength(2);
    expect(state.checked[0]).toBe("admin-login:ip:203.0.113.10");
    expect(state.checked[1]).toMatch(/^admin-login:account:[a-f0-9]{64}$/);

    state.ip = "203.0.113.11";
    state.principal = { userId: "user-1", tenantId: "tenant-1", email: "host@example.test", role: "owner" };
    const allowed = await POST(request());
    expect(allowed.status).toBe(200);
    expect(state.checked).toHaveLength(4);
    expect(state.checked[2]).toBe("admin-login:ip:203.0.113.11");
    expect(state.checked[3]).toBe(state.checked[1]);
    expect(state.cleared).toEqual([]);
  });

  it("continues to block a source after its attempt limit is reached", async () => {
    state.blocked.add("admin-login:ip:203.0.113.10");
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(state.checked).toEqual(["admin-login:ip:203.0.113.10"]);
  });

  it("blocks an account after its short attempt budget even when the source IP changes", async () => {
    const first = await POST(request());
    const accountKey = state.checked[1];
    state.checked.length = 0;
    state.ip = "203.0.113.99";
    state.blocked.add(accountKey);
    const response = await POST(request());
    expect(first.status).toBe(401);
    expect(response.status).toBe(429);
    expect(state.checked[0]).toBe("admin-login:ip:203.0.113.99");
    expect(state.checked[1]).toBe(accountKey);
  });

  it("fails closed when the throttle store is unavailable", async () => {
    state.throttleFails = true;
    const response = await POST(request());
    expect(response.status).toBe(503);
  });
});
