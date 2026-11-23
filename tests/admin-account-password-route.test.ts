import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  body: { currentPassword: "current", newPassword: "new password long enough" } as Record<string, unknown>,
  allowed: true,
  throttleError: false,
  authVersion: 4 as number | null,
  consume: vi.fn(),
  clear: vi.fn(),
  change: vi.fn(),
}));

vi.mock("@/lib/http", async () => {
  const { NextResponse } = await import("next/server");
  return {
    guardAdmin: async () => null,
    sameOrigin: async () => true,
    adminSession: async () => ({ userId: "000000000000000000000001", tenantId: "tenant-1", authVersion: 3, role: "owner" }),
    readJson: async () => ({ ok: true, data: state.body }),
    fail: (status: number, error: string) => NextResponse.json({ ok: false, error }, { status }),
    json: (data: unknown, status = 200) => NextResponse.json(data, { status }),
    withServerErrors: (_name: string, handler: (...args: unknown[]) => unknown) => handler,
  };
});
vi.mock("@/lib/repo/accounts", () => ({ changeAccountPassword: state.change }));
vi.mock("@/lib/repo", () => ({ consumeRateLimit: state.consume, clearRateLimit: state.clear }));
vi.mock("@/lib/auth", () => ({ createSession: () => ({ value: "fresh-session", maxAge: 3600 }), SESSION_COOKIE: "kqa_admin" }));

import { POST } from "../src/app/api/admin/account/password/route";

beforeEach(() => {
  state.body = { currentPassword: "current", newPassword: "new password long enough" };
  state.allowed = true;
  state.throttleError = false;
  state.authVersion = 4;
  state.consume.mockReset().mockImplementation(async () => {
    if (state.throttleError) throw new Error("throttle store unavailable");
    return state.allowed;
  });
  state.clear.mockReset().mockResolvedValue(undefined);
  state.change.mockReset().mockImplementation(async () => state.authVersion);
});

const request = () => new Request("https://kqa.test/api/admin/account/password", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(state.body) });
const accountRateKey = `account-password:${createHash("sha256").update("000000000000000000000001").digest("hex")}`;

describe("authenticated password change throttling", () => {
  it("reserves an atomic per-account attempt before password verification and clears it on success", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(state.consume).toHaveBeenCalledWith(accountRateKey, 5, 15);
    expect(state.change).toHaveBeenCalledWith("000000000000000000000001", "current", "new password long enough");
    expect(state.clear).toHaveBeenCalledWith(accountRateKey);
  });

  it("rejects exhausted attempts before running the password KDF", async () => {
    state.allowed = false;
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(state.change).not.toHaveBeenCalled();
  });

  it("fails closed when the shared throttle store is unavailable", async () => {
    state.throttleError = true;
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(state.change).not.toHaveBeenCalled();
  });

  it("counts wrong-current-password attempts without clearing the bucket", async () => {
    state.authVersion = null;
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(state.consume).toHaveBeenCalledOnce();
    expect(state.clear).not.toHaveBeenCalled();
  });
});
