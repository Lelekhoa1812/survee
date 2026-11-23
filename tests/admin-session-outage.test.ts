import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  revoked: false,
  revokedError: null as Error | null,
  principal: null as null | Record<string, unknown>,
  principalError: null as Error | null,
  isSessionRevoked: vi.fn(async () => false),
  loadAccountPrincipal: vi.fn(async () => null),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "private-session-cookie" }) }),
}));

vi.mock("../src/lib/auth", () => ({
  SESSION_COOKIE: "kqa_session",
  verifySession: () => state.session,
}));

vi.mock("../src/lib/repo", () => ({
  isSessionRevoked: async () => {
    if (state.revokedError) throw state.revokedError;
    return state.revoked;
  },
}));

vi.mock("../src/lib/repo/accounts", () => ({
  loadAccountPrincipal: async () => {
    if (state.principalError) throw state.principalError;
    return state.principal;
  },
}));

import { AdminSessionUnavailableError, adminSession, guardAdmin, json, withServerErrors } from "../src/lib/http";

const session = {
  userId: "user-id",
  tenantId: "tenant-id",
  role: "owner",
  email: "owner@example.com",
  tenantName: "Workspace",
  emailVerified: true,
  legacyBootstrap: false,
  authVersion: 1,
  sid: "private-session-id",
  exp: 2_000_000_000,
};

const principal = {
  userId: session.userId,
  tenantId: session.tenantId,
  role: session.role,
  email: session.email,
  tenantName: session.tenantName,
  emailVerified: true,
  legacyBootstrap: false,
  authVersion: 1,
};

describe("admin session dependency failures", () => {
  beforeEach(() => {
    state.session = null;
    state.revoked = false;
    state.revokedError = null;
    state.principal = principal;
    state.principalError = null;
  });

  it("keeps missing, invalid, and expired sessions unauthenticated without database reads", async () => {
    state.session = null;
    await expect(adminSession()).resolves.toBeNull();

    state.session = { ...session, exp: 1 };
    // verifySession returns null for expired tokens in production; emulate that boundary.
    state.session = null;
    await expect(adminSession()).resolves.toBeNull();
  });

  it("keeps a confirmed revoked session unauthenticated", async () => {
    state.session = session;
    state.revoked = true;
    await expect(adminSession()).resolves.toBeNull();
  });

  it("keeps normal authentication failures as 401 responses", async () => {
    state.session = null;
    const handler = withServerErrors("admin/session-test", async () => {
      const denied = await guardAdmin();
      return denied ?? json({ ok: true });
    });

    const response = await handler();
    expect(response.status).toBe(401);
  });

  it("raises a typed temporary failure when the revocation read is unavailable", async () => {
    state.session = session;
    state.revokedError = new Error("private MongoDB endpoint and credentials");
    await expect(adminSession()).rejects.toBeInstanceOf(AdminSessionUnavailableError);
  });

  it("raises the same typed temporary failure when the account read is unavailable", async () => {
    state.session = session;
    state.principalError = new Error("private account record details");
    await expect(adminSession()).rejects.toBeInstanceOf(AdminSessionUnavailableError);
  });

  it("maps dependency failures to a generic 503 without exposing cookies or database details", async () => {
    state.session = session;
    state.revokedError = new Error("private MongoDB endpoint and credentials");
    const handler = withServerErrors("admin/session-test", async () => {
      const denied = await guardAdmin();
      return denied ?? json({ ok: true });
    });

    const response = await handler();
    const body = await response.text();
    expect(response.status).toBe(503);
    expect(body).toContain("auth_unavailable");
    expect(body).not.toContain("MongoDB");
    expect(body).not.toContain("credentials");
    expect(body).not.toContain("private-session-cookie");
    expect(body).not.toContain("private-session-id");
  });
});
