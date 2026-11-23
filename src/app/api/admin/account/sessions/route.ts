import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { adminSession, fail, guardAdmin, json, sameOrigin, withServerErrors } from "@/lib/http";
import { invalidateAccountSessions } from "@/lib/repo/accounts";
import { listUserSessions, registerUserSession } from "@/lib/repo";

export const GET = withServerErrors("admin/account/sessions", async function GET() {
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  try {
    await registerUserSession({ sid: session.sid, userId: session.userId, tenantId: session.tenantId, authVersion: session.authVersion, exp: session.exp });
    return json({ ok: true, sessions: await listUserSessions({ userId: session.userId, authVersion: session.authVersion, currentSid: session.sid }) });
  } catch {
    return fail(503, "Session information is temporarily unavailable.");
  }
});

export const POST = withServerErrors("admin/account/sessions/revoke-others", async function POST() {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  if (!(await sameOrigin())) return fail(403, "This request did not come from the survee app.");
  const current = await adminSession();
  if (!current) return fail(401, "Sign in to continue.");
  try {
    const authVersion = await invalidateAccountSessions(current.userId);
    if (authVersion === null) return fail(503, "Other sessions could not be signed out.");
    const next = createSession({ userId: current.userId, tenantId: current.tenantId, email: current.email, role: current.role, authVersion });
    if (!next) return fail(503, "Other sessions were signed out. Sign in again to continue.");
    await registerUserSession({ sid: next.sid, userId: current.userId, tenantId: current.tenantId, authVersion, exp: Math.floor(Date.now() / 1000) + next.maxAge }).catch(() => {});
    const response = json({ ok: true });
    response.cookies.set(SESSION_COOKIE, next.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: next.maxAge });
    return response;
  } catch {
    return fail(503, "Other sessions could not be signed out. Sign in again if this session stops working.");
  }
});
