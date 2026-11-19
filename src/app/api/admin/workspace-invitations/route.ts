import { createHash } from "node:crypto";
import { adminSession, fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { parseEmail } from "@/lib/mail/address";
import { newMessageId, sendSmtp } from "@/lib/mail/smtp";
import { publicBaseUrl, smtpSettings } from "@/lib/env";
import { createWorkspaceInvitation, listWorkspaceAccess, revokeWorkspaceInvitationByToken } from "@/lib/repo/workspaces";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export async function GET() {
  const denied = await guardAdmin({ roles: ["owner", "admin"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  try {
    return json({ ok: true, ...(await listWorkspaceAccess(session.tenantId)) });
  } catch {
    return fail(503, "Workspace members could not be loaded. Try again.");
  }
}

export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const body = await readJson<{ email?: unknown; role?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const parsed = parseEmail(str(body.data.email, 254) ?? "");
  const role = body.data.role === "admin" ? "admin" : body.data.role === "member" || body.data.role === undefined ? "member" : null;
  if (!parsed.ok || !parsed.email || /\.(local|test|example|invalid)$/i.test(parsed.email.split("@")[1] ?? "")) return fail(400, "Enter an email address that can receive an invitation.");
  if (!role) return fail(400, "Choose an admin or member workspace role.");
  const smtp = smtpSettings();
  const base = publicBaseUrl();
  if (!smtp.ok || !base.ok) return fail(503, "Workspace invitations are temporarily unavailable.");

  let invitation: Awaited<ReturnType<typeof createWorkspaceInvitation>>;
  try {
    invitation = await createWorkspaceInvitation({ tenantId: session.tenantId, invitedByUserId: session.userId, email: parsed.email, role });
  } catch {
    return fail(503, "The workspace invitation could not be created. Try again.");
  }
  if (!invitation.ok && invitation.reason === "already_member") return fail(409, "That account already belongs to this workspace.");
  if (!invitation.ok) return fail(403, "You cannot invite people to this workspace.");
  const joinUrl = new URL("/join", base.origin);
  joinUrl.searchParams.set("token", invitation.token);
  const escapedUrl = escapeHtml(joinUrl.toString());
  try {
    await sendSmtp({
      to: parsed.email,
      subject: `Join ${session.tenantName} on survee`,
      text: `You have been invited to join ${session.tenantName} as a workspace ${role}. Accept the invitation: ${joinUrl.toString()}\n\nThis link expires in 7 days. If you did not expect this invitation, you can ignore this message.`,
      html: `<p>You have been invited to join <strong>${escapeHtml(session.tenantName)}</strong> as a workspace ${role}.</p><p><a href="${escapedUrl}">Accept the invitation</a></p><p>This link expires in 7 days. If you did not expect this invitation, you can ignore this message.</p>`,
      messageId: newMessageId(smtp.user),
    });
    return json({ ok: true, message: `Invitation sent to ${parsed.email}.` }, 201);
  } catch {
    await revokeWorkspaceInvitationByToken(session.tenantId, invitation.token).catch(() => {});
    return fail(503, "The invitation email could not be sent. Try again.");
  }
}
