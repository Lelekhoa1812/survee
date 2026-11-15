import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { transaction: true },
  deletedCount: 1,
  calls: [] as { collection: string; filter: Record<string, unknown>; options: Record<string, unknown> }[],
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work(mocks.session)),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    interviews: async () => ({
      deleteOne: async (filter: Record<string, unknown>, options: Record<string, unknown>) => {
        mocks.calls.push({ collection: "interviews", filter, options });
        return { deletedCount: mocks.deletedCount };
      },
    }),
    versions: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "versions", filter, options }); } }),
    participants: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "participants", filter, options }); } }),
    events: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "events", filter, options }); } }),
    analyticsRuns: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "analyticsRuns", filter, options }); } }),
    mail: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "mail", filter, options }); } }),
  },
}));

import { deleteInterview } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const interviewId = new ObjectId().toHexString();
const session = mocks.session;
const asAxion = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, work);

beforeEach(() => {
  mocks.deletedCount = 1;
  mocks.calls.length = 0;
  mocks.withMongoTransaction.mockReset().mockImplementation(async (work) => work(session));
});

describe("deleteInterview", () => {
  it("deletes the parent and all dependent records sequentially in one tenant-scoped transaction", async () => {
    const deleted = await asAxion(() => deleteInterview(interviewId));

    expect(deleted).toBe(true);
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual([
      "interviews", "versions", "participants", "events", "analyticsRuns", "mail",
    ]);
    expect(mocks.calls.every(({ options }) => options.session === session)).toBe(true);
    expect(mocks.calls[0].filter).toEqual(tenantFilter("axion", { _id: new ObjectId(interviewId) }));
  });

  it("does not remove dependent records when the tenant-scoped interview no longer exists", async () => {
    mocks.deletedCount = 0;
    const deleted = await asAxion(() => deleteInterview(interviewId));

    expect(deleted).toBe(false);
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["interviews"]);
  });
});
