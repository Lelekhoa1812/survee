import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  users: [] as any[],
  tenants: [] as any[],
  memberships: [] as any[],
  failMembershipInsert: false,
  failUserDelete: false,
  beforeMembershipInsert: null as null | (() => Promise<void>),
}));

vi.mock("../src/lib/db", () => ({
  col: {
    users: async () => ({
      findOne: async (query: Record<string, any>) => store.users.find((user) => query.email ? user.email === query.email : user._id.toHexString() === query._id.toHexString()) ?? null,
      insertOne: async (user: any) => {
        if (store.users.some((item) => item.email === user.email || item._id.toHexString() === user._id.toHexString())) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        store.users.push(user);
        return { insertedId: user._id };
      },
      updateOne: async (query: Record<string, any>, update: Record<string, any>) => {
        const user = store.users.find((item) => item._id.toHexString() === query._id.toHexString());
        if (!user) return { matchedCount: 0, modifiedCount: 0 };
        Object.assign(user, update.$set);
        return { matchedCount: 1, modifiedCount: 1 };
      },
      deleteOne: async (query: Record<string, any>) => {
        if (store.failUserDelete) throw new Error("user rollback failed");
        const index = store.users.findIndex((user) => user._id.toHexString() === query._id.toHexString());
        if (index === -1) return { deletedCount: 0 };
        store.users.splice(index, 1);
        return { deletedCount: 1 };
      },
    }),
    tenants: async () => ({
      findOne: async (query: Record<string, any>) => store.tenants.find((tenant) => tenant._id === query._id && (!query.status || tenant.status === query.status)) ?? null,
      find: (query: Record<string, any>) => ({ toArray: async () => store.tenants.filter((tenant) => query._id.$in.includes(tenant._id) && tenant.status === query.status) }),
      updateOne: async (query: Record<string, any>, update: Record<string, any>, options: Record<string, any>) => {
        if (!store.tenants.some((tenant) => tenant._id === query._id) && options.upsert) store.tenants.push(update.$setOnInsert);
        return { matchedCount: 1 };
      },
    }),
    memberships: async () => ({
      insertOne: async (membership: any) => {
        if (store.beforeMembershipInsert) await store.beforeMembershipInsert();
        if (store.failMembershipInsert) throw new Error("membership write failed");
        if (store.memberships.some((item) => item.tenantId === membership.tenantId && item.userId.toHexString() === membership.userId.toHexString())) {
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        store.memberships.push(membership);
        return { insertedId: membership._id };
      },
      findOne: async (query: Record<string, any>) => store.memberships.find((membership) =>
        (!query.userId || membership.userId.toHexString() === query.userId.toHexString())
        && (!query.tenantId || membership.tenantId === query.tenantId)
        && (!query.role || membership.role === query.role),
      ) ?? null,
      find: (query: Record<string, any>) => ({
        sort() { return this; },
        toArray: async () => store.memberships.filter((membership) => membership.userId.toHexString() === query.userId.toHexString()),
      }),
    }),
  },
}));

import { authenticateAccount, bootstrapLegacyAxionOwner, hashPassword, verifyPassword } from "../src/lib/repo/accounts";
import { col } from "../src/lib/db";

describe("legacy Axion owner bootstrap", () => {
  beforeEach(() => {
    store.users.splice(0);
    store.tenants.splice(0);
    store.memberships.splice(0);
    store.failMembershipInsert = false;
    store.failUserDelete = false;
    store.beforeMembershipInsert = null;
    vi.stubEnv("ADMIN_EMAIL", "admin@axion.local");
    vi.stubEnv("ADMIN_PASSWORD", "a legacy host password");
    vi.stubEnv("SESSION_SECRET", "a local session secret with enough length");
  });

  afterEach(() => vi.unstubAllEnvs());

  it("maps the configured legacy login to the confirmed Axion owner identity", async () => {
    const bootstrapped = await bootstrapLegacyAxionOwner("admin@axion.local", "a legacy host password");
    expect(bootstrapped).toMatchObject({ tenantId: "axion", tenantName: "Axion", email: "admin@axiob.local", role: "owner", legacyBootstrap: true });
    expect(store.users).toHaveLength(1);
    expect(store.tenants).toHaveLength(1);
    expect(store.memberships).toHaveLength(1);
    expect(store.users[0].email).toBe("admin@axiob.local");
    expect(await verifyPassword("a legacy host password", store.users[0].passwordHash)).toBe(true);
    expect(store.memberships[0].userId.toHexString()).toBe(store.users[0]._id.toHexString());
    expect(await (await col.users()).findOne({ email: "admin@axiob.local" })).not.toBeNull();
    expect(await (await col.memberships()).findOne({ userId: store.users[0]._id, tenantId: "axion" })).not.toBeNull();
    expect(await (await col.tenants()).findOne({ _id: "axion", status: "active" })).not.toBeNull();
    expect(store.users[0].legacyBootstrap).toBe(true);
    expect(await verifyPassword("a legacy host password", store.users[0].passwordHash)).toBe(true);
    await expect(authenticateAccount("admin@axiob.local", "a legacy host password")).resolves.toMatchObject({ tenantId: "axion", email: "admin@axiob.local" });
    await expect(authenticateAccount("admin@axion.local", "a legacy host password")).resolves.toBeNull();
  });

  it("requires the configured legacy password and does not create an account for other identities", async () => {
    await expect(bootstrapLegacyAxionOwner("unrelated@example.com", "a legacy host password")).resolves.toBeNull();
    await expect(bootstrapLegacyAxionOwner("admin@axiob.local", "wrong password")).resolves.toBeNull();
    expect(store.users).toHaveLength(0);
    expect(store.memberships).toHaveLength(0);
    expect(store.tenants).toHaveLength(0);
  });

  it("repairs a partial owner bootstrap after membership insertion fails", async () => {
    store.failMembershipInsert = true;
    store.failUserDelete = true;
    await expect(bootstrapLegacyAxionOwner("admin@axiob.local", "a legacy host password")).rejects.toThrow("membership write failed");
    expect(store.users).toHaveLength(1);
    expect(store.tenants).toHaveLength(1);
    expect(store.memberships).toHaveLength(0);

    store.failMembershipInsert = false;
    store.failUserDelete = false;
    const retried = await bootstrapLegacyAxionOwner("admin@axiob.local", "a legacy host password");
    expect(retried).toMatchObject({ tenantId: "axion", tenantName: "Axion", email: "admin@axiob.local", role: "owner" });
    expect(store.users).toHaveLength(1);
    expect(store.tenants).toHaveLength(1);
    expect(store.memberships).toHaveLength(1);
  });

  it("does not use the legacy credential to repair an owner account with a changed password", async () => {
    await bootstrapLegacyAxionOwner("admin@axiob.local", "a legacy host password");
    store.memberships.splice(0);
    store.users[0].passwordHash = await hashPassword("a changed password for Axion");

    await expect(bootstrapLegacyAxionOwner("admin@axiob.local", "a legacy host password")).resolves.toBeNull();
    expect(store.memberships).toHaveLength(0);
  });

  it("does not recreate the reserved legacy identity after its owner changes email", async () => {
    await bootstrapLegacyAxionOwner("admin@axiob.local", "a legacy host password");
    store.users[0].email = "owner@axion.example";
    delete store.users[0].legacyBootstrap;
    store.users[0].emailVerifiedAt = new Date();

    await expect(bootstrapLegacyAxionOwner("admin@axiob.local", "a legacy host password")).resolves.toBeNull();
    expect(store.users).toHaveLength(1);
    expect(store.memberships).toHaveLength(1);
  });

  it("lets concurrent first logins converge on one Axion owner graph", async () => {
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    store.beforeMembershipInsert = async () => {
      arrivals += 1;
      if (arrivals === 2) release();
      await barrier;
    };

    const results = await Promise.all([
      bootstrapLegacyAxionOwner("admin@axiob.local", "a legacy host password"),
      bootstrapLegacyAxionOwner("admin@axiob.local", "a legacy host password"),
    ]);

    expect(results.every(Boolean)).toBe(true);
    expect(store.users).toHaveLength(1);
    expect(store.tenants).toHaveLength(1);
    expect(store.memberships).toHaveLength(1);
  });
});
