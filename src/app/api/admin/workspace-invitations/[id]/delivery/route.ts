import { adminSession, fail, guardAdmin, json, withServerErrors } from "@/lib/http";
import { checkWorkspaceInvitationDelivery } from "@/lib/mail/workspace-delivery";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withServerErrors("admin/workspace-invitations/[id]/delivery", async function POST(_req: Request, ctx: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const { id } = await ctx.params;
  try {
    const result = await checkWorkspaceInvitationDelivery(session.tenantId, id);
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : result.code === "not_sent" || result.code === "superseded" ? 409 : result.code === "rate_limited" ? 429 : 503;
      return fail(status, result.error, { code: result.code });
    }
    return json({ ok: true, delivery: result.delivery, checkedAt: result.checkedAt, detail: result.detail });
  } catch {
    return fail(503, "Invitation delivery could not be checked. Try again.");
  }
});
