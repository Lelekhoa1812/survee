import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

const state = vi.hoisted(() => ({ body: {} as Record<string, unknown>, headerValues: {} as Record<string, string> }));

vi.mock("@/lib/http", () => ({
  withServerErrors: (_route: string, handler: (...args: unknown[]) => Promise<Response>) => handler,
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
vi.mock("next/headers", () => ({ headers: async () => new Headers(state.headerValues) }));

import { POST } from "../src/app/api/auth/signup/route";
import { createPendingSignup, removePendingSignup } from "../src/lib/repo/accounts";
import { consumeRateLimit } from "../src/lib/repo";
import { sendSmtp } from "../src/lib/mail/smtp";

async function post(body: Record<string, unknown>) {
  state.body = body;
  return POST(new Request("https://kqa.example.com/api/auth/signup", { method: "POST" }));
}

describe("signup validation fields", () => {
  beforeEach(() => {
    state.body = {};
    state.headerValues = { "x-vercel-forwarded-for": "192.0.2.1" };
    vi.clearAllMocks();
    vi.mocked(sendSmtp).mockResolvedValue({ messageId: "<test@example.com>" });
    vi.mocked(removePendingSignup).mockResolvedValue(undefined);
  });

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
    const response = await post({ tenantName: "Research", email: "person@example.com", password: "1234567" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ field: "password", error: "Use a password between 8 and 200 characters." });
  });

  it("starts workspace signup without an invitation and sends a generic verification response", async () => {
    vi.mocked(createPendingSignup).mockResolvedValue({ ok: true, id: new ObjectId() });

    const response = await post({ tenantName: "Research", email: "person@example.com", password: "12345678" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      message: "If this address is eligible for a survee workspace, check its inbox for next steps.",
    });
    expect(createPendingSignup).toHaveBeenCalledWith({
      tenantName: "Research",
      email: "person@example.com",
      password: "12345678",
      token: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(sendSmtp).toHaveBeenCalledWith(expect.objectContaining({
      to: "person@example.com",
      subject: "Verify your survee account",
    }));
  });

  it("keeps existing-address signup responses generic and sends account recovery steps to that inbox", async () => {
    vi.mocked(createPendingSignup).mockResolvedValue({ ok: false, reason: "account_exists" });

    const response = await post({ tenantName: "Research", email: "person@example.com", password: "a sufficiently long password" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: "If this address is eligible for a survee workspace, check its inbox for next steps.",
    });
    expect(sendSmtp).toHaveBeenCalledWith(expect.objectContaining({
      to: "person@example.com",
      subject: "A survee account sign-in was requested",
      text: expect.stringContaining("reset your password"),
    }));
    expect(sendSmtp).not.toHaveBeenCalledWith(expect.objectContaining({ subject: "Verify your survee account" }));
    expect(removePendingSignup).not.toHaveBeenCalled();
  });

  it("keeps an active signup claim generic without sending duplicate mail", async () => {
    vi.mocked(createPendingSignup).mockResolvedValue({ ok: false, reason: "signup_pending" });

    const response = await post({ tenantName: "Research", email: "person@example.com", password: "a sufficiently long password" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      message: "If this address is eligible for a survee workspace, check its inbox for next steps.",
    });
    expect(sendSmtp).not.toHaveBeenCalled();
    expect(removePendingSignup).not.toHaveBeenCalled();
  });

  it("removes a pending signup if sending its verification message fails", async () => {
    const pendingId = new ObjectId();
    vi.mocked(createPendingSignup).mockResolvedValue({ ok: true, id: pendingId });
    vi.mocked(sendSmtp).mockRejectedValue(new Error("mail unavailable"));

    const response = await post({ tenantName: "Research", email: "person@example.com", password: "a sufficiently long password" });

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, error: "We could not send the survee message. Try again later." });
    expect(removePendingSignup).toHaveBeenCalledWith(pendingId);
  });

  it("uses only the Vercel client IP for signup throttling", async () => {
    vi.mocked(createPendingSignup).mockResolvedValue({ ok: true, id: new ObjectId() });
    state.headerValues = {
      "x-vercel-forwarded-for": "198.51.100.24, 10.0.0.1",
      "x-forwarded-for": "203.0.113.90, 10.0.0.1",
      "x-real-ip": "203.0.113.91",
    };

    await post({ tenantName: "Research", email: "person@example.com", password: "a sufficiently long password" });

    expect(consumeRateLimit).toHaveBeenCalledWith("signup-ip:198.51.100.24", 5);
  });

  it("does not trust forwarded headers when the Vercel IP header is absent", async () => {
    vi.mocked(createPendingSignup).mockResolvedValue({ ok: true, id: new ObjectId() });
    state.headerValues = {
      "x-forwarded-for": "203.0.113.90",
      "x-real-ip": "203.0.113.91",
    };

    await post({ tenantName: "Research", email: "person@example.com", password: "a sufficiently long password" });

    expect(consumeRateLimit).toHaveBeenCalledWith("signup-ip:unknown", 5);
  });
});
