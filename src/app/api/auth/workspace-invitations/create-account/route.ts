import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { fail, json, readJson, sameOrigin, str, withServerErrors } from "@/lib/http";
import { consumeRateLimit, registerUserSession } from "@/lib/repo";
import { createInvitedAccount } from "@/lib/repo/workspaces";
import { loadAccountPrincipal } from "@/lib/repo/accounts";

function clientIp(h: Headers): string {
  return h.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "unknown";
}

export const POST = withServerErrors("auth/workspace-invitations/create-account", async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the survee app.");
  const body = await readJson<{ token?: unknown; password?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const token = str(body.data.token, 128);
  const password = typeof body.data.password === "string" ? body.data.password : "";
  if (!token || password.length < 8 || password.length > 200) return fail(400, "Use a password between 8 and 200 characters.");
  const h = await headers();
  const ipKey = `invite-signup-ip:${clientIp(h)}`;
  const tokenKey = `invite-signup-token:${createHash("sha256").update(token).digest("hex")}`;
  try {
    const [ipAllowed, tokenAllowed] = await Promise.all([consumeRateLimit(ipKey, 5), consumeRateLimit(tokenKey, 5)]);
    if (!ipAllowed || !tokenAllowed) return fail(429, "Too many attempts. Wait a few minutes and try again.");
  } catch {
    return fail(503, "Account creation is temporarily unavailable. Try again.");
  }
  try {
    const created = await createInvitedAccount(token, password);
    if (!created.ok && created.reason === "account_exists") return fail(409, "An account already uses this email. Sign in with that account to accept the invitation.");
    if (!created.ok) return fail(400, "This workspace invitation is invalid or has expired.");
    const principal = await loadAccountPrincipal(created.userId, created.tenantId);
    if (!principal) return fail(503, "The new workspace account could not be loaded. Sign in again.");
    const session = createSession(principal);
    if (!session) return fail(503, "Account sign-in is temporarily unavailable.");
    // Account and membership creation have committed; inventory is display metadata and must not make the one-time action appear to fail.
    await registerUserSession({ sid: session.sid, userId: principal.userId, tenantId: principal.tenantId, authVersion: principal.authVersion, exp: Math.floor(Date.now() / 1000) + session.maxAge }).catch(() => {});
    const response = json({ ok: true, tenantName: principal.tenantName });
    response.cookies.set(SESSION_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: session.maxAge });
    return response;
  } catch {
    return fail(503, "Account creation is temporarily unavailable. Try again.");
  }
});
