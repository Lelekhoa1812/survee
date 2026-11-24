import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  participant: null as Record<string, any> | null,
  operations: [] as Array<Record<string, any>>,
  pendingInvite: false,
  transactionTail: null as Promise<void> | null,
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: async (work: (session: unknown) => Promise<unknown>) => {
    const previous = mocks.transactionTail ?? Promise.resolve();
    let release!: () => void;
    mocks.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try { return await work({ transaction: true }); } finally { release(); }
  },
  col: {
    participants: async () => ({
      findOne: async () => mocks.participant ? { ...mocks.participant } : null,
      findOneAndUpdate: async (_filter: unknown, update: Record<string, any>) => {
        if (!mocks.participant) return null;
        Object.assign(mocks.participant, update.$set ?? {});
        for (const key of Object.keys(update.$unset ?? {})) delete mocks.participant[key];
        return { ...mocks.participant };
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
    interviews: async () => ({ updateOne: async () => ({ matchedCount: 1 }) }),
    events: async () => ({ insertOne: async () => ({}) }),
    mail: async () => ({ findOne: async () => mocks.pendingInvite ? { _id: new ObjectId() } : null }),
  },
}));

vi.mock("../src/lib/tenant-context", () => ({
  currentTenantId: async () => "workspace-1",
  currentPrincipal: () => null,
  tenantFilter: (_tenant: string, filter: Record<string, unknown>) => filter,
}));

import { getUpdatePersonOperation, updateParticipantWithOperation } from "../src/lib/repo";

const personId = "123456789012345678901234";
const operation = { operationId: "update-person-1", credentialId: "api_key:key-a", argumentDigest: "digest-a" };
const patch = { name: "Grace Hopper", email: "grace@example.com", note: "updated" };
const update = (args = operation, changes: { name?: string; email?: string | null; note?: string | null } = patch) => updateParticipantWithOperation(personId, changes, args);

beforeEach(() => {
  mocks.participant = {
    _id: new ObjectId(personId), interviewId: new ObjectId("234567890123456789012345"), tenantId: "workspace-1",
    token: "private-token", name: "Ada", email: "ada@example.com", note: "old", status: "invited", answers: {}, revision: 0,
    createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
  };
  mocks.operations.length = 0;
  mocks.pendingInvite = false;
  mocks.transactionTail = null;
});

describe("updateParticipantWithOperation", () => {
  it("commits the profile change and exact result together, then replays after a lost response", async () => {
    const first = await update();
    expect(first).toMatchObject({ kind: "updated", person: { name: "Grace Hopper", email: "grace@example.com", note: "updated" } });
    expect(await update()).toEqual({ kind: "replayed", person: first.kind === "updated" ? first.person : null });
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.operations[0]).toMatchObject({ tool: "update_person", participantIds: [new ObjectId(personId)], result: { person: first.kind === "updated" ? first.person : null }, expiresAt: expect.any(Date) });
    expect(await getUpdatePersonOperation(operation)).toEqual({ kind: "replayed", person: first.kind === "updated" ? first.person : null });
  });

  it("rejects changed arguments and serializes concurrent identical retries", async () => {
    await update();
    expect(await update({ ...operation, argumentDigest: "different" })).toEqual({ kind: "conflict" });
    mocks.participant!.name = "Ada";
    mocks.operations.length = 0;
    const results = await Promise.all([update(), update()]);
    expect(results.map((result) => result.kind).sort()).toEqual(["replayed", "updated"]);
    expect(mocks.operations).toHaveLength(1);
  });

  it("keeps email changes blocked by unresolved invite attempts without retaining a result", async () => {
    mocks.pendingInvite = true;
    expect(await update(operation, { email: "new@example.com" })).toEqual({ kind: "invite_pending" });
    expect(mocks.operations).toHaveLength(0);
    expect(mocks.participant?.email).toBe("ada@example.com");
  });
});
