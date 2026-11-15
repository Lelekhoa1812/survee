import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { adminConfig, sessionSecret } from "./env";
import type { TenantRole } from "./repo/types";

export const SESSION_COOKIE = "kqa_admin";
export const SESSION_HOURS = 12;

export interface SessionPrincipal {
  userId: string;
  tenantId: string;
  email: string;
  role: TenantRole;
  authVersion: number;
}

export interface VerifiedSession extends SessionPrincipal {
  sid: string;
  exp: number;
}

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

export function createSession(principal: SessionPrincipal): { value: string; maxAge: number; sid: string } | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const exp = Math.floor(Date.now() / 1000) + SESSION_HOURS * 3600;
  const sid = randomBytes(12).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ u: principal.userId, t: principal.tenantId, e: principal.email.toLowerCase(), r: principal.role, v: principal.authVersion, x: exp, s: sid })).toString("base64url");
  return { value: `${payload}.${sign(payload, secret)}`, maxAge: SESSION_HOURS * 3600, sid };
}

export function verifySession(value: string | undefined): VerifiedSession | null {
  if (!value) return null;
  const secret = sessionSecret();
  if (!secret) return null;
  const [payload, sig] = value.split(".");
  if (!payload || !sig || !safeEqual(sig, sign(payload, secret))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: string; t?: string; e?: string; r?: string; v?: number; x?: number; s?: string };
    if (typeof data.x !== "number" || data.x < Math.floor(Date.now() / 1000) || typeof data.s !== "string") return null;
    if (typeof data.u !== "string" || !/^[0-9a-f]{24}$/i.test(data.u) || typeof data.t !== "string" || !data.t || typeof data.e !== "string") return null;
    if (data.r !== "owner" && data.r !== "admin" && data.r !== "member") return null;
    if (typeof data.v !== "number" || !Number.isInteger(data.v) || data.v < 0) return null;
    return { userId: data.u, tenantId: data.t, email: data.e, role: data.r, authVersion: data.v, sid: data.s, exp: data.x };
  } catch {
    return null;
  }
}
