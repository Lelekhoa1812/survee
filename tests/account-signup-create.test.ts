import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPendingSignup } from "../src/lib/repo/accounts";

const store = vi.hoisted(() => ({
  users: [] as { email: string }[],
  signups: [] as any[],
  barrier: null as null | { count: number; promise: Promise<void>; release: () => void },
}));

function duplicateKeyError(): Error & { code: number } {
  return Object.assign(new Error("duplicate key"), { code: 11000 });
}

vi.mock("../src/lib/db", () => ({
  col: {
    users: async () => ({
      findOne: async (query: { email: string }) => store.users.find((user) => user.email === query.email) ?? null,
    }),
    signups: async () => ({
      deleteMany: async (query: { email: string; $or: [{ expiresAt: { $lte: Date } }, { consumedAt: { $exists: true } }] }) => {
        const before = store.signups.length;
        const cutoff = query.$or[0].expiresAt.$lte;
        for (let i = store.signups.length - 1; i >= 0; i -= 1) {
          const row = store.signups[i];
          if (row.email === query.email && (row.expiresAt <= cutoff || row.consumedAt)) store.signups.splice(i, 1);
        }
        return { deletedCount: before - store.signups.length };
      },
      findOne: async (query: { email: string; expiresAt: { $gt: Date }; consumedAt: { $exists: false } }) => {
        const barrier = store.barrier;
        if (barrier && barrier.count < 2) {
          barrier.count += 1;
          if (barrier.count === 2) barrier.release();
          await barrier.promise;
        }
        return store.signups.find((row) => row.email === query.email && row.expiresAt > query.expiresAt.$gt && !row.consumedAt) ?? null;
      },
      insertOne: async (row: any) => {
        if (store.signups.some((saved) => saved.email === row.email || saved.tokenHash === row.tokenHash)) throw duplicateKeyError();
        store.signups.push(row);
        return { insertedId: row._id };
      },
    }),
  },
}));

describe("pending signup email claims", () => {
  beforeEach(() => {
    store.users.splice(0);
    store.signups.splice(0);
    store.barrier = null;
  });

  it("lets only one concurrent request claim a normalized email", async () => {
    let release!: () => void;
    const promise = new Promise<void>((resolve) => { release = resolve; });
    store.barrier = { count: 0, promise, release };

    const [first, second] = await Promise.all([
      createPendingSignup({ email: " Person@Example.com ", password: "a sufficiently long password", tenantName: "First workspace", token: "first-token" }),
      createPendingSignup({ email: "person@example.com", password: "another sufficiently long password", tenantName: "Second workspace", token: "second-token" }),
    ]);

    expect(store.signups).toHaveLength(1);
    expect(store.signups[0].email).toBe("person@example.com");
    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect([first, second].filter((result) => !result.ok)).toEqual([{ ok: false, reason: "signup_pending" }]);
  });

  it("reclaims an expired email even before Mongo's TTL monitor runs", async () => {
    store.signups.push({ email: "person@example.com", expiresAt: new Date(Date.now() - 1), tokenHash: "old" });

    const result = await createPendingSignup({ email: "person@example.com", password: "a sufficiently long password", tenantName: "Research", token: "new-token" });

    expect(result.ok).toBe(true);
    expect(store.signups).toHaveLength(1);
    expect(store.signups[0].tokenHash).not.toBe("old");
  });

  it("does not create a pending workspace for an existing account", async () => {
    store.users.push({ email: "person@example.com" });

    const result = await createPendingSignup({ email: "person@example.com", password: "a sufficiently long password", tenantName: "Research", token: "new-token" });

    expect(result).toEqual({ ok: false, reason: "account_exists" });
    expect(store.signups).toHaveLength(0);
  });
});
