import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  session: { userId: "000000000000000000000001", tenantId: "axion", email: "owner@example.test" } as any,
  principal: null as any,
  remembered: true,
  rememberedTenant: "" as string,
}));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  guardAdmin: async () => state.denied,
  adminSession: async () => state.session,
  readJson: async (request: Request) => {
    try { return { ok: true, data: await request.json() }; }
    catch { return { ok: false, res: new Response(JSON.stringify({ ok: false, error: "Invalid JSON." }), { status: 400 }) }; }
  },
  str: (value: unknown, max: number) => typeof value === "string" && value.length <= max ? value.trim() : null,
  fail: (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status }),
  json: (data: unknown) => {
    const response = new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
    (response as any).cookies = { set: (name: string, value: string) => response.headers.append("set-cookie", `${name}=${encodeURIComponent(value)}`) };
    return response;
  },
}));

vi.mock("@/lib/auth", () => ({
  createSession: (principal: any) => ({ value: `signed:${principal.tenantId}`, maxAge: 43_200 }),
  SESSION_COOKIE: "kqa_session",
}));

vi.mock("@/lib/repo", () => ({ registerUserSession: async () => {} }));

vi.mock("@/lib/repo/accounts", () => ({
  loadAccountPrincipal: async (_userId: string, tenantId: string) => tenantId === state.principal?.tenantId ? state.principal : null,
}));

vi.mock("@/lib/repo/workspaces", () => ({
  rememberWorkspace: async (_userId: string, tenantId: string) => {
    state.rememberedTenant = tenantId;
    return state.remembered;
  },
}));

import { POST } from "../src/app/api/admin/workspaces/switch/route";

function request(tenantId: unknown) {
  return new Request("https://kqa.local/api/admin/workspaces/switch", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId }),
  });
}

describe("workspace switch route", () => {
  beforeEach(() => {
    state.denied = null;
    state.session = { userId: "000000000000000000000001", tenantId: "axion", email: "owner@example.test" };
    state.principal = { userId: state.session.userId, tenantId: "workspace-b", tenantName: "Workspace B", email: state.session.email, role: "member", authVersion: 0 };
    state.remembered = true;
    state.rememberedTenant = "";
  });

  it("sets a session scoped to an active membership and remembers the selection", async () => {
    const response = await POST(request("workspace-b"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, tenantId: "workspace-b", tenantName: "Workspace B" });
    expect(state.rememberedTenant).toBe("workspace-b");
    expect(response.headers.get("set-cookie")).toContain("kqa_session=signed%3Aworkspace-b");
  });

  it("rejects a workspace outside the current account memberships", async () => {
    const response = await POST(request("not-a-member"));
    expect(response.status).toBe(404);
    expect(state.rememberedTenant).toBe("");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("does not issue a session if saving the workspace preference fails", async () => {
    state.remembered = false;
    const response = await POST(request("workspace-b"));
    expect(response.status).toBe(404);
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("returns the request guard response before reading workspace data", async () => {
    state.denied = new Response("Forbidden", { status: 403 });
    const response = await POST(request("workspace-b"));
    expect(response).toBe(state.denied);
    expect(state.rememberedTenant).toBe("");
  });
});
