import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participant: null as Record<string, any> | null,
  interview: { respondentWriteRevision: 0 },
  operations: [] as Array<Record<string, any>>,
  events: [] as Array<Record<string, any>>,
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
      findOneAndUpdate: async (_filter: unknown, update: { $set: Record<string, unknown>; $unset: Record<string, unknown>; $inc: Record<string, number> }) => {
        if (!mocks.participant || mocks.participant.status !== "submitted") return null;
        Object.assign(mocks.participant, update.$set);
        for (const key of Object.keys(update.$unset)) delete mocks.participant[key];
        for (const [key, value] of Object.entries(update.$inc)) mocks.participant[key] = Number(mocks.participant[key] ?? 0) + value;
        return { ...mocks.participant };
      },
      findOne: async () => mocks.participant ? { _id: mocks.participant._id } : null,
    }),
    interviews: async () => ({
      updateOne: async () => {
        mocks.interview.respondentWriteRevision += 1;
        return { matchedCount: 1 };
      },
    }),
    mcpOperations: async () => ({
      findOne: async (filter: Record<string, unknown>) => mocks.operations.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) ?? null,
      deleteOne: async (filter: { _id: unknown }) => {
        const index = mocks.operations.findIndex((row) => row._id === filter._id);
        if (index >= 0) mocks.operations.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
      insertOne: async (row: Record<string, any>) => {
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

import { getReopenPersonOperation, reopenParticipantWithOperation } from "../src/lib/repo";

const id = "123456789012345678901234";
const interviewId = "234567890123456789012345";
const operation = { operationId: "reopen-1", credentialId: "api_key:key-a", argumentDigest: "digest-a" };
const reopen = () => reopenParticipantWithOperation(id, operation);

beforeEach(() => {
  mocks.participant = {
    _id: new ObjectId(id), interviewId: new ObjectId(interviewId), token: "private-token", name: "Ada Lovelace", email: "ada@example.test",
    status: "submitted", answers: { q1: { value: "yes", updatedAt: new Date("2026-11-01T00:00:00.000Z") } }, revision: 3, writeEpoch: 4,
    createdAt: new Date("2026-10-01T00:00:00.000Z"), updatedAt: new Date("2026-11-01T00:00:00.000Z"), submittedAt: new Date("2026-11-01T00:00:00.000Z"),
  };
  mocks.interview = { respondentWriteRevision: 0 };
  mocks.operations.length = 0;
  mocks.events.length = 0;
  mocks.transactionTail = Promise.resolve();
});

describe("reopenParticipantWithOperation", () => {
  it("commits the reopen and exact result once, then replays after a lost response", async () => {
    const first = await reopen();
    expect(first).toMatchObject({ kind: "reopened", person: { id, interviewId, status: "in_progress", writeEpoch: 5, submittedAt: undefined } });
    const replay = await reopen();
    expect(replay).toEqual({ kind: "replayed", person: (first as { person: unknown }).person });
    expect(mocks.participant?.status).toBe("in_progress");
    expect(mocks.interview.respondentWriteRevision).toBe(1);
    expect(mocks.events.map((event) => event.type)).toEqual(["reopen"]);
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.operations[0]).toMatchObject({
      tenantId: "workspace-1", tool: "reopen_person", interviewId: new ObjectId(interviewId), participantIds: [new ObjectId(id)],
      result: { person: { id, status: "in_progress", writeEpoch: 5 } }, expiresAt: expect.any(Date),
    });
    expect(await getReopenPersonOperation(operation)).toEqual({ kind: "replayed", person: (first as { person: unknown }).person });
  });

  it("rejects a different argument and serializes concurrent identical retries", async () => {
    await reopen();
    expect(await reopenParticipantWithOperation(id, { ...operation, argumentDigest: "different" })).toEqual({ kind: "conflict" });
    mocks.operations.length = 0;
    mocks.participant!.status = "submitted";
    mocks.interview.respondentWriteRevision = 0;
    mocks.events.length = 0;
    const concurrent = await Promise.all([reopen(), reopen()]);
    expect(concurrent.map(({ kind }) => kind).sort()).toEqual(["reopened", "replayed"]);
    expect(mocks.interview.respondentWriteRevision).toBe(1);
    expect(mocks.events).toHaveLength(1);
  });

  it("distinguishes missing and unsubmitted respondents without storing a result", async () => {
    mocks.participant = null;
    expect(await reopen()).toEqual({ kind: "not_found" });
    mocks.participant = { _id: new ObjectId(id), status: "in_progress" };
    expect(await reopen()).toEqual({ kind: "not_submitted" });
    expect(mocks.operations).toHaveLength(0);
  });

  it("returns a tombstone when participant deletion scrubs the retained result", async () => {
    await reopen();
    mocks.operations[0].deletedAt = new Date();
    mocks.operations[0].result = { deleted: true };
    expect(await getReopenPersonOperation(operation)).toEqual({ kind: "deleted" });
    expect(await reopen()).toEqual({ kind: "deleted" });
  });
});
