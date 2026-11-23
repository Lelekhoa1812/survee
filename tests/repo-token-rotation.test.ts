import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  current: true,
  pending: false,
  calls: [] as { collection: string; filter: unknown; update?: unknown; options: unknown }[],
  session: { transaction: true },
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work(mocks.session)),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    participants: async () => ({
      findOne: async (filter: unknown, options: unknown) => {
        mocks.calls.push({ collection: "participants.findOne", filter, options });
        return mocks.current ? { _id: participantId } : null;
      },
      updateOne: async (filter: unknown, update: unknown, options: unknown) => {
        mocks.calls.push({ collection: "participants.updateOne", filter, update, options });
        return { matchedCount: mocks.current ? 1 : 0 };
      },
    }),
    mail: async () => ({
      findOne: async (filter: unknown, options: unknown) => {
        mocks.calls.push({ collection: "mail.findOne", filter, options });
        return mocks.pending ? { _id: new ObjectId() } : null;
      },
    }),
  },
}));

import { regenerateToken } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const participantId = new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa");
const asTenant = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, work);

beforeEach(() => {
  mocks.current = true;
  mocks.pending = false;
  mocks.calls.length = 0;
  mocks.withMongoTransaction.mockClear();
});

describe("regenerateToken", () => {
  it("refuses to rotate a link while an invite attempt is unresolved", async () => {
    mocks.pending = true;

    const result = await asTenant(() => regenerateToken(participantId.toHexString()));

    expect(result).toBe("invite_pending");
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map((call) => call.collection)).toEqual(["participants.findOne", "mail.findOne"]);
    expect(mocks.calls[1].filter).toEqual({ participantId, status: "pending", delivery: { $nin: ["delivered", "bounced"] } });
    expect(mocks.calls.every((call) => (call.options as { session?: unknown }).session === mocks.session)).toBe(true);
  });

  it("rotates when no unresolved attempt remains and serializes with invitation reservation", async () => {
    const result = await asTenant(() => regenerateToken(participantId.toHexString()));

    expect(result).toMatch(/^[A-Za-z0-9_-]{22,32}$/);
    expect(mocks.calls.map((call) => call.collection)).toEqual(["participants.findOne", "mail.findOne", "participants.updateOne"]);
    expect(mocks.calls[0].filter).toEqual(tenantFilter("workspace-1", { _id: participantId }));
    expect(mocks.calls[2]).toMatchObject({
      collection: "participants.updateOne",
      filter: tenantFilter("workspace-1", { _id: participantId }),
      update: { $set: { token: result, updatedAt: expect.any(Date) }, $inc: { inviteAttemptRevision: 1 } },
      options: { session: mocks.session },
    });
  });

  it("returns null when the tenant-scoped participant no longer exists", async () => {
    mocks.current = false;

    const result = await asTenant(() => regenerateToken(participantId.toHexString()));

    expect(result).toBeNull();
    expect(mocks.calls.map((call) => call.collection)).toEqual(["participants.findOne"]);
  });
});
