import { describe, expect, it, vi } from "vitest";
import { checkInviteDelivery, type DeliveryDeps } from "../src/lib/mail/delivery";
import { currentMail } from "../src/lib/mail/state";

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

  it("checks the exact stored id for a pending attempt and resolves it when a DSN confirms delivery", async () => {
    const pendingContext = {
      ...context,
      rows: [{ ...context.rows[0], status: "pending" as const }],
    };
    const save = vi.fn(async () => undefined);
    const check = vi.fn(async () => new Map([[messageId, { status: "delivered" as const, detail: "Recipient server accepted the message." }]]));
    const { deps } = harness({ load: async () => pendingContext, check, save });

    expect(await checkInviteDelivery("person-1", deps)).toMatchObject({ ok: true, delivery: "delivered" });
    expect(check).toHaveBeenCalledWith([messageId]);
    expect(save).toHaveBeenCalledWith("mail-1", expect.objectContaining({ delivery: "delivered" }));
    expect(currentMail(pendingContext.person, [{
      ...pendingContext.rows[0], id: "mail-1", sentAt: "2026-01-01T00:00:00.000Z", delivery: "delivered",
    }])).toMatchObject({ state: "sent", delivery: "delivered" });
  });

  it("checks one exact historical attempt after the participant email and link have changed", async () => {
    const historical = { id: "mail-old", participantId: "person-1", to: "old@example.com", token: "old-token", status: "pending" as const, sentAt: "2026-01-01T00:00:00.000Z", messageId };
    const pendingContext = { ...context, person: { ...context.person, email: "new@example.com", token: "new-token" }, rows: [] };
    const save = vi.fn(async () => undefined);
    const check = vi.fn(async () => new Map([[messageId, { status: "bounced" as const, detail: "Recipient server rejected the message." }]]));
    const { deps } = harness({ load: async () => pendingContext, loadAttempt: async () => historical, check, save });

    expect(await checkInviteDelivery("person-1", deps, "aaaaaaaaaaaaaaaaaaaaaaaa")).toMatchObject({ ok: true, delivery: "bounced" });
    expect(check).toHaveBeenCalledWith([messageId]);
    expect(save).toHaveBeenCalledWith("mail-old", expect.objectContaining({ delivery: "bounced" }));
  });

  it("reports the stored confirmation when a later provider check is inconclusive", async () => {
    const confirmedContext = {
      ...context,
      rows: [{ ...context.rows[0], delivery: "delivered" as const }],
    };
    const { deps } = harness({
      load: async () => confirmedContext,
      save: async () => "delivered",
    });

    expect(await checkInviteDelivery("person-1", deps)).toMatchObject({ ok: true, delivery: "delivered" });
  });
});
