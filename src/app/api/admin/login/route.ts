import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { fail, json, readJson, sameOrigin, str } from "@/lib/http";
import { clearLoginFailures, loginBlocked, recordLoginFailure } from "@/lib/repo";
import { authenticateAccount, bootstrapLegacyAxionOwner } from "@/lib/repo/accounts";
import { headers } from "next/headers";

/** The caller's address as the platform saw it. On Vercel the first two headers are set by the platform and cannot be forged. */
function clientIp(h: Headers): string {
  const platform = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip");
  if (platform) return platform.split(",")[0].trim();
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return chain.at(-1) ?? "unknown"; // the proxy nearest to us appended this one, so it is the least forgeable
}

const GENERIC_UNAVAILABLE = "Sign-in is unavailable right now. Try again in a moment.";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the survee app.");
  const body = await readJson<{ email?: unknown; password?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const email = str(body.data.email, 200) ?? "";
  const password = typeof body.data.password === "string" ? body.data.password.slice(0, 200) : "";

  const ipKey = `ip:${clientIp(await headers())}`;
  try {
    // A source-specific limit contains repeated guesses without letting failures from unrelated users lock out every account.
    if (await loginBlocked(ipKey, 8)) return fail(429, "Too many attempts. Wait a few minutes and try again.");
  } catch (e) {
    console.error("login throttle unavailable", (e as Error).message);
    return fail(503, GENERIC_UNAVAILABLE); // fail closed: with no way to count attempts, do not accept guesses
  }

  let principal = await authenticateAccount(email, password);
  if (!principal) principal = await bootstrapLegacyAxionOwner(email, password);
  if (!principal) {
    await recordLoginFailure(ipKey).catch(() => {});
    return fail(401, "That email and password do not match.");
  }
  const session = createSession(principal);
  if (!session) return fail(503, GENERIC_UNAVAILABLE);
  await clearLoginFailures(ipKey).catch(() => {});
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: session.maxAge });
  return res;
}
