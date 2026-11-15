import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({
  users: [] as any[], resets: [] as any[], memberships: [] as any[], tenants: [] as any[],
  beforeUserUpdate: null as null | (() => void), failNextUserUpdate: false,
}));

vi.mock("../src/lib/db", () => ({
  col: {
    users: async () => ({
      findOne: async (query: Record<string, any>) => {
        const user = store.users.find((item) => {
          if (query._id) return item._id.toHexString() === query._id.toHexString();
          if (query.email) return item.email === query.email && (!query.emailVerifiedAt || item.emailVerifiedAt instanceof Date);
          return false;
        });
        return user ? { ...user } : null;
      },
      updateOne: async (query: Record<string, any>, update: Record<string, any>) => {
        if (store.failNextUserUpdate) {
          store.failNextUserUpdate = false;
          throw new Error("simulated database write failure");
        }
        store.beforeUserUpdate?.();
        store.beforeUserUpdate = null;
        const user = store.users.find((item) => item._id.toHexString() === query._id.toHexString()
          && (!query.emailVerifiedAt || item.emailVerifiedAt instanceof Date)
          && (!query.passwordHash || item.passwordHash === query.passwordHash)
          && (!Object.hasOwn(query, "authVersion") || (typeof query.authVersion === "object" ? item.authVersion === undefined : item.authVersion === query.authVersion)));
        if (!user) return { matchedCount: 0 };
        Object.assign(user, update.$set);
        for (const [key, value] of Object.entries(update.$inc ?? {})) user[key] = (user[key] ?? 0) + Number(value);
        return { matchedCount: 1 };
      },
    }),
    passwordResets: async () => ({
      findOne: async (query: Record<string, any>) => store.resets.find((reset) => reset.tokenHash === query.tokenHash
        && (!query.userId || reset.userId.toHexString() === query.userId.toHexString())
        && reset.expiresAt > query.expiresAt.$gt) ?? null,
      deleteMany: async (query: Record<string, any>) => {
        const before = store.resets.length;
        store.resets = store.resets.filter((reset) => reset.userId.toHexString() !== query.userId.toHexString());
        return { deletedCount: before - store.resets.length };
      },
      insertOne: async (doc: any) => { store.resets.push(doc); return { insertedId: doc._id }; },
      deleteOne: async (query: Record<string, any>) => {
        const index = store.resets.findIndex((reset) => reset._id.toHexString() === query._id.toHexString()
          && (!query.tokenHash || reset.tokenHash === query.tokenHash)
          && (!query.userId || reset.userId.toHexString() === query.userId.toHexString())
          && (!query.expiresAt || reset.expiresAt > query.expiresAt.$gt));
        if (index < 0) return { deletedCount: 0 };
        store.resets.splice(index, 1);
        return { deletedCount: 1 };
      },
    }),
    memberships: async () => ({
      findOne: async (query: Record<string, any>) => store.memberships.find((membership) => membership.userId.toHexString() === query.userId.toHexString()) ?? null,
    }),
    tenants: async () => ({
      findOne: async (query: Record<string, any>) => store.tenants.find((tenant) => tenant._id === query._id && tenant.status === query.status) ?? null,
    }),
  },
}));

import { authenticateAccount, changeAccountPassword, completePasswordReset, createPendingPasswordReset, hashPassword, verifyPassword } from "../src/lib/repo/accounts";

