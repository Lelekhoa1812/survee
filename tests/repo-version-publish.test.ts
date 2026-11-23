import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentVersion: 4,
  baseHash: "c".repeat(64),
  modifiedCount: 1,
  inserted: [] as Record<string, unknown>[],
  insertOptions: [] as Record<string, unknown>[],
  deleted: [] as Record<string, unknown>[],
  assetUpdates: [] as Record<string, unknown>[],
  assetMatchedCount: 1,
  events: [] as Record<string, unknown>[],
  eventOptions: [] as Record<string, unknown>[],
  failEventInsert: false,
  updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => {
    const result = await work({ transaction: true });
    if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
    return result;
  }),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    imageAssets: async () => ({
      updateOne: async (filter: Record<string, unknown>, update: Record<string, unknown>, options: Record<string, unknown>) => {
        mocks.assetUpdates.push({ filter, update, options });
        return { matchedCount: mocks.assetMatchedCount };
      },
    }),
    interviews: async () => ({
      findOne: async (filter: Record<string, unknown>) => {
        const clauses = Array.isArray(filter.$and) ? filter.$and as Record<string, unknown>[] : [filter];
        const interviewFilter = clauses.find((clause) => "currentVersion" in clause) as { currentVersion?: number } | undefined;
        return interviewFilter?.currentVersion === mocks.currentVersion ? { currentVersion: mocks.currentVersion } : null;
      },
      updateOne: mocks.updateOne,
    }),
    versions: async () => ({
      findOne: async (_filter: unknown, options?: { projection?: unknown }) => options?.projection ? { manifest: {} } : { htmlSha256: mocks.baseHash },
      insertOne: async (row: Record<string, unknown>, options: Record<string, unknown>) => { mocks.inserted.push(row); mocks.insertOptions.push(options); },
      deleteOne: async (filter: Record<string, unknown>) => { mocks.deleted.push(filter); },
    }),
    events: async () => ({ insertOne: async (row: Record<string, unknown>, options: Record<string, unknown>) => { mocks.events.push(row); mocks.eventOptions.push(options); if (mocks.failEventInsert) throw new Error("event insert failed"); return {}; } }),
  },
}));

import { publishVersionIfCurrent } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const interviewId = new ObjectId().toHexString();
const survey = {
  html: "<html>new</html>",
  manifest: { format: "kqa/1" as const, title: "New", questions: [] },
  check: { errors: 0, warnings: 0, info: 0, checkedAt: "now", checkerVersion: "test" },
};

beforeEach(() => {
  mocks.currentVersion = 4;
  mocks.baseHash = "c".repeat(64);
  mocks.modifiedCount = 1;
  mocks.inserted.length = 0;
  mocks.insertOptions.length = 0;
  mocks.deleted.length = 0;
  mocks.assetUpdates.length = 0;
  mocks.assetMatchedCount = 1;
  mocks.events.length = 0;
  mocks.eventOptions.length = 0;
  mocks.failEventInsert = false;
  mocks.updateOne.mockReset().mockImplementation(async () => ({ modifiedCount: mocks.modifiedCount }));
  mocks.withMongoTransaction.mockReset().mockImplementation(async (work) => {
    const result = await work({ transaction: true });
    if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
    return result;
  });
});

describe("publishVersionIfCurrent", () => {
  it("adds the next immutable version and advances the head in one transaction", async () => {
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, mocks.baseHash, survey));
    expect(result).toEqual({ version: 5 });
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0]).toMatchObject({ version: 5, html: survey.html, htmlSha256: expect.any(String) });
    expect(mocks.insertOptions).toEqual([{ session: { transaction: true } }]);
    expect(mocks.events[0]).toMatchObject({ type: "version", tenantId: "axion", interviewId: expect.any(ObjectId), meta: { version: 5, source: "mcp_patch" } });
    expect(mocks.eventOptions).toEqual([{ session: { transaction: true } }]);
    expect(mocks.updateOne).toHaveBeenCalledWith(
      tenantFilter("axion", { _id: expect.any(ObjectId), currentVersion: 4 }),
      { $set: { currentVersion: 5, updatedAt: expect.any(Date) }, $inc: { respondentWriteRevision: 1 } },
      { session: { transaction: true } },
    );
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
  });

  it("returns a conflict when another publisher wins the compare-and-swap", async () => {
    mocks.modifiedCount = 0;
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, mocks.baseHash, survey));
    expect(result).toEqual({ conflict: true });
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.deleted).toHaveLength(0);
  });

  it("rejects a stale base hash before inserting a version", async () => {
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, "d".repeat(64), survey));
    expect(result).toEqual({ conflict: true });
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });

  it("touches each referenced tenant asset inside the publish transaction", async () => {
    const publicId = "a".repeat(43);
    const referenced = { ...survey, html: `<img src="/api/assets/${publicId}"><img src="/api/assets/${publicId}">` };
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, mocks.baseHash, referenced));
    expect(result).toEqual({ version: 5 });
    expect(mocks.assetUpdates).toEqual([{
      filter: tenantFilter("axion", { publicId }),
      update: { $inc: { referenceRevision: 1 } },
      options: { session: { transaction: true } },
    }]);
  });

  it("aborts publication when a referenced asset is missing or belongs to another tenant", async () => {
    mocks.assetMatchedCount = 0;
    const referenced = { ...survey, html: `<img src="/api/assets/${"b".repeat(43)}">` };
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, mocks.baseHash, referenced));
    expect(result).toEqual({ assetUnavailable: true });
    expect(mocks.assetUpdates[0].filter).toEqual(tenantFilter("axion", { publicId: "b".repeat(43) }));
    expect(mocks.inserted).toHaveLength(0);
  });

  it("does not report a published version when its audit event cannot be stored", async () => {
    mocks.failEventInsert = true;
    await expect(withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, mocks.baseHash, survey))).rejects.toThrow("event insert failed");
    expect(mocks.insertOptions).toEqual([{ session: { transaction: true } }]);
    expect(mocks.eventOptions).toEqual([{ session: { transaction: true } }]);
  });
});
