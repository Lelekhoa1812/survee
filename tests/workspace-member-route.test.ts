import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  session: { userId: "000000000000000000000001", tenantId: "axion", role: "owner" as "owner" | "admin" },
  result: { ok: true, role: "member" } as any,
  remove: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  guardAdmin: async (...args: unknown[]) => { state.guard(...args); return state.denied; },
  adminSession: async () => state.session,
  fail: (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status }),
  json: (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }),
}));

vi.mock("@/lib/repo/workspaces", () => ({
  removeWorkspaceMember: (...args: unknown[]) => state.remove(...args),
}));

import { DELETE } from "../src/app/api/admin/workspace-members/[userId]/route";

function request(userId = "000000000000000000000002") {
  return new Request(`https://kqa.local/api/admin/workspace-members/${userId}`, { method: "DELETE" });
}

function context(userId = "000000000000000000000002") {
  return { params: Promise.resolve({ userId }) };
}

describe("workspace member removal route", () => {
  beforeEach(() => {
    state.denied = null;
    state.session = { userId: "000000000000000000000001", tenantId: "axion", role: "owner" };
    state.result = { ok: true, role: "member" };
    state.remove.mockReset().mockImplementation(async () => state.result);
    state.guard.mockReset();
  });

  it("requires the host same-origin owner/admin guard and removes only in the current tenant", async () => {
    const response = await DELETE(request(), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(state.guard).toHaveBeenCalledWith({ mutating: true, roles: ["owner", "admin"] });
    expect(state.remove).toHaveBeenCalledWith({
      tenantId: "axion", actorUserId: "000000000000000000000001", targetUserId: "000000000000000000000002",
    });
  });

  it("maps last-owner and role failures without exposing membership details", async () => {
    state.result = { ok: false, reason: "last_owner" };
    expect((await DELETE(request(), context())).status).toBe(409);
    state.result = { ok: false, reason: "forbidden" };
    expect((await DELETE(request(), context())).status).toBe(403);
    state.result = { ok: false, reason: "not_found" };
    expect((await DELETE(request(), context())).status).toBe(404);
    state.result = { ok: false, reason: "invalid" };
    expect((await DELETE(request("invalid"), context("invalid"))).status).toBe(400);
  });

  it("returns guard and authentication failures before repository access", async () => {
    state.denied = new Response("Forbidden", { status: 403 });
    expect(await DELETE(request(), context())).toBe(state.denied);
    expect(state.remove).not.toHaveBeenCalled();
    state.denied = null;
    state.session = null as any;
    expect((await DELETE(request(), context())).status).toBe(401);
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("returns a safe service error if the membership transaction fails", async () => {
    state.remove.mockRejectedValueOnce(new Error("database failure"));
    const response = await DELETE(request(), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database failure");
  });
});
