import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participantId: {} as any,
  interviewId: {} as any,
  participant: {} as Record<string, any> | null,
  records: new Map<string, Record<string, any>>(),
  insertOne: vi.fn(),
  revisionUpdates: [] as unknown[][],
  withMongoTransaction: vi.fn(),
  forceDuplicate: false,
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    participants: async () => ({ findOne: async () => mocks.participant }),
    questionOrderAssignments: async () => ({
      findOne: async (filter: Record<string, any>) => mocks.records.get(`${filter.participantId.toHexString()}:${filter.surveyVersion}`) ?? null,
      insertOne: mocks.insertOne,
    }),
    interviews: async () => ({ updateOne: async (...args: unknown[]) => { mocks.revisionUpdates.push(args); return { matchedCount: 1 }; } }),
  },
}));

import { ensureQuestionOrderAssignment } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const tenantId = "workspace-1";
const asTenant = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId, role: "service", source: "service_token" }, work);

beforeEach(() => {
  mocks.participantId = new ObjectId();
  mocks.interviewId = new ObjectId();
  mocks.participant = { _id: mocks.participantId, interviewId: mocks.interviewId, tenantId, revision: 8 };
  mocks.records.clear();
  mocks.revisionUpdates.length = 0;
  mocks.forceDuplicate = false;
  mocks.withMongoTransaction.mockReset().mockImplementation(async (work: (session: unknown) => Promise<unknown>) => {
    const result = await work({ id: "session" });
    if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
    return result;
  });
  mocks.insertOne.mockReset().mockImplementation(async (doc: Record<string, any>) => {
    const key = `${doc.participantId.toHexString()}:${doc.surveyVersion}`;
    if (mocks.forceDuplicate) {
      mocks.forceDuplicate = false;
      mocks.records.set(key, { ...doc, algorithmVersion: "stored-v1", groups: { block: ["b", "a"] }, assignedAt: new Date("2026-01-02T00:00:00.000Z") });
      throw Object.assign(new Error("duplicate"), { code: 11000 });
    }
    if (mocks.records.has(key)) throw Object.assign(new Error("duplicate"), { code: 11000 });
    mocks.records.set(key, doc);
    return { acknowledged: true };
  });
});

describe("versioned question-order persistence", () => {
  const input = (surveyVersion: number, groups: Record<string, string[]>) => ({
    tenantId, interviewId: mocks.interviewId.toHexString(), participantId: mocks.participantId.toHexString(),
    surveyVersion, algorithmVersion: "kqa-question-order-v1", groups,
  });

  it("stores one immutable assignment per participant and survey version and advances the export revision", async () => {
    const first = await asTenant(() => ensureQuestionOrderAssignment(input(3, { block: ["a", "b"] })));
    const nextVersion = await asTenant(() => ensureQuestionOrderAssignment(input(4, { block: ["b", "a"] })));
    expect(first).toMatchObject({ surveyVersion: 3, algorithmVersion: "kqa-question-order-v1", groups: { block: ["a", "b"] } });
    expect(nextVersion).toMatchObject({ surveyVersion: 4, groups: { block: ["b", "a"] } });
    expect(mocks.records.size).toBe(2);
    expect(mocks.participant?.revision).toBe(8);
    expect(mocks.revisionUpdates).toHaveLength(2);
    expect(mocks.revisionUpdates[0][1]).toEqual({ $inc: { respondentWriteRevision: 1 } });
    expect(mocks.revisionUpdates[0][2]).toEqual({ session: { id: "session" } });
  });

  it("returns the saved winner after a concurrent first-load insert", async () => {
    mocks.forceDuplicate = true;
    const stored = await asTenant(() => ensureQuestionOrderAssignment(input(3, { block: ["a", "b"] })));
    expect(stored).toMatchObject({ surveyVersion: 3, algorithmVersion: "stored-v1", groups: { block: ["b", "a"] } });
    expect(mocks.revisionUpdates).toHaveLength(0);
  });

  it("does not create presentation data for a participant deleted before assignment", async () => {
    mocks.participant = null;
    await expect(asTenant(() => ensureQuestionOrderAssignment(input(3, { block: ["a", "b"] })))).rejects.toThrow("deleted participant");
    expect(mocks.records.size).toBe(0);
  });
});
