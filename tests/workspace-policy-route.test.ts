import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  role: "owner" as "owner" | "admin" | "member",
  policy: { analyticsMinimumCellSize: 5, respondentPolicy: null as null | Record<string, unknown> },
  getWorkspacePolicy: vi.fn(),
  updateWorkspacePolicy: vi.fn(),
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

vi.mock("@/lib/repo/workspace-policy", () => ({
  DEFAULT_ANALYTICS_MINIMUM_CELL_SIZE: 5,
  MIN_ANALYTICS_MINIMUM_CELL_SIZE: 2,
  MAX_ANALYTICS_MINIMUM_CELL_SIZE: 100,
  getWorkspacePolicy: state.getWorkspacePolicy,
  updateWorkspacePolicy: state.updateWorkspacePolicy,
}));

import { GET, PATCH } from "../src/app/api/admin/workspace-policy/route";

function patchRequest(data: unknown) {
  return new Request("https://kqa.test/api/admin/workspace-policy", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(data) });
}

describe("workspace policy route", () => {
  beforeEach(() => {
    state.role = "owner";
    state.policy = { analyticsMinimumCellSize: 5, respondentPolicy: null };
    state.getWorkspacePolicy.mockReset().mockResolvedValue(state.policy);
    state.updateWorkspacePolicy.mockReset().mockImplementation(async (input) => {
      state.policy = { ...state.policy, ...(input.analyticsMinimumCellSize === undefined ? {} : { analyticsMinimumCellSize: input.analyticsMinimumCellSize }), ...(input.respondentPolicy === undefined ? {} : { respondentPolicy: input.respondentPolicy }) };
      return state.policy;
    });
  });

  it("uses the default analytics minimum and leaves respondent policy unconfigured", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ policy: { analyticsMinimumCellSize: 5, respondentPolicy: null } });
  });

  it("allows owners to configure analytics and host-authored policy fields", async () => {
    const response = await PATCH(patchRequest({
      analyticsMinimumCellSize: 12,
      respondentPolicy: { notice: "Host authored", purpose: "Research", retention: "We retain per our stated schedule", contact: "host@example.test", withdrawal: "Contact the host" },
    }));
    expect(response.status).toBe(200);
    expect(state.updateWorkspacePolicy).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-1", actorUserId: "000000000000000000000001", analyticsMinimumCellSize: 12,
      respondentPolicy: expect.objectContaining({ notice: "Host authored", purpose: "Research" }),
    }));
  });

  it.each([1, 101, 5.5, "5"])("rejects invalid analytics thresholds (%s)", async (value) => {
    const response = await PATCH(patchRequest({ analyticsMinimumCellSize: value }));
    expect(response.status).toBe(400);
    expect(state.updateWorkspacePolicy).not.toHaveBeenCalled();
  });

  it("rejects unknown fields and oversized host text", async () => {
    const unknownSetting = await PATCH(patchRequest({ analyticsMinimumCellSize: 8, retentionDays: 30 }));
    expect(unknownSetting.status).toBe(400);
    const unknown = await PATCH(patchRequest({ respondentPolicy: { notice: "hello", legalConclusion: "safe" } }));
    expect(unknown.status).toBe(400);
    const tooLong = await PATCH(patchRequest({ respondentPolicy: { notice: "x".repeat(5001) } }));
    expect(tooLong.status).toBe(400);
    expect(state.updateWorkspacePolicy).not.toHaveBeenCalled();
  });

  it.each(["admin", "member"] as const)("blocks %s accounts from changing workspace policies", async (role) => {
    state.role = role;
    const response = await PATCH(patchRequest({ analyticsMinimumCellSize: 8 }));
    expect(response.status).toBe(403);
    expect(state.updateWorkspacePolicy).not.toHaveBeenCalled();
  });

  it("clears all-blank respondent policy content without injecting replacement text", async () => {
    const response = await PATCH(patchRequest({ respondentPolicy: { notice: "  ", purpose: "", retention: "", contact: "", withdrawal: "" } }));
    expect(response.status).toBe(200);
    expect(state.updateWorkspacePolicy).toHaveBeenCalledWith(expect.objectContaining({ respondentPolicy: null }));
  });
});
