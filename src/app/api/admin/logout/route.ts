import { SESSION_COOKIE, verifySession } from "@/lib/auth";
import { fail, json, sameOrigin, withServerErrors } from "@/lib/http";
import { revokeSession } from "@/lib/repo";
import { cookies } from "next/headers";

export const POST = withServerErrors("admin/logout", async function POST() {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the survee app.");
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  // Revoke the session id on the server, so a copy of the cookie stops working too.
  let revocationFailed = false;
  if (session) {
    try { await revokeSession(session.sid, session.exp); }
    catch { revocationFailed = true; }
  }
  const res = revocationFailed
    ? fail(503, "The session could not be revoked on the server. Try signing out again.", { code: "logout_unavailable" })
    : json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return res;
});
