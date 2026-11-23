import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  session: { userId: "000000000000000000000001", tenantId: "axion", role: "owner" as "owner" | "admin" },
  result: { ok: true } as any,
  transfer: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  guardAdmin: async (...args: unknown[]) => { state.guard(...args); return state.denied; },
  adminSession: async () => state.session,
  readJson: async (req: Request) => ({ ok: true, data: await req.json() }),
  str: (value: unknown, max = 500) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
  fail: (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status }),
  json: (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }),
}));
vi.mock("@/lib/repo/workspaces", () => ({ transferWorkspaceOwnership: (...args: unknown[]) => state.transfer(...args) }));

import { POST } from "../src/app/api/admin/workspaces/transfer-ownership/route";

function request(targetUserId: unknown) {
  return new Request("https://kqa.local/api/admin/workspaces/transfer-ownership", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ targetUserId }) });
}

describe("workspace ownership transfer route", () => {
  beforeEach(() => {
    state.denied = null;
    state.session = { userId: "000000000000000000000001", tenantId: "axion", role: "owner" };
    state.result = { ok: true };
    state.transfer.mockReset().mockImplementation(async () => state.result);
    state.guard.mockReset();
  });

  it("requires the owner mutation guard and transfers only within the active tenant", async () => {
    const response = await POST(request("000000000000000000000002"));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(state.guard).toHaveBeenCalledWith({ mutating: true, roles: ["owner"] });
    expect(state.transfer).toHaveBeenCalledWith({ tenantId: "axion", actorUserId: "000000000000000000000001", targetUserId: "000000000000000000000002" });
  });

  it("validates the target and maps stale access safely", async () => {
    expect((await POST(request("not-an-id"))).status).toBe(400);
    expect((await POST(request("000000000000000000000002extra"))).status).toBe(400);
    expect(state.transfer).not.toHaveBeenCalled();
    state.result = { ok: false, reason: "not_found" };
    expect((await POST(request("000000000000000000000002"))).status).toBe(404);
    state.result = { ok: false, reason: "forbidden" };
    expect((await POST(request("000000000000000000000002"))).status).toBe(403);
  });

  it("returns guard and authentication failures before transfer", async () => {
    state.denied = new Response("Forbidden", { status: 403 });
    expect(await POST(request("000000000000000000000002"))).toBe(state.denied);
    expect(state.transfer).not.toHaveBeenCalled();
    state.denied = null;
    state.session = null as any;
    expect((await POST(request("000000000000000000000002"))).status).toBe(401);
    expect(state.transfer).not.toHaveBeenCalled();
  });
});
