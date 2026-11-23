import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { transaction: true },
  matchedCount: 1,
  calls: [] as { collection: string; args: unknown[] }[],
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
    }),
  },
}));

import { insertMail } from "../src/lib/repo/mail";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const tenant = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, work);

beforeEach(() => {
  mocks.matchedCount = 1;
  mocks.calls.length = 0;
  mocks.withMongoTransaction.mockClear();
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
