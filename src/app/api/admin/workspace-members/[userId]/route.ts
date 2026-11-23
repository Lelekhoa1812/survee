import { adminSession, fail, guardAdmin, json, readJson, withServerErrors } from "@/lib/http";
import { changeWorkspaceMemberRole, removeWorkspaceMember } from "@/lib/repo/workspaces";

type Ctx = { params: Promise<{ userId: string }> };

export const DELETE = withServerErrors("admin/workspace-members/[userId]", async function DELETE(_req: Request, ctx: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const { userId } = await ctx.params;
  try {
    const result = await removeWorkspaceMember({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      targetUserId: userId,
    });
    if (result.ok) return json({ ok: true });
    if (result.reason === "invalid") return fail(400, "Choose a valid workspace member.");
    if (result.reason === "not_found") return fail(404, "Workspace member not found.");
    if (result.reason === "last_owner") return fail(409, "The last workspace owner cannot be removed.");
    return fail(403, "Your workspace role does not allow removing this member.");
  } catch {
    return fail(503, "Workspace access could not be changed. Try again.");
  }
});

export const PATCH = withServerErrors("admin/workspace-members/[userId]", async function PATCH(req: Request, ctx: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const { userId } = await ctx.params;
  const body = await readJson<{ role?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  if (body.data.role !== "admin" && body.data.role !== "member") return fail(400, "Choose an admin or member role.");
  try {
    const result = await changeWorkspaceMemberRole({
      tenantId: session.tenantId,
      actorUserId: session.userId,
      targetUserId: userId,
      role: body.data.role,
    });
    if (result.ok) return json({ ok: true, previousRole: result.previousRole, role: result.role });
    if (result.reason === "invalid") return fail(400, "Choose a valid workspace member.");
    if (result.reason === "not_found") return fail(404, "Workspace member not found.");
    if (result.reason === "owner_transfer_required") return fail(409, "Transfer ownership through the separate owner handoff flow.");
    return fail(403, "Only the current owner of an active workspace can change member roles.");
  } catch {
    return fail(503, "Workspace access could not be changed. Try again.");
  }
});
