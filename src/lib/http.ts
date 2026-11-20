import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { SESSION_COOKIE, verifySession } from "./auth";
import { LIMITS } from "./format/schema";
import { isSessionRevoked } from "./repo";
import { loadAccountPrincipal } from "./repo/accounts";
import type { TenantRole } from "./repo/types";

export function json(data: unknown, status = 200, extra?: Record<string, string>): NextResponse {
  return NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", ...extra } });
}

export function fail(status: number, error: string, extra: Record<string, unknown> = {}): NextResponse {
  return json({ ok: false, error, ...extra }, status);
}

/**
 * Wraps a route so an unexpected exception returns a JSON 500 instead of an empty body.
 * The log line names the route and the error type only; request bodies and tokens are never logged.
 */
export function withServerErrors<A extends unknown[]>(route: string, handler: (...args: A) => Promise<NextResponse>): (...args: A) => Promise<NextResponse> {
  return async (...args: A) => {
    try {
      return await handler(...args);
    } catch (err) {
      // Next uses thrown control-flow errors (redirect, notFound) that must reach the framework unchanged.
      if (typeof err === "object" && err !== null && "digest" in err && String((err as { digest: unknown }).digest).startsWith("NEXT_")) throw err;
      console.error(`[${route}] unexpected error`, err instanceof Error ? err.name : "unknown");
      return fail(500, "We could not complete this just now. Try again in a moment.", { code: "server_error" });
    }
  };
}

/** A valid, unexpired, not signed-out host session, or null. If the revocation list cannot be read the answer is null. */
export async function adminSession(): Promise<{ userId: string; tenantId: string; role: "owner" | "admin" | "member"; email: string; tenantName: string; emailVerified: boolean; legacyBootstrap: boolean; authVersion: number; sid: string; exp: number } | null> {
  const jar = await cookies();
  const session = verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  try {
    if (await isSessionRevoked(session.sid)) return null;
    const principal = await loadAccountPrincipal(session.userId, session.tenantId);
    if (!principal || session.authVersion !== principal.authVersion) return null;
    return {
      ...session,
      userId: principal.userId,
      tenantId: principal.tenantId,
      email: principal.email,
      role: principal.role,
      tenantName: principal.tenantName,
      emailVerified: principal.emailVerified,
      legacyBootstrap: principal.legacyBootstrap,
    };
  } catch {
    return null;
  }
}

/** Mutating requests must come from this app's own pages. Blocks cross-site form posts and fetches. */
export async function sameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  const host = h.get("x-forwarded-host") ?? h.get("host");
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/** Returns a response to send back when the caller may not continue, or null when they may. */
export async function guardAdmin(opts: { mutating?: boolean; roles?: readonly TenantRole[] } = {}): Promise<NextResponse | null> {
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  if (opts.roles && !opts.roles.includes(session.role)) return fail(403, "Your workspace role does not allow this action.");
  if (opts.mutating && !(await sameOrigin())) return fail(403, "This request did not come from the survee app.");
  return null;
}

/** Read a JSON body with a size cap, so a huge payload cannot exhaust memory. */
export async function readJson<T = Record<string, unknown>>(req: Request, maxBytes = LIMITS.maxFileBytes + 64 * 1024): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > maxBytes) return { ok: false, res: fail(413, "That request is too large.", { code: "payload_too_large" }) };
  try {
    // Count bytes as they arrive, so a body with no declared length cannot be buffered past the limit.
    const reader = req.body?.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel().catch(() => {});
          return { ok: false, res: fail(413, "That request is too large.", { code: "payload_too_large" }) };
        }
        chunks.push(value);
      }
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const data = JSON.parse(text) as T;
    if (data === null || typeof data !== "object") return { ok: false, res: fail(400, "Send a JSON object.", { code: "invalid_args" }) };
    return { ok: true, data };
  } catch {
    return { ok: false, res: fail(400, "That request was not valid JSON.", { code: "invalid_args" }) };
  }
}

export const str = (v: unknown, max: number): string | undefined => (typeof v === "string" ? v.trim().slice(0, max) : undefined);
