import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as any,
  denied: null as Response | null,
  renameResult: true,
  updates: [] as { tenantId: string; name: string }[],
}));

vi.mock("@/lib/http", () => ({
  guardAdmin: async () => state.denied,
  adminSession: async () => state.session,
  readJson: async (req: Request) => {
    try {
      return { ok: true, data: await req.json() };
    } catch {
      return { ok: false, res: new Response(JSON.stringify({ ok: false, error: "Invalid JSON." }), { status: 400 }) };
    }
  },
  fail: (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status }),
  json: (data: unknown) => new Response(JSON.stringify(data), { status: 200 }),
}));

vi.mock("@/lib/repo/accounts", () => ({
  updateTenantName: async (tenantId: string, name: string) => {
    state.updates.push({ tenantId, name });
    return state.renameResult;
  },
}));

import { POST } from "../src/app/api/admin/tenant/route";

function request(name: unknown) {
  return new Request("https://kqa.local/api/admin/tenant", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
  });
}

describe("workspace settings route", () => {
  beforeEach(() => {
    state.session = { tenantId: "tenant-1", role: "owner" };
    state.denied = null;
    state.renameResult = true;
    state.updates = [];
  });

  it("allows an owner to rename only the tenant in their session", async () => {
    const response = await POST(request("  Axion Research  "));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, tenantName: "Axion Research" });
    expect(state.updates).toEqual([{ tenantId: "tenant-1", name: "Axion Research" }]);
  });

  it("rejects non-owners before attempting a tenant update", async () => {
    state.session.role = "admin";
    const response = await POST(request("Unauthorized rename"));
    expect(response.status).toBe(403);
    expect(state.updates).toHaveLength(0);
  });

  it("rejects invalid names without calling the repository", async () => {
    const response = await POST(request("   "));
    expect(response.status).toBe(400);
    expect(state.updates).toHaveLength(0);
  });
});
