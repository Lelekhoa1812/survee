import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ users: [] as any[], tenants: [] as any[], memberships: [] as any[] }));

vi.mock("../src/lib/db", () => ({
  col: {
    users: async () => ({
      findOne: async (query: Record<string, any>) => store.users.find((user) => query.email ? user.email === query.email : user._id.toHexString() === query._id.toHexString()) ?? null,
      insertOne: async (user: any) => { store.users.push(user); return { insertedId: user._id }; },
    }),
    tenants: async () => ({
      findOne: async (query: Record<string, any>) => store.tenants.find((tenant) => tenant._id === query._id && (!query.status || tenant.status === query.status)) ?? null,
      updateOne: async (query: Record<string, any>, update: Record<string, any>, options: Record<string, any>) => {
        if (!store.tenants.some((tenant) => tenant._id === query._id) && options.upsert) store.tenants.push(update.$setOnInsert);
        return { matchedCount: 1 };
      },
    }),
    memberships: async () => ({
      insertOne: async (membership: any) => { store.memberships.push(membership); return { insertedId: membership._id }; },
      findOne: async (query: Record<string, any>) => store.memberships.find((membership) => membership.userId.toHexString() === query.userId.toHexString() && (!query.tenantId || membership.tenantId === query.tenantId)) ?? null,
    }),
  },
}));

import { authenticateAccount, bootstrapLegacyAxionOwner, verifyPassword } from "../src/lib/repo/accounts";
import { col } from "../src/lib/db";

describe("legacy Axion owner bootstrap", () => {
  beforeEach(() => {
    store.users.splice(0);
    store.tenants.splice(0);
    store.memberships.splice(0);
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
});
