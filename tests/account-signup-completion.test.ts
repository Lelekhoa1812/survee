import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  signups: [] as any[],
  users: [] as any[],
  tenants: [] as any[],
  memberships: [] as any[],
  failTenantInsert: false,
  beforeUserLookup: null as null | (() => Promise<void>),
}));

function duplicateKeyError(): Error & { code: number } {
  return Object.assign(new Error("duplicate key"), { code: 11000 });
}

vi.mock("../src/lib/db", () => ({
  col: {
    signups: async () => ({
      findOne: async (query: Record<string, any>) => store.signups.find((signup) =>
        signup.tokenHash === query.tokenHash && signup.expiresAt > query.expiresAt.$gt && !signup.consumedAt,
      ) ?? null,
      updateOne: async (query: Record<string, any>, update: Record<string, any>) => {
        const signup = store.signups.find((item) => item._id.toHexString() === query._id.toHexString()
          && item.tokenHash === query.tokenHash && !item.consumedAt);
        if (!signup) return { modifiedCount: 0 };
        Object.assign(signup, update.$set);
        return { modifiedCount: 1 };
      },
    }),
    users: async () => ({
      findOne: async (query: Record<string, any>) => {
        if (query._id && store.beforeUserLookup) await store.beforeUserLookup();
        return store.users.find((user) => query._id
          ? user._id.toHexString() === query._id.toHexString()
          : query.email ? user.email === query.email : false) ?? null;
      },
      insertOne: async (user: any) => {
        if (store.users.some((item) => item._id.toHexString() === user._id.toHexString() || item.email === user.email)) throw duplicateKeyError();
        store.users.push(user);
        return { insertedId: user._id };
      },
    }),
    tenants: async () => ({
      findOne: async (query: Record<string, any>) => store.tenants.find((tenant) => tenant._id === query._id) ?? null,
      insertOne: async (tenant: any) => {
        if (store.failTenantInsert) throw new Error("tenant write failed");
        if (store.tenants.some((item) => item._id === tenant._id || item.slug === tenant.slug)) throw duplicateKeyError();
        store.tenants.push(tenant);
        return { insertedId: tenant._id };
      },
    }),
    memberships: async () => ({
      findOne: async (query: Record<string, any>) => store.memberships.find((membership) =>
        membership.tenantId === query.tenantId && membership.userId.toHexString() === query.userId.toHexString(),
      ) ?? null,
      insertOne: async (membership: any) => {
        if (store.memberships.some((item) => item.tenantId === membership.tenantId && item.userId.toHexString() === membership.userId.toHexString())) throw duplicateKeyError();
        store.memberships.push(membership);
        return { insertedId: membership._id };
      },
    }),
  },
}));

import { completeSignup } from "../src/lib/repo/accounts";

describe("signup verification completion recovery", () => {
  const token = "signup-verification-token";

  beforeEach(() => {
    store.signups.splice(0);
    store.users.splice(0);
    store.tenants.splice(0);
    store.memberships.splice(0);
    store.failTenantInsert = false;
    store.beforeUserLookup = null;

    const now = new Date();
    store.signups.push({
      _id: new ObjectId(),
      userId: new ObjectId(),
      tenantId: "workspace-test-1",
      tenantName: "Test workspace",
      tenantSlug: "test-workspace-1",
      email: "owner@example.test",
      passwordHash: "stored-scrypt-hash",
      tokenHash: createHash("sha256").update(token).digest("hex"),
      createdAt: now,
      expiresAt: new Date(now.getTime() + 60_000),
    });
  });

  it("keeps the verification link retryable when a later graph write fails", async () => {
    store.failTenantInsert = true;

    await expect(completeSignup(token)).rejects.toThrow("tenant write failed");
    expect(store.users).toHaveLength(1);
    expect(store.tenants).toHaveLength(0);
    expect(store.memberships).toHaveLength(0);
    expect(store.signups[0].consumedAt).toBeUndefined();

    store.failTenantInsert = false;
    const result = await completeSignup(token);

    expect(result).toMatchObject({ ok: true, principal: { email: "owner@example.test", tenantId: "workspace-test-1", role: "owner" } });
    expect(store.users).toHaveLength(1);
    expect(store.tenants).toHaveLength(1);
    expect(store.memberships).toHaveLength(1);
    expect(store.signups[0].consumedAt).toBeInstanceOf(Date);
  });

  it("allows only one concurrent request to activate a shared verification link", async () => {
    const pending = store.signups[0];
    store.users.push({
      _id: pending.userId,
      email: pending.email,
      passwordHash: pending.passwordHash,
      emailVerifiedAt: pending.createdAt,
      createdAt: pending.createdAt,
      updatedAt: pending.createdAt,
    });
    store.tenants.push({
      _id: pending.tenantId,
      name: pending.tenantName,
      slug: pending.tenantSlug,
      status: "active",
      createdAt: pending.createdAt,
      updatedAt: pending.createdAt,
    });
    store.memberships.push({
      _id: new ObjectId(),
      tenantId: pending.tenantId,
      userId: pending.userId,
      role: "owner",
      createdAt: pending.createdAt,
    });

    let reads = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    store.beforeUserLookup = async () => {
      reads += 1;
      if (reads === 2) release();
      await barrier;
    };

    const results = await Promise.all([completeSignup(token), completeSignup(token)]);

    expect(reads).toBe(2);
    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(store.users).toHaveLength(1);
    expect(store.tenants).toHaveLength(1);
    expect(store.memberships).toHaveLength(1);
    expect(store.signups[0].consumedAt).toBeInstanceOf(Date);
  });
});
