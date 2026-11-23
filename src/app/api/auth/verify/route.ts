import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { fail, json, readJson, sameOrigin, str, withServerErrors } from "@/lib/http";
import { completeSignup } from "@/lib/repo/accounts";
import { registerUserSession } from "@/lib/repo";

export const POST = withServerErrors("auth/verify", async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the survee app.");
  const body = await readJson<{ token?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const token = str(body.data.token, 128);
  if (!token) return fail(400, "That verification link is invalid or has expired.");
  try {
    const result = await completeSignup(token);
    if (!result.ok) return fail(400, result.error);
    const session = createSession(result.principal);
    if (!session) return fail(503, "Account sign-in is temporarily unavailable.");
    // Signup verification is already consumed; the signed cookie remains valid even if inventory metadata is unavailable.
    await registerUserSession({ sid: session.sid, userId: result.principal.userId, tenantId: result.principal.tenantId, authVersion: result.principal.authVersion, exp: Math.floor(Date.now() / 1000) + session.maxAge }).catch(() => {});
    const res = json({ ok: true });
    res.cookies.set(SESSION_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: session.maxAge });
    return res;
  } catch {
    return fail(503, "Account verification is temporarily unavailable. Try again.");
  }
});
