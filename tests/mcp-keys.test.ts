import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";

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
  capabilities?: unknown;
  revokedAt?: Date;
  expiresAt?: Date;
  lastUsedAt?: Date;
}

const docs: Doc[] = [];
const eventRows: Record<string, unknown>[] = [];
const rateBuckets = new Map<string, { count: number }>();
const lookups = vi.fn();
const activeTenants = new Set<string>();

vi.mock("../src/lib/db", () => ({
  col: {
    tenants: async () => ({
      findOne: async (query: { _id: string; status: string }) => activeTenants.has(query._id) && query.status === "active" ? { _id: query._id } : null,
    }),
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
    events: async () => ({
      insertOne: async (row: Record<string, unknown>) => { eventRows.push(row); return { insertedId: row._id }; },
    }),
    rateLimits: async () => ({
      findOneAndUpdate: async (query: { _id: string }) => {
        const bucket = rateBuckets.get(query._id) ?? { count: 0 };
        bucket.count += 1;
        rateBuckets.set(query._id, bucket);
        return bucket;
      },
    }),
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

function callTool(token: string, name: string, args: Record<string, unknown>) {
  return handleMcp(new Request("https://kqa.example/api/mcp", {
    method: "POST",
    headers: { accept: "application/json, text/event-stream", "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } }),
  }));
}

describe("API keys as MCP credentials", () => {
  beforeEach(() => {
    docs.splice(0, docs.length);
    eventRows.splice(0, eventRows.length);
    rateBuckets.clear();
    lookups.mockClear();
    activeTenants.clear();
    activeTenants.add("axion");
    activeTenants.add("tenant-1");
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

  it("records safe API-key and service-token identities in MCP activity", async () => {
    const secret = generateKeySecret();
    const created = await withTenantPrincipal({ tenantId: "axion", role: "owner", email: "admin@axiob.local", userId: "000000000000000000000001", source: "session" }, () => createApiKey({ name: "Reporting agent", secret, createdBy: "admin@axiob.local" }));
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await callTool(secret, "get_design_guidance", { surface: "analytics" });
    const apiEvent = eventRows.at(-1) as { meta: Record<string, unknown> };
    expect(apiEvent.meta.actor).toEqual({ kind: "api_key", id: created.key.id, name: "Reporting agent" });
    expect(JSON.stringify(apiEvent)).not.toContain(secret);

    await callTool(process.env.KQA_MCP_TOKEN!, "get_design_guidance", { surface: "analytics" });
    const serviceEvent = eventRows.at(-1) as { meta: Record<string, unknown> };
    expect(serviceEvent.meta.actor).toEqual({ kind: "service_token", id: "axion-service-token", name: "Axion MCP service token" });
    expect(JSON.stringify(serviceEvent)).not.toContain(process.env.KQA_MCP_TOKEN!);
  });

  it("refuses a key value that copies the server token", async () => {
    const created = await withTenantPrincipal({ tenantId: "axion", role: "owner", email: "admin@axiob.local", userId: "000000000000000000000001", source: "session" }, () => createApiKey({ name: "Same", secret: process.env.KQA_MCP_TOKEN!, createdBy: "admin@axiob.local" }));
    expect(created.ok).toBe(false);
  });

  it("rejects tenant-bound credentials when the tenant is suspended", async () => {
    await withTenantPrincipal({ tenantId: "tenant-1", role: "owner", email: "owner@example.com", userId: "000000000000000000000002", source: "session" }, async () => {
      const secret = generateKeySecret();
      const created = await createApiKey({ name: "Tenant key", secret, createdBy: "owner@example.com" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;

      expect((await post(secret)).status).toBe(200);
      activeTenants.delete("tenant-1");
      expect((await post(secret)).status).toBe(401);
      expect((await post(process.env.KQA_MCP_TOKEN!)).status).toBe(200);

      activeTenants.delete("axion");
      expect((await post(process.env.KQA_MCP_TOKEN!)).status).toBe(401);
    });
  });

  it("limits new keys in tools/list and rechecks permissions at call time", async () => {
    await withTenantPrincipal({ tenantId: "axion", role: "owner", email: "admin@axiob.local", userId: "000000000000000000000001", source: "session" }, async () => {
      const secret = generateKeySecret();
      const created = await createApiKey({ name: "Read-only agent", secret, createdBy: "admin@axiob.local" });
      expect(created.ok).toBe(true);
      if (!created.ok) return;
      expect(created.key.capabilities).toEqual(["interviews:read", "analytics:read"]);

      const listed = await (await post(secret)).json() as { result: { tools: { name: string }[] } };
      const names = listed.result.tools.map((tool) => tool.name);
      expect(names).toContain("list_interviews");
      expect(names).toContain("analyze_answers");
      expect(names).not.toContain("get_answers");
      expect(names).not.toContain("send_invite");
      expect(names).not.toContain("delete_interview");

      for (const [name, args] of [
        ["send_invite", { personId: new ObjectId().toHexString() }],
        ["delete_interview", { interviewId: new ObjectId().toHexString(), confirmName: "Interview" }],
      ] as const) {
        const response = await callTool(secret, name, args);
        const body = await response.json() as { result: { isError?: boolean; structuredContent?: { code?: string } } };
        expect(body.result.isError).toBe(true);
        expect(body.result.structuredContent?.code).toBe("forbidden");
      }

      const changed = await updateApiKey(created.key.id, { capabilities: ["interviews:delete"] });
      expect(changed.ok && changed.key.capabilities).toEqual(["interviews:delete"]);
      const narrowedList = await (await post(secret)).json() as { result: { tools: { name: string }[] } };
      expect(narrowedList.result.tools.map((tool) => tool.name)).toEqual(["delete_interview"]);
    });
  });

  it("retains full access for a legacy key with no stored capability field", async () => {
    const { hashKey } = await import("../src/lib/repo/keys");
    const secret = generateKeySecret();
    docs.push({
      _id: new ObjectId(), tenantId: "axion", hash: hashKey(secret), name: "Legacy", prefix: secret.slice(0, 12), suffix: secret.slice(-4),
      createdAt: new Date(), createdBy: "admin@axiob.local",
    });
    const response = await post(secret);
    const body = await response.json() as { result: { tools: { name: string }[] } };
    expect(body.result.tools.map((tool) => tool.name)).toContain("delete_interview");
    expect(body.result.tools.map((tool) => tool.name)).toContain("send_invite");
  });

  it("fails closed when a stored capability list is malformed", async () => {
    const { hashKey } = await import("../src/lib/repo/keys");
    const secret = generateKeySecret();
    docs.push({
      _id: new ObjectId(), tenantId: "axion", hash: hashKey(secret), name: "Corrupt", prefix: secret.slice(0, 12), suffix: secret.slice(-4),
      createdAt: new Date(), createdBy: "admin@axiob.local", capabilities: ["analytics:read", "unknown:all"],
    });
    const response = await post(secret);
    const body = await response.json() as { result: { tools: { name: string }[] } };
    expect(body.result.tools).toEqual([]);
  });
});
