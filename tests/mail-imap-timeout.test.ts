import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connect: vi.fn<() => Promise<void>>(),
  logout: vi.fn<() => Promise<void>>(),
  close: vi.fn<() => void>(),
  search: vi.fn<(query: unknown, options: { uid: true }) => Promise<number[]>>(),
  fetch: vi.fn<(range: number[], query: { source: true; envelope: true }, options: { uid: true }) => AsyncIterable<{ source?: Uint8Array | Buffer }>>(),
  release: vi.fn<() => void>(),
}));

vi.mock("imapflow", () => ({
  ImapFlow: vi.fn(function ImapFlow(this: Record<string, unknown>) {
    this.connect = state.connect;
    this.logout = state.logout;
    this.close = state.close;
    this.getMailboxLock = vi.fn(async () => ({ release: state.release }));
    this.search = state.search;
    this.fetch = state.fetch;
  }),
}));

import { checkMessageIds } from "../src/lib/mail/imap";

const messageId = "<message@example.com>";

describe("IMAP operation and cleanup deadlines", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    process.env.IMAP_HOST = "imap.example.com";
    process.env.IMAP_PORT = "993";
    process.env.SMTP_USER = "host@example.com";
    process.env.SMTP_PASSWORD = "test-secret";
    state.connect.mockResolvedValue(undefined);
    state.logout.mockResolvedValue(undefined);
    state.search.mockResolvedValue([]);
    state.fetch.mockImplementation(() => (async function* () {})());
  });

  it("closes the client when the operation deadline wins and preserves unknown status", async () => {
    vi.useFakeTimers();
    state.connect.mockReturnValue(new Promise(() => {}));

    const resultPromise = checkMessageIds([messageId]);
    await vi.advanceTimersByTimeAsync(8_000);
    const result = await resultPromise;

    expect(result.get(messageId)).toEqual({
      status: "unknown",
      detail: "We could not confirm delivery. Try again in a moment.",
    });
    expect(state.close).toHaveBeenCalledTimes(1);
    expect(state.logout).not.toHaveBeenCalled();
  });

  it("bounds a hanging logout and closes the connection after the cleanup deadline", async () => {
    vi.useFakeTimers();
    state.logout.mockReturnValue(new Promise(() => {}));

    let completed = false;
    const resultPromise = checkMessageIds([messageId]).then((result) => {
      completed = true;
      return result;
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    const result = await resultPromise;
    expect(result.get(messageId)).toEqual({ status: "unknown", detail: "Not confirmed yet." });
    expect(state.release).toHaveBeenCalledTimes(1);
    expect(state.close).toHaveBeenCalledTimes(1);
  });

  it("caps fetched candidates and classifies only a report for the tracked recipient", async () => {
    const report = [
      "From: Mail Delivery Subsystem <mailer-daemon@example.net>",
      "Message-ID: <report@example.net>",
      "Content-Type: multipart/report; report-type=delivery-status; boundary=\"test-dsn\"",
      "",
      "--test-dsn",
      "Content-Type: text/plain",
      "",
      "Delivery report.",
      "--test-dsn",
      "Content-Type: message/delivery-status",
      "",
      `Original-Envelope-ID: ${messageId}`,
      "Reporting-MTA: dns; mx.example.net",
      "",
      "Final-Recipient: rfc822; respondent@example.com",
      "Action: delivered",
      "Status: 2.0.0",
      "--test-dsn--",
      "",
    ].join("\r\n");
    state.search.mockResolvedValue([1, 2, 3, 4, 5, 6]);
    state.fetch.mockImplementation(() => (async function* () {
      yield { source: Buffer.from(`Subject: Action: failed for ${messageId}\r\n\r\nQuoted content only.`) };
      yield { source: Buffer.from(report) };
    })());

    const result = await checkMessageIds([messageId], new Map([[messageId, "respondent@example.com"]]));

    expect(result.get(messageId)).toMatchObject({ status: "delivered" });
    expect(state.fetch).toHaveBeenCalledWith([1, 2, 3, 4, 5], { source: true, envelope: true }, { uid: true });
  });
});
