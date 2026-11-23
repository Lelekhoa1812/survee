import { adminSession, fail, guardAdmin, json, readJson, withServerErrors } from "@/lib/http";
import { transferWorkspaceOwnership } from "@/lib/repo/workspaces";

export const POST = withServerErrors("admin/workspaces/transfer-ownership", async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const body = await readJson<{ targetUserId?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const targetUserId = typeof body.data.targetUserId === "string" ? body.data.targetUserId.trim() : "";
  if (targetUserId.length !== 24 || !/^[0-9a-f]{24}$/i.test(targetUserId)) return fail(400, "Choose a valid workspace member.");

  try {
    const result = await transferWorkspaceOwnership({ tenantId: session.tenantId, actorUserId: session.userId, targetUserId });
    if (result.ok) return json({ ok: true });
    if (result.reason === "invalid") return fail(400, "Choose a different workspace member.");
    if (result.reason === "not_found") return fail(404, "Workspace member not found.");
    return fail(403, "Only the current owner of an active workspace can transfer ownership.");
  } catch {
    return fail(503, "Workspace ownership could not be changed. Try again.");
  }
});
