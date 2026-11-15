import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.MONGODB_URI = "mongodb://127.0.0.1:9/kqa-tests-do-not-use";
process.env.KQA_MCP_TOKEN = "t".repeat(43);

interface Doc {
  _id: { toHexString(): string };
  tenantId?: string;
  hash: string;
  name: string;
  prefix: string;
  suffix: string;
  createdAt: Date;
  createdBy: string;
  note?: string;
  revokedAt?: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
}

const docs: Doc[] = [];
const lookups = vi.fn();

vi.mock("../src/lib/db", () => ({
  col: {
    apiKeys: async () => {
      lookups();
      return {
        findOne: async (query: Record<string, unknown>) => docs.find((doc) => matches(doc, query)) ?? null,
        insertOne: async (doc: Doc) => { docs.push(doc); return { insertedId: doc._id }; },
        updateOne: async (query: Record<string, unknown>, update: { $set?: Partial<Doc>; $unset?: Record<string, ""> }) => {
          const doc = docs.find((item) => matches(item, query));
          if (!doc) return { matchedCount: 0 };
          if (update.$set) Object.assign(doc, update.$set);
          if (update.$unset) for (const key of Object.keys(update.$unset)) delete (doc as unknown as Record<string, unknown>)[key];
          return { matchedCount: 1 };
        },
        deleteOne: async (query: Record<string, unknown>) => {
          const index = docs.findIndex((item) => matches(item, query));
          if (index < 0) return { deletedCount: 0 };
          docs.splice(index, 1);
          return { deletedCount: 1 };
        },
        find: () => ({ sort: () => ({ toArray: async () => [...docs] }) }),
      };
    },
  },
}));

function matches(doc: Doc, query: Record<string, unknown>): boolean {
  const clauses = Array.isArray(query.$and) ? query.$and as Record<string, unknown>[] : [query];
  return clauses.every((clause) => {
    if (Array.isArray(clause.$or)) {
      return (clause.$or as Record<string, unknown>[]).some((item) => item.tenantId === doc.tenantId
        || (item.tenantId && typeof item.tenantId === "object" && "$exists" in item.tenantId && doc.tenantId === undefined));
    }
    if ("hash" in clause) return doc.hash === clause.hash;
    if ("_id" in clause) return doc._id.toHexString() === (clause._id as { toHexString(): string }).toHexString();
    if ("tenantId" in clause) return doc.tenantId === clause.tenantId;
    return true;
  });
}

import { handleMcp } from "../src/lib/mcp/http";
import { createApiKey, deleteApiKey, generateKeySecret, updateApiKey } from "../src/lib/repo/keys";
import { withTenantPrincipal } from "../src/lib/tenant-context";

function post(token: string) {
  return handleMcp(new Request("https://kqa.example/api/mcp", {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  }));
}

describe("API keys as MCP credentials", () => {
  beforeEach(() => {
    docs.splice(0, docs.length);
    lookups.mockClear();
  });

  it("accepts the server token without a key lookup, and accepts, revokes, and deletes a key", async () => {
    lookups.mockClear();
    const env = await post(process.env.KQA_MCP_TOKEN!);
    expect(env.status).toBe(200);
    expect(lookups).not.toHaveBeenCalled();

    await withTenantPrincipal({ tenantId: "axion", role: "owner", email: "admin@axiob.local", userId: "000000000000000000000001", source: "session" }, async () => {
    const secret = generateKeySecret();
    const created = await createApiKey({ name: "Probe", note: "live test", secret, createdBy: "admin@axiob.local" });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.secret).toBe(secret);
    expect(created.key.prefix.length).toBeGreaterThan(0);

    const ok = await post(secret);
    expect(ok.status).toBe(200);

    const revoked = await updateApiKey(created.key.id, { revoked: true });
    expect(revoked.ok).toBe(true);
    expect((await post(secret)).status).toBe(401);

    const restored = await updateApiKey(created.key.id, { revoked: false });
    expect(restored.ok && restored.key.status).toBe("active");
    expect((await post(secret)).status).toBe(200);

    const expired = await updateApiKey(created.key.id, { expiresAt: new Date(Date.now() - 1000) });
    expect(expired.ok && expired.key.status).toBe("expired");
    expect((await post(secret)).status).toBe(401);

    await updateApiKey(created.key.id, { expiresAt: null });
    expect((await post(secret)).status).toBe(200);

    expect((await deleteApiKey(created.key.id)).ok).toBe(true);
    expect((await post(secret)).status).toBe(401);
    expect((await post(process.env.KQA_MCP_TOKEN!)).status).toBe(200);
    });
  });

  it("refuses a key value that copies the server token", async () => {
    const created = await withTenantPrincipal({ tenantId: "axion", role: "owner", email: "admin@axiob.local", userId: "000000000000000000000001", source: "session" }, () => createApiKey({ name: "Same", secret: process.env.KQA_MCP_TOKEN!, createdBy: "admin@axiob.local" }));
    expect(created.ok).toBe(false);
  });
});
