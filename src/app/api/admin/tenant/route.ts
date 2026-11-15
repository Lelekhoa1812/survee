import { fail, guardAdmin, json, readJson } from "@/lib/http";
import { adminSession } from "@/lib/http";
import { updateTenantName } from "@/lib/repo/accounts";

export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  if (session.role !== "owner") return fail(403, "Only the workspace owner can rename this workspace.");

  const body = await readJson<{ name?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  if (typeof body.data.name !== "string") return fail(400, "Enter a workspace name.");
  const name = body.data.name.trim();
  if (!name || name.length > 100 || /[\u0000-\u001f\u007f]/.test(name)) {
    return fail(400, "Use a workspace name between 1 and 100 characters without control characters.");
  }

  try {
    if (!(await updateTenantName(session.tenantId, name))) return fail(404, "Workspace not found.");
    return json({ ok: true, tenantName: name });
  } catch {
    return fail(503, "The workspace name could not be updated. Try again.");
  }
}
