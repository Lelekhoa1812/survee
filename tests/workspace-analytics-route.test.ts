import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner" as "owner" | "admin" | "member",
  settings: { analyticsMinimumCellSize: 5 },
  getWorkspaceAnalytics: vi.fn(),
  updateWorkspaceAnalytics: vi.fn(),
}));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
  adminSession: async () => ({ userId: "000000000000000000000001", tenantId: "tenant-1", role: state.role }),
  guardAdmin: async (options: { roles?: string[] } = {}) => options.roles && !options.roles.includes(state.role)
    ? new Response(JSON.stringify({ ok: false, error: "forbidden" }), { status: 403 })
    : null,
  fail: (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status }),
  json: (value: unknown, status = 200) => new Response(JSON.stringify(value), { status }),
  readJson: async (req: Request, maxBytes?: number) => {
    const content = await req.text();
    if (content.length > (maxBytes ?? 16_384)) return { ok: false, res: new Response("too large", { status: 413 }) };
    try { return { ok: true, data: JSON.parse(content) }; } catch { return { ok: false, res: new Response("bad JSON", { status: 400 }) }; }
  },
}));

vi.mock("@/lib/repo/workspace-analytics", () => ({
  DEFAULT_ANALYTICS_MINIMUM_CELL_SIZE: 5,
  MIN_ANALYTICS_MINIMUM_CELL_SIZE: 2,
  MAX_ANALYTICS_MINIMUM_CELL_SIZE: 100,
  getWorkspaceAnalytics: state.getWorkspaceAnalytics,
  updateWorkspaceAnalytics: state.updateWorkspaceAnalytics,
}));

import { GET, PATCH } from "../src/app/api/admin/workspace-analytics/route";

function patchRequest(data: unknown) {
  return new Request("https://kqa.test/api/admin/workspace-analytics", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
}

describe("workspace analytics settings route", () => {
  beforeEach(() => {
    state.role = "owner";
    state.settings = { analyticsMinimumCellSize: 5 };
    state.getWorkspaceAnalytics.mockReset().mockResolvedValue(state.settings);
    state.updateWorkspaceAnalytics.mockReset().mockImplementation(async (input) => {
      state.settings = { ...state.settings, ...(input.analyticsMinimumCellSize === undefined ? {} : { analyticsMinimumCellSize: input.analyticsMinimumCellSize }) };
      return state.settings;
    });
  });

  it("uses the default aggregate minimum of five", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, settings: { analyticsMinimumCellSize: 5 } });
  });

  it("allows owners to configure the aggregate minimum", async () => {
    const response = await PATCH(patchRequest({ analyticsMinimumCellSize: 12 }));
    expect(response.status).toBe(200);
    expect(state.updateWorkspaceAnalytics).toHaveBeenCalledWith({ tenantId: "tenant-1", actorUserId: "000000000000000000000001", analyticsMinimumCellSize: 12 });
  });

  it.each([1, 101, 5.5, "5"]) ("rejects invalid analytics thresholds (%s)", async (value) => {
    const response = await PATCH(patchRequest({ analyticsMinimumCellSize: value }));
    expect(response.status).toBe(400);
    expect(state.updateWorkspaceAnalytics).not.toHaveBeenCalled();
  });

  it("rejects removed respondent policy fields and unsupported settings", async () => {
    const removed = await PATCH(patchRequest({ respondentPolicy: { notice: "Host-authored" } }));
    const unknown = await PATCH(patchRequest({ analyticsMinimumCellSize: 8, retentionDays: 30 }));
    expect(removed.status).toBe(400);
    expect(unknown.status).toBe(400);
    expect(state.updateWorkspaceAnalytics).not.toHaveBeenCalled();
  });

  it.each(["admin", "member"] as const)("blocks %s accounts from changing analytics settings", async (role) => {
    state.role = role;
    const response = await PATCH(patchRequest({ analyticsMinimumCellSize: 8 }));
    expect(response.status).toBe(403);
    expect(state.updateWorkspaceAnalytics).not.toHaveBeenCalled();
  });
});
