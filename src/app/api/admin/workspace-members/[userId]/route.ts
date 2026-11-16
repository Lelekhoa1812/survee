import { adminSession, fail, guardAdmin, json } from "@/lib/http";
import { removeWorkspaceMember } from "@/lib/repo/workspaces";

type Ctx = { params: Promise<{ userId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
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
}
