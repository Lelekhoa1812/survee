import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ SESSION_COOKIE: "s", verifySession: () => null }));
vi.mock("@/lib/repo", () => ({ isSessionRevoked: async () => false }));
vi.mock("@/lib/repo/accounts", () => ({ loadAccountPrincipal: async () => null }));

import { NextResponse } from "next/server";
import { withServerErrors } from "@/lib/http";

afterEach(() => vi.restoreAllMocks());

describe("withServerErrors", () => {
  it("returns the handler response unchanged when nothing throws", async () => {
    const route = withServerErrors("test", async () => new NextResponse("ok", { status: 201 }));
    const res = await route();
    expect(res.status).toBe(201);
  });

  it("turns an unexpected exception into a JSON 500 with a server_error code", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const route = withServerErrors("p/answers", async () => { throw new TypeError("secret-token-abc"); });
    const res = await route();
    expect(res.status).toBe(500);
    expect(res.headers.get("content-type")).toMatch(/application\/json/);
    const body = await res.json() as { ok: boolean; code: string; error: string };
    expect(body).toMatchObject({ ok: false, code: "server_error" });
    expect(body.error).toMatch(/try again/i);
  });

  it("rethrows Next control-flow errors so redirects and not-found still work", async () => {
    const redirectLike = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/admin;307;" });
    const route = withServerErrors("p/answers", async () => { throw redirectLike; });
    await expect(route()).rejects.toBe(redirectLike);
  });

  it("logs the route and error type, never the error message", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const route = withServerErrors("p/answers", async () => { throw new TypeError("secret-token-abc"); });
    await route();
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain("p/answers");
    expect(logged).toContain("TypeError");
    expect(logged).not.toContain("secret-token-abc");
  });
});
