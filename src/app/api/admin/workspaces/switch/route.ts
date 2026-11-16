import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { adminSession, fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { loadAccountPrincipal } from "@/lib/repo/accounts";
import { rememberWorkspace } from "@/lib/repo/workspaces";

export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const current = await adminSession();
  if (!current) return fail(401, "Sign in to continue.");
  const body = await readJson<{ tenantId?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const tenantId = str(body.data.tenantId, 80);
  if (!tenantId) return fail(400, "Choose a workspace.");
  try {
    const principal = await loadAccountPrincipal(current.userId, tenantId);
    if (!principal) return fail(404, "That workspace is not available to this account.");
    const session = createSession(principal);
    if (!session) return fail(503, "Workspace switching is temporarily unavailable.");
    if (!(await rememberWorkspace(current.userId, tenantId))) return fail(404, "That workspace is not available to this account.");
    const response = json({ ok: true, tenantId, tenantName: principal.tenantName });
    response.cookies.set(SESSION_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: session.maxAge });
    return response;
  } catch {
    return fail(503, "Workspace switching is temporarily unavailable.");
  }
}
