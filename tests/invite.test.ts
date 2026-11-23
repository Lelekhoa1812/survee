import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";
import { classifyDeliverySource, deliverySearchQuery } from "../src/lib/mail/dsn";
import { sendInvite, type InviteContext, type SendInviteDeps } from "../src/lib/mail/invite";
import type { OutboundMail } from "../src/lib/mail/smtp";
import { publicSmtpFailure } from "../src/lib/mail/smtp";

process.env.MONGODB_URI = "mongodb://127.0.0.1:9/kqa-tests-do-not-use";

const interviewId = new ObjectId().toHexString();
const personId = new ObjectId().toHexString();
const TOKEN = "respondent-token-value";
const SECRET = "test-only-secret";

function ctx(overrides: Partial<InviteContext["person"]> & { status?: "open" | "closed"; rows?: InviteContext["rows"] } = {}): InviteContext {
  return {
    person: { id: personId, interviewId, name: overrides.name ?? "Ada Lovelace", email: overrides.email, token: overrides.token ?? TOKEN, status: "invited" },
    interview: { id: interviewId, name: "Investor interview", status: overrides.status ?? "open" },
    rows: overrides.rows ?? [],
  };
}

function harness(context: InviteContext | null, extra: Partial<SendInviteDeps> = {}) {
  const send = vi.fn(async (message: OutboundMail) => ({ messageId: "<sent-id@example.com>" }));
  const rateLimit = vi.fn(async () => true);
  const recorded: unknown[] = [];
  const deps: SendInviteDeps = {
    load: async () => context,
    send,
    record: async (row) => { recorded.push(row); },
    linkFor: () => ({ ok: true, link: `https://kqa.example/${TOKEN}` }),
    smtpReady: () => ({ ok: true, from: "host@example.com" }),
    rateLimit,
    ...extra,
  };
  return { send, rateLimit, recorded, deps };
}

