import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ body: {} as Record<string, unknown> }));

vi.mock("@/lib/http", () => ({
  sameOrigin: async () => true,
  readJson: async () => ({ ok: true, data: state.body }),
  str: (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : undefined,
  fail: (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status }),
  json: (data: unknown, status = 200) => new Response(JSON.stringify(data), { status }),
}));
const smtpState = vi.hoisted(() => ({ available: true }));

vi.mock("@/lib/env", () => ({
  smtpSettings: () => smtpState.available ? ({ ok: true, user: "mailer@example.com" }) : ({ ok: false, error: "unavailable" }),
  publicBaseUrl: () => ({ ok: true, origin: "https://kqa.example.com" }),
}));
vi.mock("@/lib/mail/smtp", () => ({ newMessageId: vi.fn(() => "<reset@example.com>"), sendSmtp: vi.fn(async () => {}) }));
vi.mock("@/lib/repo/accounts", () => ({
  createPendingPasswordReset: vi.fn(),
  removePendingPasswordReset: vi.fn(),
  completePasswordReset: vi.fn(),
}));
vi.mock("@/lib/repo", () => ({ consumeRateLimit: vi.fn(async () => true) }));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-real-ip": "192.0.2.1" }) }));

import { POST as requestReset } from "../src/app/api/auth/password-reset/route";
import { POST as completeReset } from "../src/app/api/auth/password-reset/complete/route";
import { createPendingPasswordReset, removePendingPasswordReset, completePasswordReset } from "../src/lib/repo/accounts";
import { consumeRateLimit } from "../src/lib/repo";
import { sendSmtp } from "../src/lib/mail/smtp";

async function postReset(body: Record<string, unknown>) {
  state.body = body;
  return requestReset(new Request("https://kqa.example.com/api/auth/password-reset", { method: "POST" }));
}

async function postComplete(body: Record<string, unknown>) {
  state.body = body;
  return completeReset(new Request("https://kqa.example.com/api/auth/password-reset/complete", { method: "POST" }));
}

describe("password reset routes", () => {
  beforeEach(() => {
    state.body = {};
    smtpState.available = true;
    vi.clearAllMocks();
    vi.mocked(consumeRateLimit).mockResolvedValue(true);
    vi.mocked(sendSmtp).mockResolvedValue({ messageId: "<reset@example.com>" });
    vi.mocked(removePendingPasswordReset).mockResolvedValue(undefined);
  });

  it("emails a one-time reset link in the fragment and keeps the response generic", async () => {
    vi.mocked(createPendingPasswordReset).mockResolvedValue(new ObjectId());

    const response = await postReset({ email: "person@example.com" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      message: "If a verified survee account uses this address, check its inbox for a password reset link.",
    });
    const token = vi.mocked(createPendingPasswordReset).mock.calls[0][0].token;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(sendSmtp).toHaveBeenCalledWith(expect.objectContaining({
      to: "person@example.com",
      subject: "Reset your survee password",
      text: expect.stringContaining(`https://kqa.example.com/reset-password#token=${token}`),
      html: expect.stringContaining(`href="https://kqa.example.com/reset-password#token=${token}"`),
    }));
    expect(vi.mocked(sendSmtp).mock.calls[0][0].text).not.toContain("temporary sign-in password");
  });

  it("does not send mail when the address has no verified account", async () => {
    vi.mocked(createPendingPasswordReset).mockResolvedValue(null);

    const response = await postReset({ email: "unknown@example.com" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, message: expect.stringContaining("password reset link") });
    expect(sendSmtp).not.toHaveBeenCalled();
  });

  it("removes the pending token if SMTP delivery fails while preserving the generic response", async () => {
    const pendingId = new ObjectId();
    vi.mocked(createPendingPasswordReset).mockResolvedValue(pendingId);
    vi.mocked(sendSmtp).mockRejectedValue(new Error("SMTP unavailable"));

    const response = await postReset({ email: "person@example.com" });

    expect(response.status).toBe(200);
    expect(removePendingPasswordReset).toHaveBeenCalledWith(pendingId);
    await expect(response.json()).resolves.toMatchObject({ ok: true, message: expect.stringContaining("password reset link") });
  });

  it("rate limits reset completion attempts before checking the token", async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue(false);

    const response = await postComplete({ token: "guess", password: "long enough password" });

    expect(response.status).toBe(429);
    expect(consumeRateLimit).toHaveBeenCalledWith("password-reset-complete-ip:192.0.2.1", 15);
    expect(completePasswordReset).not.toHaveBeenCalled();
  });

  it("passes valid completion data to the one-time password update", async () => {
    vi.mocked(completePasswordReset).mockResolvedValue({ ok: true, email: "person@example.com" });

    const response = await postComplete({ token: "reset-token", password: "a sufficiently long new password" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(completePasswordReset).toHaveBeenCalledWith("reset-token", "a sufficiently long new password");
    expect(sendSmtp).toHaveBeenCalledWith(expect.objectContaining({
      to: "person@example.com",
      subject: "Your survee password was changed",
      text: expect.not.stringContaining("reset-token"),
    }));
  });

  it("does not report failure when the password-change notification cannot be delivered", async () => {
    vi.mocked(completePasswordReset).mockResolvedValue({ ok: true, email: "person@example.com" });
    vi.mocked(sendSmtp).mockRejectedValue(new Error("SMTP unavailable"));

    const response = await postComplete({ token: "reset-token", password: "a sufficiently long new password" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("completes the password reset when SMTP notification settings are unavailable", async () => {
    smtpState.available = false;
    vi.mocked(completePasswordReset).mockResolvedValue({ ok: true, email: "person@example.com" });

    const response = await postComplete({ token: "reset-token", password: "a sufficiently long new password" });

    expect(response.status).toBe(200);
    expect(sendSmtp).not.toHaveBeenCalled();
  });
});
