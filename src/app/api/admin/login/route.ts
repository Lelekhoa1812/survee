import { checkCredentials, createSession, SESSION_COOKIE } from "@/lib/auth";
import { fail, json, readJson, sameOrigin, str } from "@/lib/http";
import { clearLoginFailures, loginBlocked, recordLoginFailure } from "@/lib/repo";
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
  if (!(await sameOrigin())) return fail(403, "This request did not come from the KQA app.");
  const body = await readJson<{ email?: unknown; password?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const email = str(body.data.email, 200) ?? "";
  const password = typeof body.data.password === "string" ? body.data.password.slice(0, 200) : "";

  const ipKey = `ip:${clientIp(await headers())}`;
  const ALL = "all";
  try {
    // Two limits: a tight one per address, and a wide backstop for the whole app. The wide one is deliberately high so a
    // stranger cannot lock the host out by failing 40 times, yet it still bounds a guessing run that rotates addresses.
    if ((await loginBlocked(ipKey, 8)) || (await loginBlocked(ALL, 200))) return fail(429, "Too many attempts. Wait a few minutes and try again.");
  } catch (e) {
    console.error("login throttle unavailable", (e as Error).message);
    return fail(503, GENERIC_UNAVAILABLE); // fail closed: with no way to count attempts, do not accept guesses
  }

  const result = checkCredentials(email, password);
  if (!result.ok) {
    if (result.reason === "invalid") {
      await Promise.all([recordLoginFailure(ipKey), recordLoginFailure(ALL)]).catch(() => {});
      return fail(401, result.message);
    }
    console.error("login unavailable:", result.message);
    return fail(503, GENERIC_UNAVAILABLE);
  }
  const session = createSession(email);
  if (!session) return fail(503, GENERIC_UNAVAILABLE);
  await clearLoginFailures(ipKey).catch(() => {});
  const res = json({ ok: true });
  res.cookies.set(SESSION_COOKIE, session.value, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: session.maxAge });
  return res;
}
