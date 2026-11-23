import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: null as Response | null,
  session: { userId: "000000000000000000000001", tenantId: "axion", role: "owner" as "owner" | "admin" },
  result: { ok: true, role: "member" } as any,
  remove: vi.fn(),
  changeRole: vi.fn(),
  guard: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  guardAdmin: async (...args: unknown[]) => { state.guard(...args); return state.denied; },
  adminSession: async () => state.session,
  fail: (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status }),
  json: (data: unknown) => new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } }),
  readJson: async (req: Request) => ({ ok: true, data: await req.json() }),
}));

vi.mock("@/lib/repo/workspaces", () => ({
  removeWorkspaceMember: (...args: unknown[]) => state.remove(...args),
  changeWorkspaceMemberRole: (...args: unknown[]) => state.changeRole(...args),
}));

import { DELETE, PATCH } from "../src/app/api/admin/workspace-members/[userId]/route";

function request(userId = "000000000000000000000002") {
  return new Request(`https://kqa.local/api/admin/workspace-members/${userId}`, { method: "DELETE" });
}

function roleRequest(role: unknown, userId = "000000000000000000000002") {
  return new Request(`https://kqa.local/api/admin/workspace-members/${userId}`, { method: "PATCH", body: JSON.stringify({ role }), headers: { "content-type": "application/json" } });
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
    state.changeRole.mockReset().mockImplementation(async () => ({ ok: true, previousRole: "member", role: "admin" }));
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

  it("allows only the owner to change a non-owner role in the current workspace", async () => {
    const response = await PATCH(roleRequest("admin"), context());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, previousRole: "member", role: "admin" });
    expect(state.guard).toHaveBeenCalledWith({ mutating: true, roles: ["owner"] });
    expect(state.changeRole).toHaveBeenCalledWith({ tenantId: "axion", actorUserId: "000000000000000000000001", targetUserId: "000000000000000000000002", role: "admin" });
    expect(state.remove).not.toHaveBeenCalled();
  });

  it("validates role input and keeps owner changes on the handoff path", async () => {
    expect((await PATCH(roleRequest("owner"), context())).status).toBe(400);
    expect(state.changeRole).not.toHaveBeenCalled();
    state.changeRole.mockResolvedValueOnce({ ok: false, reason: "owner_transfer_required" });
    expect((await PATCH(roleRequest("member"), context())).status).toBe(409);
    state.changeRole.mockResolvedValueOnce({ ok: false, reason: "forbidden" });
    expect((await PATCH(roleRequest("member"), context())).status).toBe(403);
    state.changeRole.mockRejectedValueOnce(new Error("database failure"));
    const response = await PATCH(roleRequest("member"), context());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("database failure");
  });
});
