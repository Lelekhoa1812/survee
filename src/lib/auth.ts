import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { adminConfig } from "./env";

export const SESSION_COOKIE = "kqa_admin";
export const SESSION_HOURS = 12;

function sign(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) {
    // Still do a comparison so timing does not reveal the length.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function checkCredentials(email: string, password: string): { ok: true } | { ok: false; reason: "invalid" | "unconfigured"; message: string } {
  const cfg = adminConfig();
  if ("error" in cfg) return { ok: false, reason: "unconfigured", message: cfg.error };
  const okEmail = safeEqual(email.trim().toLowerCase(), cfg.email.toLowerCase());
  const okPass = safeEqual(password, cfg.password);
  return okEmail && okPass ? { ok: true } : { ok: false, reason: "invalid", message: "That email and password do not match." };
}

export function createSession(email: string): { value: string; maxAge: number; sid: string } | null {
  const cfg = adminConfig();
  if ("error" in cfg) return null;
  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const sid = randomBytes(12).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ e: email.toLowerCase(), x: exp, s: sid })).toString("base64url");
  return { value: `${payload}.${sign(payload, cfg.secret)}`, maxAge: SESSION_HOURS * 3600, sid };
}

export function verifySession(value: string | undefined): { email: string; sid: string; exp: number } | null {
  if (!value) return null;
  const cfg = adminConfig();
  if ("error" in cfg) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload, cfg.secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { e: string; x: number; s?: string };
    if (typeof data.x !== "number" || data.x < Math.floor(Date.now() / 1000) || typeof data.s !== "string") return null;
    return { email: data.e, sid: data.s, exp: data.x };
  } catch {
    return null;
  }
}
