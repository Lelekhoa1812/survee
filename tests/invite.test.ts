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
    begin: async (row) => { recorded.push(row); return "attempt-1"; },
    finish: async (id, patch) => { recorded.push({ id, ...patch }); return true; },
    log: async () => {},
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

  it("reports a participant preflight read failure without implying an ambiguous send", async () => {
    const { send, deps } = harness(ctx({ email: "ada@example.com" }), {
      load: async () => { throw new Error("database unavailable"); },
    });
    expect(await sendInvite({ personId, triggeredBy: "mcp" }, deps)).toMatchObject({ ok: false, code: "preflight_unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send if the participant is removed before the durable attempt can be reserved", async () => {
    const { send, deps } = harness(ctx({ email: "ada@example.com" }), { begin: async () => null });

    expect(await sendInvite({ personId, triggeredBy: "admin" }, deps)).toMatchObject({ ok: false, code: "attempt_unavailable" });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send when the tenant rate-limit scope cannot be verified", async () => {
    const { send, deps } = harness(ctx({ email: "ada@example.com" }), {
      tenantId: async () => { throw new Error("database unavailable"); },
    });
    expect(await sendInvite({ personId, triggeredBy: "mcp" }, deps)).toMatchObject({ ok: false, code: "preflight_unavailable" });
    expect(send).not.toHaveBeenCalled();
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
    expect(recorded).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ status: "pending", to: "ada@example.com", token: TOKEN });
    expect(recorded[0]).not.toHaveProperty("text");
    expect(recorded[0]).not.toHaveProperty("html");
    expect(recorded[1]).toMatchObject({ id: "attempt-1", status: "sent", messageId: "<sent-id@example.com>" });
  });

  it("waits for the success audit before returning a successful send", async () => {
    let resolveLog!: () => void;
    const logGate = new Promise<void>((resolve) => { resolveLog = resolve; });
    let logged = false;
    let logStarted = false;
    const { deps } = harness(ctx({ email: "ada@example.com" }), {
      log: async () => { logStarted = true; await logGate; logged = true; },
    });
    let settled = false;
    const result = sendInvite({ personId, triggeredBy: "admin" }, deps).finally(() => { settled = true; });

    await vi.waitFor(() => expect(logStarted).toBe(true));
    expect(settled).toBe(false);
    resolveLog();
    expect(await result).toMatchObject({ ok: true, result: "sent" });
    expect(logged).toBe(true);
  });

  it("keeps the confirmed send result when audit persistence fails", async () => {
    const { send, deps } = harness(ctx({ email: "ada@example.com" }), {
      log: async () => { throw new Error("audit store unavailable"); },
    });
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await sendInvite({ personId, triggeredBy: "admin" }, deps)).toMatchObject({ ok: true, result: "sent" });
      expect(send).toHaveBeenCalledOnce();
      expect(error).toHaveBeenCalledWith("[audit] invite event persistence failed");
    } finally {
      error.mockRestore();
    }
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

  it("persists a pending attempt before SMTP and does not send if that insert fails", async () => {
    const sequence: string[] = [];
    const { send, deps } = harness(ctx({ email: "ada@example.com" }), {
      begin: async () => { sequence.push("insert"); throw new Error("db write failed"); },
      send: async () => { sequence.push("smtp"); return { messageId: "<sent-id@example.com>" }; },
    });
    const result = await sendInvite({ personId, triggeredBy: "admin" }, deps);
    expect(result).toMatchObject({ ok: false, code: "attempt_unavailable" });
    expect(sequence).toEqual(["insert"]);
    expect(send).not.toHaveBeenCalled();
  });

  it("leaves an accepted send pending when final persistence fails and suppresses ordinary retry", async () => {
    const rows: InviteContext["rows"] = [];
    const first = harness(ctx({ email: "ada@example.com", rows }), {
      begin: async (row) => {
        rows.push({
          id: "attempt-1", to: row.to, token: row.token, status: row.status,
          sentAt: row.sentAt.toISOString(), messageId: row.messageId,
        });
        return "attempt-1";
      },
      finish: async () => { throw new Error("db write failed"); },
    });
    const result = await sendInvite({ personId, triggeredBy: "admin" }, first.deps);
    expect(first.send).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ ok: false, code: "outcome_unknown" });
    expect(rows[0]).toMatchObject({ status: "pending", messageId: expect.any(String) });

    const ordinaryRetry = harness(ctx({ email: "ada@example.com", rows }));
    expect(await sendInvite({ personId, triggeredBy: "admin" }, ordinaryRetry.deps)).toMatchObject({ ok: false, code: "outcome_unknown" });
    expect(ordinaryRetry.send).not.toHaveBeenCalled();

    const explicitRetry = harness(ctx({ email: "ada@example.com", rows }));
    expect(await sendInvite({ personId, triggeredBy: "admin", resend: true }, explicitRetry.deps)).toMatchObject({ ok: true, result: "sent" });
    expect(explicitRetry.send).toHaveBeenCalledOnce();
  });

  it("keeps SMTP errors pending without storing provider details or the password", async () => {
    const { recorded, deps } = harness(ctx({ email: "ada@example.com" }), {
      send: async () => { throw new Error(`535 password=${SECRET}`); },
    });
    const result = await sendInvite({ personId, triggeredBy: "admin" }, deps);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).not.toContain(SECRET);
    expect(JSON.stringify(recorded)).not.toContain(SECRET);
    expect(recorded[0]).toMatchObject({ status: "pending" });
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
