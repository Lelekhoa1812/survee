import { checkMessageIds, type DeliveryCheck } from "./imap";
import { consumeRateLimit } from "../repo";
import { getWorkspaceInvitationMail, updateWorkspaceInvitationMail } from "../repo/workspaces";

export type WorkspaceDeliveryResult =
  | { ok: true; delivery: "delivered" | "bounced" | "unknown"; checkedAt: string; detail?: string }
  | { ok: false; code: "not_found" | "not_sent" | "rate_limited" | "rate_limit_unavailable" | "superseded"; error: string };

export interface WorkspaceDeliveryDeps {
  load?: typeof getWorkspaceInvitationMail;
  check?: (messageIds: string[], recipients?: Map<string, string>) => Promise<Map<string, DeliveryCheck>>;
  save?: typeof updateWorkspaceInvitationMail;
  rateLimit?: typeof consumeRateLimit;
}

/** Check only the Message-ID persisted on this tenant's pending workspace invitation. */
export async function checkWorkspaceInvitationDelivery(
  tenantId: string,
  invitationId: string,
  deps: WorkspaceDeliveryDeps = {},
): Promise<WorkspaceDeliveryResult> {
  const invitation = await (deps.load ?? getWorkspaceInvitationMail)(tenantId, invitationId);
  if (!invitation) return { ok: false, code: "not_found", error: "Invitation not found." };
  if (!invitation.messageId || (invitation.mailStatus !== "pending" && invitation.mailStatus !== "sent")) {
    return { ok: false, code: "not_sent", error: "There is no stored invitation email attempt to check." };
  }
  const consume = deps.rateLimit ?? consumeRateLimit;
  try {
    const allowed = await consume(`workspace-invite-delivery:${tenantId}:${invitation.id}`, 3, 60)
      && await consume(`workspace-invite-delivery-tenant:${tenantId}`, 100, 60);
    if (!allowed) return { ok: false, code: "rate_limited", error: "Delivery was checked recently. Wait before checking again." };
  } catch {
    return { ok: false, code: "rate_limit_unavailable", error: "Delivery checks are temporarily unavailable. Try again." };
  }
  const checked = await (deps.check ?? checkMessageIds)([invitation.messageId], new Map([[invitation.messageId, invitation.email]]));
  const result = checked.get(invitation.messageId) ?? { status: "unknown" as const, detail: "Not confirmed yet." };
  const checkedAt = new Date();
  const saved = await (deps.save ?? updateWorkspaceInvitationMail)(tenantId, invitation.id, invitation.messageId, {
    delivery: result.status,
    deliveryCheckedAt: checkedAt,
    deliveryDetail: result.detail,
  });
  if (!saved) return { ok: false, code: "superseded", error: "This invitation changed while delivery was being checked. Reload the pending invitations and check the current message." };
  return { ok: true, delivery: result.status, checkedAt: checkedAt.toISOString(), detail: result.detail };
}
