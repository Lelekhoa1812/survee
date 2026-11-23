import { NextResponse, type NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { SESSION_COOKIE, verifySession } from "./lib/auth";

/**
 * Keeps the host area private. Pages redirect to the sign-in screen; APIs answer 401.
 * Every admin route handler checks the session again, so this is a convenience layer, not the only lock.
 * `/api/mcp` is outside this matcher on purpose. It authenticates with a bearer token, not this cookie.
 */
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const open = pathname === "/admin/login" || pathname === "/api/admin/login";
  if (open) return NextResponse.next();
  const ok = !!verifySession(req.cookies.get(SESSION_COOKIE)?.value);
  if (ok) return NextResponse.next();
  if (pathname.startsWith("/api/")) {
    const requestId = randomUUID();
    return NextResponse.json({ ok: false, error: "Sign in to continue.", requestId }, { status: 401, headers: { "x-request-id": requestId } });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/admin/login";
  url.search = pathname === "/admin" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(url);
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
