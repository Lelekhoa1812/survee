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

  it("replays a concurrent keyed resend after the per-person rate limit rejects its racing request", async () => {
    let lookups = 0;
    let releaseLookups!: () => void;
    const lookupGate = new Promise<void>((resolve) => { releaseLookups = resolve; });
    let reserveStarted!: () => void;
    const reserveGate = new Promise<void>((resolve) => { reserveStarted = resolve; });
    let attemptCreated = false;
    let personRateCalls = 0;
    const attempt = {
      id: "attempt-1", participantId: personId, to: "ada@example.com", token: TOKEN,
      status: "sent" as const, sentAt: "2026-11-24T00:00:00.000Z", messageId: "<sent-id@example.com>",
    };
    const { send, deps } = harness(ctx({ email: "ada@example.com" }), {
      findOperation: async () => {
        lookups += 1;
        if (lookups === 2) releaseLookups();
        await lookupGate;
        return attemptCreated ? { kind: "replayed", attempt, interviewId } : null;
      },
      rateLimit: async (key) => {
        if (!key.includes("invite-person")) return true;
        personRateCalls += 1;
        if (personRateCalls === 1) return true;
        await reserveGate;
        return false;
      },
      begin: async () => {
        attemptCreated = true;
        reserveStarted();
        return { kind: "created", attemptId: "attempt-1" };
      },
    });
    const operation = { operationId: "same-resend", credentialId: "api_key:test", argumentDigest: "digest" };
    const input = { personId, triggeredBy: "mcp" as const, resend: true, operation };
    const results = await Promise.all([sendInvite(input, deps), sendInvite(input, deps)]);

    expect(results).toEqual([
      expect.objectContaining({ ok: true, result: "sent", messageId: "<sent-id@example.com>" }),
      expect.objectContaining({ ok: true, result: "sent", messageId: "<sent-id@example.com>" }),
    ]);
    expect(send).toHaveBeenCalledTimes(1);
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
  const recipient = "ada@example.com";

  function report(action: string, options: { envelope?: string | null; to?: string; originalTo?: string; originalMessageId?: string; extraBlocks?: string; references?: string } = {}): string {
    const boundary = "dsn-boundary";
    return [
      "From: Mail Delivery Subsystem <mailer-daemon@example.net>",
      "Message-ID: <report@example.net>",
      ...(options.references ? [`References: ${options.references}`] : []),
      `Content-Type: multipart/report; report-type=delivery-status; boundary=\"${boundary}\"`,
      "",
      `--${boundary}`,
      "Content-Type: text/plain; charset=utf-8",
      "",
      "Delivery report.",
      `--${boundary}`,
      "Content-Type: message/delivery-status",
      "",
      ...(options.envelope === null ? [] : [`Original-Envelope-ID: ${options.envelope ?? id}`]),
      "Reporting-MTA: dns; mx.example.net",
      "",
      ...(options.originalTo ? [`Original-Recipient: rfc822; ${options.originalTo}`] : []),
      `Final-Recipient: rfc822; ${options.to ?? recipient}`,
      `Action: ${action}`,
      `Status: ${action === "delivered" ? "2.0.0" : action === "failed" ? "5.1.1" : "4.0.0"}`,
      ...(options.extraBlocks ? ["", options.extraBlocks] : []),
      ...(options.originalMessageId ? [`--${boundary}`, "Content-Type: message/rfc822", "", `Message-ID: ${options.originalMessageId}`, "From: ada@example.com", "", "Original invitation."] : []),
      `--${boundary}--`,
      "",
    ].join("\r\n");
  }

  it("searches only that message id", () => {
    const query = JSON.stringify(deliverySearchQuery(id));
    expect(query).toContain("abc123@example.com");
    expect(query).not.toContain("UNSEEN");
    expect(query).not.toContain("ALL");
  });

  it("classifies correlated single-recipient RFC 3464 reports", () => {
    expect(classifyDeliverySource(report("failed"), id, recipient)).toBe("bounced");
    expect(classifyDeliverySource(report("delivered"), id, recipient)).toBe("delivered");
    const folded = report("failed").replace(`Final-Recipient: rfc822; ${recipient}`, `Final-Recipient: rfc822;\r\n\t${recipient}`);
    expect(classifyDeliverySource(folded, id, recipient)).toBe("bounced");
    const forwarded = report("delivered").replace(
      `Final-Recipient: rfc822; ${recipient}`,
      `Original-Recipient: rfc822; ${recipient}\r\nFinal-Recipient: rfc822; forwarded@example.net`,
    );
    expect(classifyDeliverySource(forwarded, id, recipient)).toBe("delivered");
    const xtextRecipient = "ada+2Btag@example.com";
    const xtextReport = report("delivered", { envelope: null, originalTo: xtextRecipient, to: "forwarded@example.net", references: id });
    expect(classifyDeliverySource(xtextReport, id, "ada+tag@example.com")).toBe("delivered");
    expect(classifyDeliverySource(xtextReport.replace(`Final-Recipient: rfc822; forwarded@example.net\r\nAction: delivered`, "Action: delivered"), id, "ada+tag@example.com")).toBe("unknown");
    const attachedOriginal = report("failed", { envelope: null, originalMessageId: id });
    expect(classifyDeliverySource(attachedOriginal, id, recipient)).toBe("bounced");
    expect(classifyDeliverySource(report("relayed"), id, recipient)).toBe("unknown");
    expect(classifyDeliverySource(report("expanded"), id, recipient)).toBe("unknown");
    expect(classifyDeliverySource(report("delivered").replace("Status: 2.0.0", "Status: 5.1.1"), id, recipient)).toBe("unknown");
    expect(classifyDeliverySource(report("failed").replace("Status: 5.1.1", "Status: 2.0.0"), id, recipient)).toBe("unknown");
  });

  it("fails closed on quoted prose, unstructured headers, and mismatched correlation", () => {
    expect(classifyDeliverySource(`Message-ID: <report@example.net>\r\nSubject: Action: failed for ${id}`, id, recipient)).toBe("unknown");
    expect(classifyDeliverySource(`Message-ID: ${id}\r\nSubject: hello\r\n`, id, recipient)).toBe("ignore");
    expect(classifyDeliverySource(report("failed", { envelope: "<other@example.com>" }), id, recipient)).toBe("unknown");
    expect(classifyDeliverySource(report("failed", { to: "someone-else@example.com" }), id, recipient)).toBe("unknown");
    const unsupportedAddressType = report("delivered").replace(`Final-Recipient: rfc822; ${recipient}`, `Final-Recipient: x400; ${recipient}`);
    expect(classifyDeliverySource(unsupportedAddressType, id, recipient)).toBe("unknown");
    expect(classifyDeliverySource(report("failed", { envelope: null, references: "<abc123@example.com>" }), id, recipient)).toBe("bounced");
  });

  it("keeps multi-recipient and malformed reports unknown", () => {
    expect(classifyDeliverySource(report("failed", { extraBlocks: "Final-Recipient: rfc822; other@example.com\r\nAction: delivered\r\nStatus: 2.0.0" }), id, recipient)).toBe("unknown");
    expect(classifyDeliverySource("Content-Type: multipart/report; report-type=delivery-status; boundary=x\r\n\r\n--x\r\nContent-Type: message/delivery-status\r\n\r\nAction: failed", id, recipient)).toBe("unknown");
    expect(classifyDeliverySource(report("failed").replace("--dsn-boundary--\r\n", ""), id, recipient)).toBe("unknown");
    expect(classifyDeliverySource(report("failed").replace("Reporting-MTA: dns; mx.example.net\r\n", ""), id, recipient)).toBe("unknown");
  });
});
