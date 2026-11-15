import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  currentVersion: 4,
  baseHash: "c".repeat(64),
  modifiedCount: 1,
  inserted: [] as Record<string, unknown>[],
  deleted: [] as Record<string, unknown>[],
  updateOne: vi.fn(async () => ({ modifiedCount: 1 })),
}));

vi.mock("../src/lib/db", () => ({
  col: {
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
      insertOne: async (row: Record<string, unknown>) => { mocks.inserted.push(row); },
      deleteOne: async (filter: Record<string, unknown>) => { mocks.deleted.push(filter); },
    }),
    events: async () => ({ insertOne: async () => ({}) }),
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
  mocks.deleted.length = 0;
  mocks.updateOne.mockReset().mockImplementation(async () => ({ modifiedCount: mocks.modifiedCount }));
});

describe("publishVersionIfCurrent", () => {
  it("adds the next immutable version and advances the head with a version compare-and-swap", async () => {
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, mocks.baseHash, survey));
    expect(result).toEqual({ version: 5 });
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.inserted[0]).toMatchObject({ version: 5, html: survey.html, htmlSha256: expect.any(String) });
    expect(mocks.updateOne).toHaveBeenCalledWith(
      tenantFilter("axion", { _id: expect.any(ObjectId), currentVersion: 4 }),
      { $set: { currentVersion: 5, updatedAt: expect.any(Date) } },
    );
  });

  it("removes the uncommitted version when another publisher wins the compare-and-swap", async () => {
    mocks.modifiedCount = 0;
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, mocks.baseHash, survey));
    expect(result).toEqual({ conflict: true });
    expect(mocks.inserted).toHaveLength(1);
    expect(mocks.deleted).toEqual([tenantFilter("axion", { _id: mocks.inserted[0]._id })]);
  });

  it("rejects a stale base hash before inserting a version", async () => {
    const result = await withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, () => publishVersionIfCurrent(interviewId, 4, "d".repeat(64), survey));
    expect(result).toEqual({ conflict: true });
    expect(mocks.inserted).toHaveLength(0);
    expect(mocks.updateOne).not.toHaveBeenCalled();
  });
});
