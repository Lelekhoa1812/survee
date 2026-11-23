import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ids = {
  participant: new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"),
  interview: new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb"),
  attempt: new ObjectId("cccccccccccccccccccccccc"),
  session: { transaction: true },
};
const mocks = vi.hoisted(() => ({
  calls: [] as { collection: string; filter?: unknown; update?: unknown; options?: unknown; document?: unknown }[],
  attempt: null as { status: string; delivery?: string; resolution?: unknown; to: string; token: string } | null,
  updateMatched: 1,
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work({ transaction: true })),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    participants: async () => ({
      findOne: async (filter: unknown, options: unknown) => { mocks.calls.push({ collection: "participant.find", filter, options }); return { interviewId: ids.interview, email: "old@example.test", token: "private-link" }; },
      updateOne: async (filter: unknown, update: unknown, options: unknown) => { mocks.calls.push({ collection: "participant.touch", filter, update, options }); return { matchedCount: 1 }; },
    }),
    mail: async () => ({
      findOne: async (filter: unknown, options: unknown) => { mocks.calls.push({ collection: "mail.find", filter, options }); return mocks.attempt; },
      updateOne: async (filter: unknown, update: unknown, options: unknown) => { mocks.calls.push({ collection: "mail.update", filter, update, options }); if (!mocks.updateMatched && mocks.attempt) mocks.attempt.delivery = "delivered"; return { matchedCount: mocks.updateMatched }; },
    }),
    events: async () => ({ insertOne: async (document: unknown, options: unknown) => { mocks.calls.push({ collection: "event.insert", document, options }); } }),
  },
}));

import { resolveInviteAttempt } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const tenant = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "workspace-a", userId: "dddddddddddddddddddddddd", role: "admin", source: "session" }, work);
const input = { participantId: ids.participant.toHexString(), attemptId: ids.attempt.toHexString(), purpose: "email_change" as const, reason: "Recipient address corrected", actorId: "dddddddddddddddddddddddd" };

beforeEach(() => {
  mocks.calls.length = 0;
  mocks.attempt = { status: "pending", delivery: "unknown", to: "old@example.test", token: "private-link" };
  mocks.updateMatched = 1;
  mocks.withMongoTransaction.mockClear();
});

describe("resolveInviteAttempt", () => {
  it("tenant scopes and atomically records a host disposition without changing delivery truth", async () => {
    await expect(tenant(() => resolveInviteAttempt(input))).resolves.toBe("resolved");
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    const mailFind = mocks.calls.find((call) => call.collection === "mail.find")!;
    expect(mailFind.filter).toEqual(tenantFilter("workspace-a", { _id: ids.attempt, participantId: ids.participant, interviewId: ids.interview }));
    const mailUpdate = mocks.calls.find((call) => call.collection === "mail.update")!;
    expect(mailUpdate.filter).toEqual(tenantFilter("workspace-a", expect.objectContaining({ status: "pending", delivery: { $nin: ["delivered", "bounced"] }, resolution: { $exists: false } })));
    expect(mailUpdate.update).toMatchObject({ $set: { resolution: { purpose: "email_change", acknowledgedBy: input.actorId, reason: input.reason, acknowledgedAt: expect.any(Date) } } });
    expect(mocks.calls.at(-1)).toMatchObject({ collection: "event.insert", document: { type: "invite", tenantId: "workspace-a", meta: { action: "ambiguous_outcome_acknowledged", attemptId: ids.attempt.toHexString(), delivery: "unknown", acknowledgedBy: input.actorId } } });
    expect(mocks.calls.at(-1)?.options).toEqual({ session: ids.session });
  });

  it("rejects definitive and already-resolved attempts without writing another disposition", async () => {
    mocks.attempt = { status: "pending", delivery: "bounced", to: "old@example.test", token: "private-link" };
    await expect(tenant(() => resolveInviteAttempt(input))).resolves.toBe("stale");
    expect(mocks.calls.some((call) => call.collection === "mail.update" || call.collection === "event.insert")).toBe(false);
    mocks.calls.length = 0;
    mocks.attempt = { status: "pending", delivery: "unknown", resolution: { purpose: "email_change" }, to: "old@example.test", token: "private-link" };
    await expect(tenant(() => resolveInviteAttempt(input))).resolves.toBe("already_resolved");
    expect(mocks.calls.some((call) => call.collection === "mail.update" || call.collection === "event.insert")).toBe(false);
  });

  it("does not report a race with a definitive delivery check as already acknowledged", async () => {
    mocks.updateMatched = 0;
    await expect(tenant(() => resolveInviteAttempt(input))).resolves.toBe("stale");
    expect(mocks.calls.at(-1)?.collection).toBe("mail.find");
    expect(mocks.calls.some((call) => call.collection === "event.insert")).toBe(false);
  });
});
