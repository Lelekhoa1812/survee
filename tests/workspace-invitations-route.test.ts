import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rateLimit: vi.fn(async () => true),
  createWorkspaceInvitation: vi.fn(async (): Promise<{ ok: true; id: string; token: string } | { ok: false; reason: "invalid" | "already_member" | "pending" }> => ({ ok: true, id: "invite-1", token: "invite-token" })),
  revokeWorkspaceInvitation: vi.fn(async () => true),
  updateWorkspaceInvitationMail: vi.fn(async () => true),
  sendSmtp: vi.fn(async (message: { messageId: string }) => ({ messageId: message.messageId })),
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
  revokeWorkspaceInvitation: state.revokeWorkspaceInvitation,
  updateWorkspaceInvitationMail: state.updateWorkspaceInvitationMail,
}));

import { POST } from "../src/app/api/admin/workspace-invitations/route";
import { DELETE } from "../src/app/api/admin/workspace-invitations/[id]/route";

function request() {
  return new Request("https://survee.example/api/admin/workspace-invitations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Person@Example.com", role: "member" }),
  });
}

beforeEach(() => {
  state.rateLimit.mockReset().mockResolvedValue(true);
  state.createWorkspaceInvitation.mockReset().mockResolvedValue({ ok: true, id: "invite-1", token: "invite-token" });
  state.revokeWorkspaceInvitation.mockReset().mockResolvedValue(true);
  state.updateWorkspaceInvitationMail.mockReset().mockResolvedValue(true);
  state.sendSmtp.mockReset().mockImplementation(async (message: { messageId: string }) => ({ messageId: message.messageId }));
});

describe("workspace invitation email throttling", () => {
  it("records the authenticated actor when revoking a pending invitation", async () => {
    const response = await DELETE(new Request("https://survee.example/api/admin/workspace-invitations/invite-1", { method: "DELETE" }), { params: Promise.resolve({ id: "invite-1" }) });

    expect(response.status).toBe(200);
    expect(state.revokeWorkspaceInvitation).toHaveBeenCalledWith("tenant-a", "invite-1", "user-a");
  });

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
    expect(state.createWorkspaceInvitation).toHaveBeenCalledWith(expect.objectContaining({ messageId: "<invite@example.test>" }));
    expect(state.sendSmtp).toHaveBeenCalledOnce();
    expect(state.updateWorkspaceInvitationMail).toHaveBeenCalledWith("tenant-a", "invite-1", "<invite@example.test>", { mailStatus: "sent", messageId: "<invite@example.test>" });
  });

  it("persists the SMTP-returned Message-ID while matching the original attempt ID", async () => {
    state.sendSmtp.mockResolvedValueOnce({ messageId: "<accepted-by-transport@example.test>" });

    const response = await POST(request());

    expect(response.status).toBe(201);
    expect(state.updateWorkspaceInvitationMail).toHaveBeenCalledWith(
      "tenant-a", "invite-1", "<invite@example.test>",
      { mailStatus: "sent", messageId: "<accepted-by-transport@example.test>" },
    );
  });

  it("does not send or rotate an already pending invitation", async () => {
    state.createWorkspaceInvitation.mockResolvedValueOnce({ ok: false, reason: "pending" });

    const response = await POST(request());

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "invitation_pending" });
    expect(state.sendSmtp).not.toHaveBeenCalled();
  });

  it("keeps the invitation active when SMTP outcome is uncertain", async () => {
    state.sendSmtp.mockRejectedValueOnce(new Error("connection closed after DATA"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "delivery_unknown" });
    expect(state.createWorkspaceInvitation).toHaveBeenCalledOnce();
    expect(state.updateWorkspaceInvitationMail).not.toHaveBeenCalled();
  });

  it("keeps the stored attempt pending if delivery succeeds but status persistence fails", async () => {
    state.updateWorkspaceInvitationMail.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await POST(request());

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "delivery_unknown" });
    expect(state.createWorkspaceInvitation).toHaveBeenCalledWith(expect.objectContaining({ messageId: "<invite@example.test>" }));
  });
});
