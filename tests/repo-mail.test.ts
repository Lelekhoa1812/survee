import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { transaction: true },
  matchedCount: 1,
  currentDelivery: undefined as { delivery?: "delivered" | "bounced" | "unknown" } | undefined,
  calls: [] as { collection: string; args: unknown[] }[],
  aggregates: [] as Record<string, unknown>[][],
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work(mocks.session)),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    participants: async () => ({
      updateOne: async (...args: unknown[]) => { mocks.calls.push({ collection: "participants", args }); return { matchedCount: mocks.matchedCount }; },
    }),
    mail: async () => ({
      insertOne: async (...args: unknown[]) => { mocks.calls.push({ collection: "mail", args }); return { insertedId: (args[0] as { _id: ObjectId })._id }; },
      updateOne: async (...args: unknown[]) => { mocks.calls.push({ collection: "mail.update", args }); return { matchedCount: mocks.matchedCount }; },
      findOne: async (...args: unknown[]) => { mocks.calls.push({ collection: "mail.find", args }); return mocks.currentDelivery; },
      aggregate: (pipeline: Record<string, unknown>[]) => { mocks.aggregates.push(pipeline); return { toArray: async () => [] }; },
    }),
  },
}));

import { insertMail, listCurrentMailByParticipants, updateMailDelivery } from "../src/lib/repo/mail";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const tenant = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, work);

beforeEach(() => {
  mocks.matchedCount = 1;
  mocks.currentDelivery = undefined;
  mocks.calls.length = 0;
  mocks.aggregates.length = 0;
  mocks.withMongoTransaction.mockClear();
});

describe("updateMailDelivery", () => {
  it.each(["delivered", "bounced"] as const)("does not downgrade a confirmed %s result to unknown", async (delivery) => {
    mocks.matchedCount = 0;
    mocks.currentDelivery = { delivery };
    const id = new ObjectId();

    const result = await tenant(() => updateMailDelivery(id, { delivery: "unknown", deliveryCheckedAt: new Date(), deliveryDetail: "Not confirmed yet." }));

    expect(result).toBe(delivery);
    expect(mocks.calls[0].args[0]).toMatchObject({ $and: [{ $or: [{ tenantId: "axion" }, { tenantId: { $exists: false } }] }, { _id: id, delivery: { $nin: ["delivered", "bounced"] } }] });
    expect(mocks.calls[1].collection).toBe("mail.find");
  });

  it("allows definitive evidence to replace an unknown result", async () => {
    const id = new ObjectId();

    const result = await tenant(() => updateMailDelivery(id, { delivery: "delivered", deliveryCheckedAt: new Date() }));

    expect(result).toBe("delivered");
    expect(mocks.calls).toHaveLength(1);
    expect(mocks.calls[0].args[0]).toMatchObject({ $and: [{ $or: [{ tenantId: "axion" }, { tenantId: { $exists: false } }] }, { _id: id }] });
  });
});

describe("insertMail", () => {
  it("atomically reserves the participant before inserting a pending attempt", async () => {
    const interviewId = new ObjectId();
    const participantId = new ObjectId();
    const row = await tenant(() => insertMail({ interviewId, participantId, kind: "invite", to: "ada@example.test", token: "private-token", triggeredBy: "admin", status: "pending", messageId: "<attempt@example.test>", sentAt: new Date() }));

    expect(row?._id).toBeInstanceOf(ObjectId);
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["participants", "mail"]);
    expect(mocks.calls[0].args[0]).toMatchObject({ $and: [{ $or: [{ tenantId: "axion" }, { tenantId: { $exists: false } }] }, { _id: participantId, interviewId, email: "ada@example.test", token: "private-token" }] });
    expect(mocks.calls[0].args[1]).toEqual({ $inc: { inviteAttemptRevision: 1 } });
    expect(mocks.calls.every(({ args }) => (args.at(-1) as { session?: unknown }).session === mocks.session)).toBe(true);
  });

  it("does not create a mail attempt when the participant was removed or its recipient details changed", async () => {
    mocks.matchedCount = 0;
    const interviewId = new ObjectId();
    const participantId = new ObjectId();

    const row = await tenant(() => insertMail({ interviewId, participantId, kind: "invite", to: "ada@example.test", token: "private-token", triggeredBy: "admin", status: "pending", messageId: "<attempt@example.test>", sentAt: new Date() }));

    expect(row).toBeNull();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["participants"]);
  });
});

describe("listCurrentMailByParticipants", () => {
  it("returns bounded pending history and computes the full count for each participant", async () => {
    const interviewId = new ObjectId();
    const participantId = new ObjectId();
    await tenant(() => listCurrentMailByParticipants(interviewId, [{ id: participantId.toHexString(), token: "private-token" }]));

    const unresolvedPipeline = mocks.aggregates[0];
    expect(unresolvedPipeline[0]).toMatchObject({ $match: { $and: [{ $or: [{ tenantId: "axion" }, { tenantId: { $exists: false } }] }, { interviewId, participantId: { $in: [participantId] }, status: "pending", delivery: { $nin: ["delivered", "bounced"] } }] } });
    expect(unresolvedPipeline[1]).toEqual({ $setWindowFields: { partitionBy: "$participantId", sortBy: { _id: -1 }, output: { pageRow: { $documentNumber: {} }, pendingAttemptCount: { $count: {}, window: { documents: ["unbounded", "unbounded"] } } } } });
    expect(unresolvedPipeline[2]).toEqual({ $match: { pageRow: { $lte: 50 } } });
  });
});
