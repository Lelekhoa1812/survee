import { adminSession, fail, guardAdmin, json, withServerErrors } from "@/lib/http";
import { revokeWorkspaceInvitation } from "@/lib/repo/workspaces";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withServerErrors("admin/workspace-invitations/[id]", async function DELETE(_req: Request, ctx: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const { id } = await ctx.params;
  try {
    if (!(await revokeWorkspaceInvitation(session.tenantId, id))) return fail(404, "That pending invitation was not found.");
    return json({ ok: true });
  } catch {
    return fail(503, "The invitation could not be revoked. Try again.");
  }
});
