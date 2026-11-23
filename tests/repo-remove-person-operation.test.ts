import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participant: null as Record<string, any> | null,
  operations: [] as Array<Record<string, any>>,
  pendingInvite: false,
  transactionTail: Promise.resolve() as Promise<void>,
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: async (work: (session: unknown) => Promise<unknown>) => {
    const previous = mocks.transactionTail;
    let release!: () => void;
    mocks.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work({ transaction: true }); } finally { release(); }
  },
  col: {
    participants: async () => ({
      findOne: async () => mocks.participant ? { interviewId: mocks.participant.interviewId } : null,
      deleteOne: async () => {
        if (!mocks.participant) return { deletedCount: 0 };
        mocks.participant = null;
        return { deletedCount: 1 };
      },
    }),
    mcpOperations: async () => ({
      findOne: async (filter: Record<string, unknown>) => mocks.operations.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) ?? null,
      deleteOne: async (filter: { _id: unknown }) => {
        const index = mocks.operations.findIndex((row) => row._id === filter._id);
        if (index >= 0) mocks.operations.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
      updateMany: async (filter: Record<string, unknown>, update: Record<string, any>) => {
        if (filter.participantIds) {
          for (const row of mocks.operations.filter((candidate) => candidate.participantIds?.some((id: ObjectId) => id.equals(filter.participantIds as ObjectId)))) {
            Object.assign(row, update.$set);
            for (const key of Object.keys(update.$unset ?? {})) delete row[key];
          }
        }
        return { modifiedCount: 0 };
      },
      insertOne: async (row: Record<string, any>) => {
        if (mocks.operations.some((current) => ["tenantId", "tool", "credentialIdHash", "operationIdHash"].every((key) => current[key] === row[key]))) throw Object.assign(new Error("duplicate key"), { code: 11000 });
        mocks.operations.push(row);
        return { insertedId: row._id };
      },
    }),
    mail: async () => ({
      findOne: async () => mocks.pendingInvite ? { _id: new ObjectId() } : null,
      deleteMany: async () => ({ deletedCount: 1 }),
    }),
    interviews: async () => ({ updateOne: async () => ({ matchedCount: 1 }) }),
    questionOrderAssignments: async () => ({ deleteMany: async () => ({ deletedCount: 1 }) }),
    events: async () => ({ deleteMany: async () => ({ deletedCount: 1 }) }),
    analyticsRuns: async () => ({ deleteMany: async () => ({ deletedCount: 1 }) }),
  },
}));

vi.mock("../src/lib/tenant-context", () => ({
  currentTenantId: async () => "workspace-1",
  currentPrincipal: () => null,
  tenantFilter: (_tenant: string, filter: Record<string, unknown>) => filter,
}));

import { deleteParticipantWithOperation, getRemovePersonOperation } from "../src/lib/repo";

const personId = "123456789012345678901234";
const operation = { operationId: "remove-1", credentialId: "api_key:key-a", argumentDigest: "digest-a" };
const remove = () => deleteParticipantWithOperation(personId, operation);

beforeEach(() => {
  mocks.participant = { _id: new ObjectId(personId), interviewId: new ObjectId("234567890123456789012345") };
  mocks.operations.length = 0;
  mocks.pendingInvite = false;
  mocks.transactionTail = Promise.resolve();
});

describe("deleteParticipantWithOperation", () => {
  it("commits deletion and its success result together, then replays after a lost response", async () => {
    expect(await remove()).toEqual({ kind: "removed" });
    expect(await remove()).toEqual({ kind: "replayed" });
    expect(mocks.participant).toBeNull();
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.operations[0]).toMatchObject({ tool: "remove_person", participantIds: [new ObjectId(personId)], result: { ok: true }, expiresAt: expect.any(Date) });
    expect(await getRemovePersonOperation(operation)).toEqual({ kind: "replayed" });
  });

  it("rejects changed arguments and serializes concurrent identical retries", async () => {
    await remove();
    expect(await deleteParticipantWithOperation(personId, { ...operation, argumentDigest: "different" })).toEqual({ kind: "conflict" });
    mocks.participant = { _id: new ObjectId(personId), interviewId: new ObjectId("234567890123456789012345") };
    mocks.operations.length = 0;
    const results = await Promise.all([remove(), remove()]);
    expect(results.map(({ kind }) => kind).sort()).toEqual(["removed", "replayed"]);
    expect(mocks.operations).toHaveLength(1);
  });

  it("does not retain a removal result while an invite is pending", async () => {
    mocks.pendingInvite = true;
    expect(await remove()).toEqual({ kind: "invite_pending" });
    expect(mocks.participant).not.toBeNull();
    expect(mocks.operations).toHaveLength(0);
  });

  it("returns a tombstone after interview deletion scrubs the retained result", async () => {
    await remove();
    mocks.operations[0].deletedAt = new Date();
    mocks.operations[0].result = { deleted: true };
    expect(await getRemovePersonOperation(operation)).toEqual({ kind: "deleted" });
    expect(await remove()).toEqual({ kind: "deleted" });
  });
});
