import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ sent: null as Record<string, unknown> | null, closed: false }));

vi.mock("nodemailer", () => ({
  default: {
    createTransport: () => ({
      sendMail: async (message: Record<string, unknown>) => {
        state.sent = message;
        return { messageId: "<accepted@example.com>" };
      },
      close: () => { state.closed = true; },
    }),
  },
}));

vi.mock("../src/lib/env", () => ({
  smtpSettings: () => ({ ok: true, host: "smtp.example.com", port: 587, user: "host@example.com", password: "secret" }),
}));

import { sendSmtp } from "../src/lib/mail/smtp";

describe("SMTP delivery status notification envelope", () => {
  beforeEach(() => {
    state.sent = null;
    state.closed = false;
  });

  it("requests DSNs correlated to the sent message and its actual recipient", async () => {
    await sendSmtp({
      to: "respondent@example.net",
      subject: "Interview invitation",
      text: "Please respond.",
      html: "<p>Please respond.</p>",
      messageId: "<tracked@example.com>",
    });

    expect(state.sent?.dsn).toEqual({
      id: "<tracked@example.com>",
      return: "headers",
      notify: ["failure", "success", "delay"],
      recipient: "respondent@example.net",
    });
    expect(state.closed).toBe(true);
  });
});
