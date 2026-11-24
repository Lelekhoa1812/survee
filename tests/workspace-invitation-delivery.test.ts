import { describe, expect, it, vi } from "vitest";
import { checkWorkspaceInvitationDelivery, type WorkspaceDeliveryDeps } from "../src/lib/mail/workspace-delivery";

const invitation = { id: "invite-1", email: "invitee@example.test", messageId: "<invite-1@example.test>", mailStatus: "pending" as const };

function deps(overrides: Partial<WorkspaceDeliveryDeps> = {}): WorkspaceDeliveryDeps & { check: NonNullable<WorkspaceDeliveryDeps["check"]>; rateLimit: NonNullable<WorkspaceDeliveryDeps["rateLimit"]>; save: NonNullable<WorkspaceDeliveryDeps["save"]> } {
  return {
    load: vi.fn(async () => invitation),
    check: vi.fn(async () => new Map([[invitation.messageId, { status: "unknown" as const, detail: "Not confirmed yet." }]])),
    save: vi.fn(async () => true),
    rateLimit: vi.fn(async () => true),
    ...overrides,
  };
}

describe("workspace invitation delivery checks", () => {
  it("checks and persists only the stored message id", async () => {
    const d = deps();
    const result = await checkWorkspaceInvitationDelivery("tenant-a", "invite-1", d);

    expect(result).toMatchObject({ ok: true, delivery: "unknown" });
    expect(d.check).toHaveBeenCalledWith([invitation.messageId], new Map([[invitation.messageId, invitation.email]]));
    expect(d.save).toHaveBeenCalledWith("tenant-a", "invite-1", invitation.messageId, expect.objectContaining({ delivery: "unknown", deliveryDetail: "Not confirmed yet." }));
    expect(d.rateLimit).toHaveBeenNthCalledWith(1, "workspace-invite-delivery:tenant-a:invite-1", 3, 60);
    expect(d.rateLimit).toHaveBeenNthCalledWith(2, "workspace-invite-delivery-tenant:tenant-a", 100, 60);
  });

  it("does not query IMAP when the invitation has no persisted send attempt", async () => {
    const d = deps({ load: vi.fn(async () => ({ id: "invite-1", email: "invitee@example.test" })) });

    expect(await checkWorkspaceInvitationDelivery("tenant-a", "invite-1", d)).toMatchObject({ ok: false, code: "not_sent" });
    expect(d.check).not.toHaveBeenCalled();
  });

  it("does not report a stale delivery result if the invitation was replaced during the check", async () => {
    const d = deps({ save: vi.fn(async () => false) });

    const result = await checkWorkspaceInvitationDelivery("tenant-a", "invite-1", d);

    expect(result).toMatchObject({ ok: false, code: "superseded" });
    expect(d.save).toHaveBeenCalledWith("tenant-a", "invite-1", invitation.messageId, expect.any(Object));
  });

  it("honors rate limits before searching the mailbox", async () => {
    const d = deps({ rateLimit: vi.fn(async () => false) });

    expect(await checkWorkspaceInvitationDelivery("tenant-a", "invite-1", d)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(d.check).not.toHaveBeenCalled();
    expect(d.save).not.toHaveBeenCalled();
  });

  it("fails closed when the rate limit store is unavailable", async () => {
    const d = deps({ rateLimit: vi.fn(async () => { throw new Error("offline"); }) });

    expect(await checkWorkspaceInvitationDelivery("tenant-a", "invite-1", d)).toMatchObject({ ok: false, code: "rate_limit_unavailable" });
    expect(d.check).not.toHaveBeenCalled();
  });
});
