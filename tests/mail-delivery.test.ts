import { describe, expect, it, vi } from "vitest";
import { checkInviteDelivery, type DeliveryDeps } from "../src/lib/mail/delivery";

const messageId = "<delivery-check-123@example.com>";
const context = {
  person: { id: "person-1", interviewId: "interview-1", email: "person@example.com", token: "respondent-token" },
  rows: [{ id: "mail-1", to: "person@example.com", token: "respondent-token", status: "sent" as const, sentAt: "2026-01-01T00:00:00.000Z", messageId }],
};

function harness(extra: Partial<DeliveryDeps> = {}) {
  const check = vi.fn(async () => new Map([[messageId, { status: "unknown" as const, detail: "Not confirmed yet." }]]));
  const rateLimit = vi.fn(async () => true);
  const deps: DeliveryDeps = {
    load: async () => context,
    check,
    save: async () => undefined,
    rateLimit,
    ...extra,
  };
  return { check, rateLimit, deps };
}

describe("invite delivery check throttling", () => {
  it("limits checks per participant before opening an IMAP connection", async () => {
    const rateLimit = vi.fn(async () => false);
    const { check, deps } = harness({ rateLimit });

    expect(await checkInviteDelivery("person-1", deps)).toMatchObject({ ok: false, code: "rate_limited" });
    expect(rateLimit).toHaveBeenCalledWith("delivery-person:test-scope:person-1", 3, 60);
    expect(check).not.toHaveBeenCalled();
  });

  it("fails closed if the durable rate-limit store is unavailable", async () => {
    const { check, deps } = harness({ rateLimit: async () => { throw new Error("database unavailable"); } });

    expect(await checkInviteDelivery("person-1", deps)).toMatchObject({ ok: false, code: "rate_limit_unavailable" });
    expect(check).not.toHaveBeenCalled();
  });

  it("checks and saves delivery when participant and workspace quotas allow it", async () => {
    const { check, rateLimit, deps } = harness();

    expect(await checkInviteDelivery("person-1", deps)).toMatchObject({ ok: true, delivery: "unknown" });
    expect(rateLimit).toHaveBeenNthCalledWith(1, "delivery-person:test-scope:person-1", 3, 60);
    expect(rateLimit).toHaveBeenNthCalledWith(2, "delivery-workspace:test-scope", 100, 60);
    expect(check).toHaveBeenCalledWith([messageId]);
  });
});
