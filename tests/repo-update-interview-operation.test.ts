import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interview: { _id: null as unknown, name: "Old name", description: "Old notes", status: "open", respondentWriteRevision: 0 } as Record<string, any>,
  operations: [] as Array<Record<string, any>>,
  events: [] as Array<Record<string, any>>,
  writes: 0,
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
    interviews: async () => ({
      findOne: async () => ({ ...mocks.interview }),
      findOneAndUpdate: async (_filter: unknown, update: { $set: Record<string, unknown>; $unset?: Record<string, unknown>; $inc: Record<string, number> }) => {
        mocks.writes += 1;
        Object.assign(mocks.interview, update.$set);
        for (const key of Object.keys(update.$unset ?? {})) delete mocks.interview[key];
        for (const [key, value] of Object.entries(update.$inc)) mocks.interview[key] = Number(mocks.interview[key] ?? 0) + value;
        return { ...mocks.interview };
      },
    }),
    mcpOperations: async () => ({
      findOne: async (filter: Record<string, unknown>) => mocks.operations.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) ?? null,
      deleteOne: async (filter: { _id: unknown }) => {
        const index = mocks.operations.findIndex((row) => row._id === filter._id);
        if (index >= 0) mocks.operations.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
      insertOne: async (row: Record<string, unknown>) => {
        if (mocks.operations.some((current) => ["tenantId", "tool", "credentialIdHash", "operationIdHash"].every((key) => current[key] === row[key]))) throw Object.assign(new Error("duplicate key"), { code: 11000 });
        mocks.operations.push(row);
        return { insertedId: row._id };
      },
    }),
    events: async () => ({ insertOne: async (row: Record<string, unknown>) => { mocks.events.push(row); return { insertedId: row._id }; } }),
  },
}));

vi.mock("../src/lib/tenant-context", () => ({
  currentTenantId: async () => "workspace-1",
  currentPrincipal: () => null,
  tenantFilter: (_tenant: string, filter: Record<string, unknown>) => filter,
}));

import { getUpdateInterviewOperation, updateInterview, updateInterviewWithOperation } from "../src/lib/repo";

const id = "123456789012345678901234";
const operation = { operationId: "update-1", credentialId: "api_key:key-a", argumentDigest: "digest-a" };
const update = () => updateInterviewWithOperation(id, { name: "New name", status: "closed" }, operation);

beforeEach(() => {
  mocks.interview = { _id: new ObjectId(id), name: "Old name", description: "Old notes", status: "open", respondentWriteRevision: 0 };
  mocks.operations.length = 0;
  mocks.events.length = 0;
  mocks.writes = 0;
  mocks.transactionTail = Promise.resolve();
});

describe("updateInterviewWithOperation", () => {
  it("commits the update, audit events, and exact result together, then replays", async () => {
    const first = await update();
    const replay = await update();
    expect(first).toEqual({ kind: "updated", interviewId: id });
    expect(replay).toEqual({ kind: "replayed", interviewId: id });
    expect(mocks.writes).toBe(1);
    expect(mocks.events.map((event) => event.type)).toEqual(["status", "update"]);
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.operations[0]).toMatchObject({ tool: "update_interview", tenantId: "workspace-1", interviewId: new ObjectId(id), result: { ok: true, interviewId: id }, expiresAt: expect.any(Date) });
  });

  it("rejects a different payload and serializes concurrent identical retries", async () => {
    await update();
    expect(await updateInterviewWithOperation(id, { name: "Another name" }, { ...operation, argumentDigest: "digest-b" })).toEqual({ kind: "conflict" });
    mocks.operations.length = 0;
    mocks.writes = 0;
    mocks.interview = { _id: new ObjectId(id), name: "Old name", description: "Old notes", status: "open", respondentWriteRevision: 0 };
    const results = await Promise.all([update(), update()]);
    expect(results.map(({ kind }) => kind).sort()).toEqual(["replayed", "updated"]);
    expect(mocks.writes).toBe(1);
  });

  it("does not advance revisions or create audit events for unchanged fields", async () => {
    await updateInterview(id, { name: "Old name", description: "Old notes", status: "open" });
    expect(mocks.writes).toBe(0);
    expect(mocks.events).toHaveLength(0);
  });

  it("returns an interview tombstone after deletion scrubs the retained result", async () => {
    await update();
    mocks.operations[0].deletedAt = new Date();
    mocks.operations[0].result = {};
    expect(await getUpdateInterviewOperation(operation)).toEqual({ kind: "deleted" });
  });

  it("replaces an expired operation row even before MongoDB TTL cleanup runs", async () => {
    await update();
    mocks.operations[0].expiresAt = new Date(0);
    mocks.interview = { _id: new ObjectId(id), name: "Old name", description: "Old notes", status: "open", respondentWriteRevision: 0 };
    mocks.writes = 0;
    mocks.events.length = 0;
    const result = await update();
    expect(result).toEqual({ kind: "updated", interviewId: id });
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.writes).toBe(1);
  });
});
