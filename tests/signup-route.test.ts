import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ body: {} as Record<string, unknown> }));

vi.mock("@/lib/http", () => ({
  sameOrigin: async () => true,
  readJson: async () => ({ ok: true, data: state.body }),
  str: (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
  fail: (status: number, error: string, extra: Record<string, unknown> = {}) => new Response(JSON.stringify({ ok: false, error, ...extra }), { status }),
  json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
}));
vi.mock("@/lib/env", () => ({
  smtpSettings: () => ({ ok: true, user: "mailer@example.com" }),
  publicBaseUrl: () => ({ ok: true, origin: "https://kqa.example.com" }),
}));
vi.mock("@/lib/mail/smtp", () => ({ newMessageId: vi.fn(), sendSmtp: vi.fn() }));
vi.mock("@/lib/repo/accounts", () => ({ createPendingSignup: vi.fn(), removePendingSignup: vi.fn() }));
vi.mock("@/lib/repo", () => ({ consumeRateLimit: vi.fn(async () => true) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "192.0.2.1" }) }));

import { POST } from "../src/app/api/auth/signup/route";

async function post(body: Record<string, unknown>) {
  state.body = body;
  return POST(new Request("https://kqa.example.com/api/auth/signup", { method: "POST" }));
}

describe("signup validation fields", () => {
  beforeEach(() => { state.body = {}; });

  it("identifies a missing workspace name as a field error", async () => {
    const response = await post({ tenantName: "   ", email: "person@example.com", password: "long enough password" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: "tenantName", error: "Enter a workspace name." });
  });

  it("identifies malformed and undeliverable addresses as email field errors", async () => {
    const malformed = await post({ tenantName: "Research", email: "not-an-email", password: "long enough password" });
    await expect(malformed.json()).resolves.toMatchObject({ field: "email", error: "Enter a valid email address." });

    const local = await post({ tenantName: "Research", email: "person@example.local", password: "long enough password" });
    await expect(local.json()).resolves.toMatchObject({ field: "email", error: "Use an email address that can receive the verification message." });
  });

  it("identifies invalid password length as a password field error", async () => {
    const response = await post({ tenantName: "Research", email: "person@example.com", password: "short" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: "password", error: "Use a password between 12 and 200 characters." });
  });
});
