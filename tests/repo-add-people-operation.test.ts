import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  people: [] as Array<Record<string, unknown>>,
  operations: [] as Array<Record<string, unknown>>,
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
    interviews: async () => ({ updateOne: async (filter: Record<string, unknown>) => ({ matchedCount: 1, modifiedCount: filter.mode === "single" ? 1 : 0 }) }),
    participants: async () => ({ insertMany: async (docs: Array<Record<string, unknown>>) => { mocks.people.push(...docs); return { insertedCount: docs.length }; } }),
    events: async () => ({ insertOne: async () => ({ insertedId: "event" }) }),
  },
}));

import { addParticipantsWithOperation, getAddPeopleOperation } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const args = { operationId: "batch-1", credentialId: "api_key:key-a", argumentDigest: "digest-a" };
const add = () => withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => addParticipantsWithOperation("123456789012345678901234", [{ name: "Ada" }], args));

beforeEach(() => {
  mocks.people.length = 0;
  mocks.operations.length = 0;
  mocks.transactionTail = Promise.resolve();
});

describe("addParticipantsWithOperation", () => {
  it("commits the new people and exact result in one transaction and replays it", async () => {
    const first = await add();
    const replay = await add();
    expect(first.kind).toBe("created");
    if (first.kind !== "created") throw new Error("expected add success");
    expect(replay).toEqual({ kind: "replayed", people: first.people });
    expect(mocks.people).toHaveLength(1);
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.operations[0]).toMatchObject({ tool: "add_people", tenantId: "workspace-1", result: { people: [{ name: "Ada" }] }, expiresAt: expect.any(Date) });
  });

  it("rejects a different payload and serializes concurrent identical retries", async () => {
    await add();
    const mismatch = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => addParticipantsWithOperation("123456789012345678901234", [{ name: "Grace" }], { ...args, argumentDigest: "digest-b" }));
    expect(mismatch).toEqual({ kind: "conflict" });
    mocks.operations.length = 0;
    mocks.people.length = 0;
    const concurrent = await Promise.all([add(), add()]);
    expect(concurrent.map((item) => item.kind).sort()).toEqual(["created", "replayed"]);
    expect(mocks.people).toHaveLength(1);
  });

  it("looks up a retained result without requiring the interview to remain available", async () => {
    const created = await add();
    if (created.kind !== "created") throw new Error("expected create success");
    const replay = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => getAddPeopleOperation(args));
    expect(replay).toEqual({ kind: "replayed", people: created.people });
  });

  it("keeps host REST add batches separate from MCP batches", async () => {
    const hostArgs = { ...args, credentialId: "host:user-a", tool: "host_add_people" };
    const host = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => addParticipantsWithOperation("123456789012345678901234", [{ name: "Ada" }], hostArgs));
    const mcp = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => addParticipantsWithOperation("123456789012345678901234", [{ name: "Ada" }], args));
    expect([host.kind, mcp.kind]).toEqual(["created", "created"]);
    expect(mocks.operations.map((item) => item.tool)).toEqual(["host_add_people", "add_people"]);
  });
});
