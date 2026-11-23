import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { adminSession, fail, guardAdmin, json, readJson, str, withServerErrors } from "@/lib/http";
import { loadAccountPrincipal } from "@/lib/repo/accounts";
import { acceptWorkspaceInvitation } from "@/lib/repo/workspaces";
import { registerUserSession } from "@/lib/repo";

export const POST = withServerErrors("auth/workspace-invitations/accept", async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const current = await adminSession();
  if (!current) return fail(401, "Sign in to continue.");
  const body = await readJson<{ token?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const token = str(body.data.token, 128);
  if (!token) return fail(400, "This workspace invitation is invalid or has expired.");
  try {
    const accepted = await acceptWorkspaceInvitation(token, current.userId, current.email);
    if (!accepted.ok && accepted.reason === "email_mismatch") return fail(403, "Sign in with the email address that received this invitation.");
    if (!accepted.ok && accepted.reason === "account_required") return fail(403, "Verify or create the invited survee account before accepting this invitation.");
    if (!accepted.ok) return fail(400, "This workspace invitation is invalid or has expired.");
    const principal = await loadAccountPrincipal(current.userId, accepted.tenantId);
    if (!principal) return fail(503, "The workspace membership could not be loaded. Sign in again.");
    const session = createSession(principal);
    if (!session) return fail(503, "Workspace sign-in is temporarily unavailable.");
    // Membership acceptance has committed; inventory is display metadata and must not make the one-time action appear to fail.
    await registerUserSession({ sid: session.sid, userId: principal.userId, tenantId: principal.tenantId, authVersion: principal.authVersion, exp: Math.floor(Date.now() / 1000) + session.maxAge }).catch(() => {});
    const response = json({ ok: true, tenantName: principal.tenantName });
    response.cookies.set(SESSION_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: session.maxAge });
    return response;
  } catch {
    return fail(503, "The invitation could not be accepted. Try again.");
  }
});