describe("password reset", () => {
  beforeEach(() => {
    store.users.splice(0);
    store.resets.splice(0);
    store.memberships.splice(0);
    store.tenants.splice(0);
    store.beforeUserUpdate = null;
    store.failNextUserUpdate = false;
  });

  it("creates a hashed one-time request only for a verified account", async () => {
    const userId = new ObjectId();
    store.users.push({ _id: userId, email: "owner@example.com", passwordHash: "old", emailVerifiedAt: new Date(), authVersion: 4 });
    const id = await createPendingPasswordReset({ email: " OWNER@example.com ", token: "reset-secret" });
    expect(id).toBeInstanceOf(ObjectId);
    expect(store.resets).toHaveLength(1);
    expect(store.resets[0].tokenHash).toBe(createHash("sha256").update("reset-secret").digest("hex"));
    expect(store.resets[0].authVersion).toBe(4);
    expect(JSON.stringify(store.resets)).not.toContain("reset-secret");
  });

  it("does not create a reset for the unverified legacy Axion address", async () => {
    store.users.push({ _id: new ObjectId(), email: "admin@axiob.local", passwordHash: "legacy", legacyBootstrap: true });

    await expect(createPendingPasswordReset({ email: "admin@axiob.local", token: "unusable-reset" })).resolves.toBeNull();
    expect(store.resets).toHaveLength(0);
  });

  it("accepts a temporary password once for two hours without changing the saved password", async () => {
    const userId = new ObjectId();
    const passwordHash = await hashPassword("saved account password long enough");
    const token = "temporary-sign-in-password";
    store.users.push({ _id: userId, email: "owner@example.com", passwordHash, emailVerifiedAt: new Date(), authVersion: 2 });
    store.memberships.push({ _id: new ObjectId(), userId, tenantId: "tenant-1", role: "owner" });
    store.tenants.push({ _id: "tenant-1", name: "Example", status: "active" });

    const id = await createPendingPasswordReset({ email: "owner@example.com", token });
    expect(id).toBeInstanceOf(ObjectId);
    expect(store.resets[0].expiresAt.getTime() - store.resets[0].createdAt.getTime()).toBe(2 * 60 * 60 * 1000);
    await expect(authenticateAccount("owner@example.com", token)).resolves.toMatchObject({ email: "owner@example.com", tenantName: "Example" });
    await expect(authenticateAccount("owner@example.com", token)).resolves.toBeNull();
    expect(store.users[0].passwordHash).toBe(passwordHash);
    expect(store.resets).toHaveLength(0);
  });

  it("changes the password once and increments the version used to invalidate sessions", async () => {
    const userId = new ObjectId();
    const oldHash = await hashPassword("previous password long enough");
    const token = "single-use-reset";
    store.users.push({ _id: userId, email: "owner@example.com", passwordHash: oldHash, emailVerifiedAt: new Date(), authVersion: 2 });
    store.resets.push({
      _id: new ObjectId(), userId, tokenHash: createHash("sha256").update(token).digest("hex"),
      authVersion: 2, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(completePasswordReset(token, "new password long enough 123")).resolves.toBe(true);
    await expect(completePasswordReset(token, "another password long enough 456")).resolves.toBe(false);
    await expect(verifyPassword("new password long enough 123", store.users[0].passwordHash)).resolves.toBe(true);
    expect(store.users[0].authVersion).toBe(3);
    expect(store.resets).toHaveLength(0);
  });

  it("completes a versioned reset for an account whose authVersion was previously absent", async () => {
    const userId = new ObjectId();
    const oldHash = await hashPassword("previous password long enough");
    const token = "legacy-version-reset";
    store.users.push({ _id: userId, email: "owner@example.com", passwordHash: oldHash, emailVerifiedAt: new Date() });
    const id = await createPendingPasswordReset({ email: "owner@example.com", token });
    expect(id).toBeInstanceOf(ObjectId);

    await expect(completePasswordReset(token, "legacy account new password")).resolves.toBe(true);
    expect(store.users[0].authVersion).toBe(1);
    await expect(verifyPassword("legacy account new password", store.users[0].passwordHash)).resolves.toBe(true);
  });

  it("preserves a concurrent password change and invalidates the stale reset link", async () => {
    const userId = new ObjectId();
    const oldHash = await hashPassword("previous password long enough");
    const concurrentHash = await hashPassword("concurrent password long enough");
    const token = "racing-reset";
    store.users.push({ _id: userId, email: "owner@example.com", passwordHash: oldHash, emailVerifiedAt: new Date(), authVersion: 4 });
    store.resets.push({
      _id: new ObjectId(), userId, tokenHash: createHash("sha256").update(token).digest("hex"),
      authVersion: 4, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });
    store.beforeUserUpdate = () => {
      store.users[0].passwordHash = concurrentHash;
      store.users[0].authVersion = 5;
    };

    await expect(completePasswordReset(token, "reset password long enough 123")).resolves.toBe(false);
    await expect(verifyPassword("concurrent password long enough", store.users[0].passwordHash)).resolves.toBe(true);
    expect(store.users[0].authVersion).toBe(5);
    expect(store.resets).toHaveLength(0);
  });

  it("keeps the reset link retryable when the user write fails", async () => {
    const userId = new ObjectId();
    const oldHash = await hashPassword("previous password long enough");
    const token = "retryable-reset";
    store.users.push({ _id: userId, email: "owner@example.com", passwordHash: oldHash, emailVerifiedAt: new Date(), authVersion: 2 });
    store.resets.push({
      _id: new ObjectId(), userId, tokenHash: createHash("sha256").update(token).digest("hex"),
      authVersion: 2, createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });
    store.failNextUserUpdate = true;

    await expect(completePasswordReset(token, "retryable password long enough")).rejects.toThrow("simulated database write failure");
    expect(store.resets).toHaveLength(1);
    await expect(completePasswordReset(token, "retryable password long enough")).resolves.toBe(true);
    await expect(verifyPassword("retryable password long enough", store.users[0].passwordHash)).resolves.toBe(true);
    expect(store.users[0].authVersion).toBe(3);
    expect(store.resets).toHaveLength(0);
  });

  it("changes an authenticated password once even when two changes race", async () => {
    const userId = new ObjectId();
    const oldHash = await hashPassword("previous password long enough");
    store.users.push({ _id: userId, email: "owner@example.com", passwordHash: oldHash, emailVerifiedAt: new Date(), authVersion: 4 });

    const results = await Promise.all([
      changeAccountPassword(userId.toHexString(), "previous password long enough", "first new password long enough"),
      changeAccountPassword(userId.toHexString(), "previous password long enough", "second new password long enough"),
    ]);

    expect(results.filter((version) => version !== null)).toHaveLength(1);
    expect(store.users[0].authVersion).toBe(5);
    const firstMatches = await verifyPassword("first new password long enough", store.users[0].passwordHash);
    const secondMatches = await verifyPassword("second new password long enough", store.users[0].passwordHash);
    expect(Number(firstMatches) + Number(secondMatches)).toBe(1);
  });
});
