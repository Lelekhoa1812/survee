import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  result: { ok: true, email: "new@example.test", previousEmail: "old@example.test" } as any,
  smtpOk: true,
  sendFails: false,
  sent: [] as any[],
}));

vi.mock("@/lib/env", () => ({ smtpSettings: () => state.smtpOk ? { ok: true, user: "mail@example.test" } : { ok: false } }));
vi.mock("@/lib/http", () => ({
  fail: (status: number, error: string) => Response.json({ error }, { status }),
  json: (body: unknown) => Response.json(body),
  readJson: async (request: Request) => ({ ok: true, data: await request.json() }),
  sameOrigin: async () => true,
  str: (value: unknown, limit: number) => typeof value === "string" ? value.slice(0, limit) : "",
  withServerErrors: (_name: string, handler: unknown) => handler,
}));
vi.mock("@/lib/mail/smtp", () => ({
  newMessageId: () => "<notice@example.test>",
  sendSmtp: async (message: unknown) => {
    state.sent.push(message);
    if (state.sendFails) throw new Error("smtp unavailable");
    return { messageId: "<notice@example.test>" };
  },
}));
vi.mock("@/lib/repo/accounts", () => ({ completeEmailChange: async () => state.result }));

import { POST } from "../src/app/api/auth/verify-email/route";

function request() {
  return POST(new Request("https://kqa.example.test/api/auth/verify-email", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: "email-change-token" }),
  }));
}

describe("verified email change notification", () => {
  beforeEach(() => {
    state.result = { ok: true, email: "new@example.test", previousEmail: "old@example.test" };
    state.smtpOk = true;
    state.sendFails = false;
    state.sent.splice(0);
  });

  it("notifies the previous address after the change completes", async () => {
    const response = await request();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, email: "new@example.test" });
    expect(state.sent).toHaveLength(1);
    expect(state.sent[0]).toMatchObject({ to: "old@example.test", subject: "Your survee account email was changed" });
    expect(state.sent[0].text).not.toContain("email-change-token");
  });

  it("keeps the completed change successful when notice delivery fails", async () => {
    state.sendFails = true;

    const response = await request();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, email: "new@example.test" });
  });

  it("skips notification when delivery settings are unavailable", async () => {
    state.smtpOk = false;

    const response = await request();

    expect(response.status).toBe(200);
    expect(state.sent).toHaveLength(0);
  });
});
