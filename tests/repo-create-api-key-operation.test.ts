import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  function matches(row: Record<string, any>, filter: Record<string, any>): boolean {
    if (Array.isArray(filter.$and)) return filter.$and.every((part) => matches(row, part));
    if (Array.isArray(filter.$or)) return filter.$or.some((part) => matches(row, part));
    return Object.entries(filter).every(([key, value]) => {
      if (key === "_id") return row._id?.toString() === value?.toString();
      if (key === "result.keyId") return row.result?.keyId === value;
      if (value && typeof value === "object" && "$exists" in value) return value.$exists ? row[key] !== undefined : row[key] === undefined;
      return row[key] === value;
    });
  }
  return {
    keys: [] as Array<Record<string, any>>,
    operations: [] as Array<Record<string, any>>,
    withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work({ transaction: true })),
    matches,
  };
});

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    apiKeys: async () => ({
      insertOne: async (doc: Record<string, any>) => {
        if (mocks.keys.some((row) => row.hash === doc.hash)) {
          throw Object.assign(new Error("E11000 duplicate key error collection: api_keys index: hash_unique"), { code: 11000, keyPattern: { hash: 1 } });
        }
        mocks.keys.push(doc);
        return { insertedId: doc._id };
      },
      findOne: async (filter: Record<string, any>) => mocks.keys.find((row) => mocks.matches(row, filter)) ?? null,
      deleteOne: async (filter: Record<string, any>) => {
        const index = mocks.keys.findIndex((row) => mocks.matches(row, filter));
        if (index < 0) return { deletedCount: 0 };
        mocks.keys.splice(index, 1);
        return { deletedCount: 1 };
      },
    }),
    mcpOperations: async () => ({
      findOne: async (filter: Record<string, unknown>) => mocks.operations.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) ?? null,
      deleteOne: async (filter: { _id: unknown }) => { const i = mocks.operations.findIndex((row) => row._id === filter._id); if (i >= 0) mocks.operations.splice(i, 1); return { deletedCount: i >= 0 ? 1 : 0 }; },
      insertOne: async (row: Record<string, unknown>) => { mocks.operations.push(row); return { insertedId: row._id }; },
      updateMany: async (filter: Record<string, unknown>, update: { $set?: Record<string, unknown> }) => {
        let modified = 0;
        for (const row of mocks.operations) {
          const matches = mocks.matches(row, filter);
          if (!matches) continue;
          Object.assign(row, update.$set);
          modified += 1;
        }
        return { matchedCount: modified, modifiedCount: modified };
      },
    }),
  },
}));

import { createApiKeyWithOperation, deleteApiKey } from "../src/lib/repo/keys";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const secret = `kqa_${"s".repeat(43)}`;
const operation = { operationId: "key-operation-1", credentialId: "host:user-1", argumentDigest: "digest-1" };
const input = { name: "Reporter", note: "weekly", secret, createdBy: "owner@example.test", capabilities: ["interviews:read"] as any };

beforeEach(() => {
  mocks.keys.length = 0;
  mocks.operations.length = 0;
  mocks.withMongoTransaction.mockClear();
});

describe("host API key creation operation", () => {
  it("creates one key with a seven-day secret-free receipt and replays it", async () => {
    const first = await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => createApiKeyWithOperation(input, operation));
    expect(first.kind).toBe("created");
    expect(mocks.keys).toHaveLength(1);
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.operations[0]).toMatchObject({ tool: "host_create_api_key", tenantId: "tenant-1", result: { keyId: mocks.keys[0]._id.toHexString() } });
    expect(JSON.stringify(mocks.operations[0])).not.toContain(secret);
    expect(mocks.operations[0].expiresAt.getTime() - mocks.operations[0].createdAt.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

    const replay = await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => createApiKeyWithOperation(input, operation));
    expect(replay).toMatchObject({ kind: "replayed", key: { id: (first as any).key.id } });
    expect(mocks.keys).toHaveLength(1);
  });

  it("conflicts on changed arguments and reports a deleted key as unavailable", async () => {
    await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => createApiKeyWithOperation(input, operation));
    const changed = await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => createApiKeyWithOperation({ ...input, name: "Changed" }, { ...operation, argumentDigest: "different" }));
    expect(changed).toEqual({ kind: "conflict" });
    mocks.keys.length = 0;
    const deleted = await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => createApiKeyWithOperation(input, operation));
    expect(deleted).toEqual({ kind: "unavailable" });
  });

  it("erases the deleted key id from the receipt and still blocks a replacement", async () => {
    const first = await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => createApiKeyWithOperation(input, operation));
    expect(first.kind).toBe("created");
    if (first.kind !== "created") return;
    expect(await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => deleteApiKey(first.key.id))).toEqual({ ok: true });
    expect(mocks.keys).toHaveLength(0);
    expect(JSON.stringify(mocks.operations[0])).not.toContain(first.key.id);
    expect(mocks.operations[0].argumentDigest).toBe(operation.argumentDigest);
    const replay = await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => createApiKeyWithOperation(input, operation));
    expect(replay).toEqual({ kind: "unavailable" });
    expect(mocks.keys).toHaveLength(0);
  });

  it("returns a validation error when a new operation reuses an existing secret", async () => {
    const first = await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => createApiKeyWithOperation(input, operation));
    expect(first.kind).toBe("created");
    const duplicate = await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: input.createdBy, userId: "user-1", source: "session" }, () => createApiKeyWithOperation(input, { ...operation, operationId: "key-operation-2" }));
    expect(duplicate).toEqual({ kind: "invalid", error: "A key with that value already exists." });
    expect(mocks.keys).toHaveLength(1);
    expect(mocks.operations).toHaveLength(1);
  });
});