describe("sendInvite", () => {
  it("refuses when there is no email and does not write a mail row", async () => {
    const { send, recorded, deps } = harness(ctx());
    const result = await sendInvite({ personId, triggeredBy: "admin" }, deps);
    expect(result).toMatchObject({ ok: false, code: "no_email" });
    expect(send).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });

  it("refuses a closed interview without a mail row", async () => {
    const { send, recorded, deps } = harness(ctx({ email: "ada@example.com", status: "closed" }));
    const result = await sendInvite({ personId, triggeredBy: "mcp" }, deps);
    expect(result).toMatchObject({ ok: false, code: "closed" });
    expect(send).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });

  it("refuses when the public url is unset", async () => {
    const { send, recorded, deps } = harness(ctx({ email: "ada@example.com" }), { linkFor: () => ({ ok: false, error: "Set KQA_PUBLIC_URL to the public address of this app before sending an invite." }) });
    const result = await sendInvite({ personId, triggeredBy: "admin" }, deps);
    expect(result).toMatchObject({ ok: false, code: "no_public_url" });
    expect(send).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });

  it("sends one message with the name, title, and public link", async () => {
    const { send, recorded, deps } = harness(ctx({ email: "Ada <Ada@Example.com>" }));
    const result = await sendInvite({ personId, triggeredBy: "admin" }, deps);
    expect(result).toMatchObject({ ok: true, result: "sent" });
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0][0];
    expect(message.subject).toContain("Ada Lovelace");
    expect(message.subject).toContain("Investor interview");
    expect(message.text).toContain("https://kqa.example/" + TOKEN);
    expect(message.html).toContain("https://kqa.example/" + TOKEN);
    expect(message.text).not.toContain("data-kqa");
    expect(message.html).not.toContain("data-kqa");
    expect(JSON.stringify(message)).not.toContain(SECRET);
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ status: "sent", to: "ada@example.com", token: TOKEN, messageId: "<sent-id@example.com>" });
  });

  it("does not send again until resend is asked", async () => {
    const rows = [{ id: "1", to: "ada@example.com", token: TOKEN, status: "sent" as const, sentAt: "2026-11-13T00:00:00.000Z", messageId: "<old@example.com>" }];
    const first = harness(ctx({ email: "ada@example.com", rows }));
    expect(await sendInvite({ personId, triggeredBy: "mcp" }, first.deps)).toMatchObject({ ok: true, result: "already_sent" });
    expect(first.send).not.toHaveBeenCalled();
    const again = harness(ctx({ email: "ada@example.com", rows }));
    expect(await sendInvite({ personId, triggeredBy: "mcp", resend: true }, again.deps)).toMatchObject({ ok: true, result: "sent" });
    expect(again.send).toHaveBeenCalledTimes(1);
  });

  it("blocks an invite when a per-person rate limit is exhausted", async () => {
    const rateLimit = vi.fn(async () => false);
    const { send, recorded, deps } = harness(ctx({ email: "ada@example.com" }), { rateLimit });

    expect(await sendInvite({ personId, triggeredBy: "admin", resend: true }, deps)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(rateLimit).toHaveBeenCalledWith(`invite-person:test-scope:${personId}`, 1, 1);
    expect(send).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });

  it("fails closed if the durable rate-limit store is unavailable", async () => {
    const { send, recorded, deps } = harness(ctx({ email: "ada@example.com" }), {
      rateLimit: async () => { throw new Error("database unavailable"); },
    });

    expect(await sendInvite({ personId, triggeredBy: "admin" }, deps)).toMatchObject({ ok: false, code: "rate_limit_unavailable" });
    expect(send).not.toHaveBeenCalled();
    expect(recorded).toHaveLength(0);
  });

  it("does not record a successful send as a failure when the mail row cannot be saved", async () => {
    const recorded: { status?: string }[] = [];
    const { send, deps } = harness(ctx({ email: "ada@example.com" }), {
      record: async (row) => {
        recorded.push(row as { status?: string });
        if ((row as { status?: string }).status === "sent") throw new Error("db write failed");
      },
    });
    const result = await sendInvite({ personId, triggeredBy: "admin" }, deps);
    expect(send).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: false, code: "send_failed" });
    if (!result.ok) expect(result.error).toMatch(/was sent/i);
    expect(recorded.some((row) => row.status === "failed")).toBe(false);
  });

  it("stores a failed attempt without the password", async () => {
    const { recorded, deps } = harness(ctx({ email: "ada@example.com" }), {
      send: async () => { throw new Error(`535 password=${SECRET}`); },
    });
    const result = await sendInvite({ personId, triggeredBy: "admin" }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain(SECRET);
    expect(JSON.stringify(recorded)).not.toContain(SECRET);
    expect(publicSmtpFailure(new Error(`535 password=${SECRET}`), SECRET)).not.toContain(SECRET);
  });
});

describe("delivery classification", () => {
  const id = "<abc123@example.com>";

  it("searches only that message id", () => {
    const query = JSON.stringify(deliverySearchQuery(id));
    expect(query).toContain("abc123@example.com");
    expect(query).not.toContain("UNSEEN");
    expect(query).not.toContain("ALL");
  });

  it("reads a bounce, a delivery, and ignores the message we sent", () => {
    expect(classifyDeliverySource("Message-ID: <bounce@x>\r\nAction: failed\r\n", id)).toBe("bounced");
    expect(classifyDeliverySource("Message-ID: <ok@x>\r\nAction: delivered\r\n", id)).toBe("delivered");
    expect(classifyDeliverySource("Message-ID: <relay@x>\r\nAction: relayed\r\n", id)).toBe("unknown");
    expect(classifyDeliverySource("Message-ID: <expanded@x>\r\nAction: expanded\r\n", id)).toBe("unknown");
    expect(classifyDeliverySource(`Message-ID: ${id}\r\nSubject: hello\r\n`, id)).toBe("ignore");
    expect(classifyDeliverySource("Message-ID: <other@x>\r\nSubject: newsletter\r\n", id)).toBe("unknown");
  });
});
