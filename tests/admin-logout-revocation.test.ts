import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ revoke: vi.fn(), sameOrigin: vi.fn(), session: { sid: "copied-session", exp: 1234 } }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => ({ value: "signed-cookie" }) }) }));
vi.mock("@/lib/auth", () => ({ SESSION_COOKIE: "kqa_session", verifySession: () => mocks.session }));
vi.mock("@/lib/http", async () => {
  const actual = await vi.importActual<typeof import("@/lib/http")>("@/lib/http");
  return { ...actual, sameOrigin: mocks.sameOrigin };
});
vi.mock("@/lib/repo", () => ({ revokeSession: mocks.revoke }));
import { POST } from "../src/app/api/admin/logout/route";

beforeEach(() => { mocks.revoke.mockReset(); mocks.sameOrigin.mockReset().mockResolvedValue(true); });

describe("admin logout revocation", () => {
  it("reports revocation outages while still clearing the local session cookie", async () => {
    mocks.revoke.mockRejectedValue(new Error("database unavailable"));

    const response = await POST();
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, code: "logout_unavailable" });
    expect(response.headers.get("set-cookie")).toContain("kqa_session=");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
