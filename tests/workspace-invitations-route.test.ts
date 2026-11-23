import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => true),
  createWorkspaceInvitation: vi.fn(async () => ({ ok: true as const, token: "invite-token" })),
  sendSmtp: vi.fn(async () => undefined),
}));

vi.mock("@/lib/http", () => ({
  adminSession: async () => ({ tenantId: "tenant-a", userId: "user-a", tenantName: "Team A", role: "owner" }),
  fail: (status: number, error: string, extra = {}) => Response.json({ ok: false, error, ...extra }, { status }),
  guardAdmin: async () => null,
  json: (body: unknown, status = 200) => Response.json(body, { status }),
  readJson: async (request: Request) => ({ ok: true, data: await request.json() }),
  str: (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
}));
vi.mock("@/lib/mail/smtp", () => ({ newMessageId: () => "<invite@example.test>", sendSmtp: state.sendSmtp }));
vi.mock("@/lib/env", () => ({
  publicBaseUrl: () => ({ ok: true, origin: "https://survee.example" }),
  smtpSettings: () => ({ ok: true, user: "host@example.test" }),
}));
vi.mock("@/lib/repo", () => ({ consumeRateLimit: state.rateLimit }));
vi.mock("@/lib/repo/workspaces", () => ({
  createWorkspaceInvitation: state.createWorkspaceInvitation,
  listWorkspaceAccess: vi.fn(),
  revokeWorkspaceInvitationByToken: vi.fn(),
}));

import { POST } from "../src/app/api/admin/workspace-invitations/route";

function request() {
  return new Request("https://survee.example/api/admin/workspace-invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Person@Example.com", role: "member" }),
  });
}

beforeEach(() => {
  state.rateLimit.mockReset().mockResolvedValue(true);
  state.createWorkspaceInvitation.mockReset().mockResolvedValue({ ok: true, token: "invite-token" });
  state.sendSmtp.mockReset().mockResolvedValue(undefined);
});

describe("workspace invitation email throttling", () => {
  it("limits invitations by tenant and normalized recipient before creating or sending", async () => {
    state.rateLimit.mockResolvedValueOnce(false);
    const response = await POST(request());

    expect(response.status).toBe(429);
    expect(state.rateLimit).toHaveBeenCalledWith("workspace-invite-recipient:tenant-a:person@example.com", 3, 60);
    expect(state.createWorkspaceInvitation).not.toHaveBeenCalled();
    expect(state.sendSmtp).not.toHaveBeenCalled();
  });

  it("fails closed if the durable rate-limit store is unavailable", async () => {
    state.rateLimit.mockRejectedValueOnce(new Error("database unavailable"));
    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(state.createWorkspaceInvitation).not.toHaveBeenCalled();
    expect(state.sendSmtp).not.toHaveBeenCalled();
  });

  it("sends when recipient and workspace limits allow the invitation", async () => {
    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(state.rateLimit).toHaveBeenNthCalledWith(1, "workspace-invite-recipient:tenant-a:person@example.com", 3, 60);
    expect(state.rateLimit).toHaveBeenNthCalledWith(2, "workspace-invite-tenant:tenant-a", 100, 60);
    expect(state.createWorkspaceInvitation).toHaveBeenCalledOnce();
    expect(state.sendSmtp).toHaveBeenCalledOnce();
  });
});
