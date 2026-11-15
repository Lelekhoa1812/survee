import { fail, guardAdmin, json, readJson, sameOrigin } from "@/lib/http";
import { adminSession } from "@/lib/http";
import { changeAccountPassword } from "@/lib/repo/accounts";
import { createSession, SESSION_COOKIE } from "@/lib/auth";

export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  if (!(await sameOrigin())) return fail(403, "This request did not come from the KQA app.");
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const body = await readJson<{ currentPassword?: unknown; newPassword?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const currentPassword = typeof body.data.currentPassword === "string" ? body.data.currentPassword : "";
  const newPassword = typeof body.data.newPassword === "string" ? body.data.newPassword : "";
  if (newPassword.length < 12 || newPassword.length > 200) return fail(400, "Use a password between 12 and 200 characters.");
  try {
    const authVersion = await changeAccountPassword(session.userId, currentPassword, newPassword);
    if (authVersion === null) return fail(401, "The current password is incorrect.");
    const nextSession = createSession({ ...session, authVersion });
    if (!nextSession) return fail(503, "The password was updated. Sign in again to continue.");
    const res = json({ ok: true });
    res.cookies.set(SESSION_COOKIE, nextSession.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: nextSession.maxAge });
    return res;
  } catch {
    return fail(503, "The password could not be changed. Try again.");
  }
}
