import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ users: [] as any[], changes: [] as any[], updateError: false, unmatchedUpdate: false }));

vi.mock("../src/lib/db", () => ({
  col: {
    users: async () => ({
      findOne: async (query: Record<string, any>) => store.users.find((user) => {
        if (query._id) return user._id.toHexString() === query._id.toHexString();
        if (query.email) return user.email === query.email;
        return false;
      }) ?? null,
      updateOne: async (query: Record<string, any>, update: Record<string, any>) => {
        if (store.updateError) throw new Error("account write failed");
        if (store.unmatchedUpdate) return { matchedCount: 0 };
        const user = store.users.find((item) => item._id.toHexString() === query._id.toHexString()
          && (!query.email || item.email === query.email)
          && (query.authVersion?.$exists === false
            ? item.authVersion === undefined
            : query.authVersion === undefined || item.authVersion === query.authVersion));
        if (!user) return { matchedCount: 0 };
        Object.assign(user, update.$set);
        for (const key of Object.keys(update.$unset ?? {})) delete user[key];
        return { matchedCount: 1 };
      },
    }),
    emailChanges: async () => ({
      findOne: async (query: Record<string, any>) => store.changes.find((change) =>
        change.tokenHash === query.tokenHash && change.expiresAt > query.expiresAt.$gt,
      ) ?? null,
      deleteOne: async (query: Record<string, any>) => {
        const index = store.changes.findIndex((change) => change._id.toHexString() === query._id.toHexString()
          && (!query.tokenHash || change.tokenHash === query.tokenHash)
          && (!query.expiresAt || change.expiresAt > query.expiresAt.$gt));
        if (index < 0) return { deletedCount: 0 };
        store.changes.splice(index, 1);
        return { deletedCount: 1 };
      },
    }),
  },
}));

import { completeEmailChange } from "../src/lib/repo/accounts";

describe("email verification links", () => {
  beforeEach(() => {
    store.users.splice(0);
    store.changes.splice(0);
    store.updateError = false;
    store.unmatchedUpdate = false;
  });

  function seed(token: string) {
    const userId = new ObjectId();
    const tokenHash = createHash("sha256").update(token).digest("hex");
    store.users.push({ _id: userId, email: "owner@old.example", passwordHash: "unused" });
    store.changes.push({
      _id: new ObjectId(), userId, email: "owner@new.example", tokenHash,
      createdAt: new Date(), expiresAt: new Date(Date.now() + 60_000),
    });
  }

  it("consumes a valid email link once", async () => {
    const token = "one-time-email-token";
    seed(token);

    await expect(completeEmailChange(token)).resolves.toEqual({ ok: true, email: "owner@new.example", previousEmail: "owner@old.example" });
    await expect(completeEmailChange(token)).resolves.toMatchObject({ ok: false });
    expect(store.users[0].email).toBe("owner@new.example");
    expect(store.users[0].emailVerifiedAt).toBeInstanceOf(Date);
    expect(store.users[0].authVersion).toBe(1);
    expect(store.changes).toHaveLength(0);
  });

  it("allows only one of two simultaneous requests to consume a link", async () => {
    const token = "parallel-email-token";
    seed(token);

    const results = await Promise.all([completeEmailChange(token), completeEmailChange(token)]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(store.users[0].email).toBe("owner@new.example");
    expect(store.changes).toHaveLength(0);
  });

  it("keeps the link retryable when the account write fails", async () => {
    const token = "retryable-email-token";
    seed(token);
    store.updateError = true;

    await expect(completeEmailChange(token)).rejects.toThrow("account write failed");
    expect(store.changes).toHaveLength(1);
    expect(store.users[0].email).toBe("owner@old.example");

    store.updateError = false;
    await expect(completeEmailChange(token)).resolves.toEqual({ ok: true, email: "owner@new.example", previousEmail: "owner@old.example" });
    expect(store.changes).toHaveLength(0);
  });

  it("does not consume the link or report success when the account compare-and-set fails", async () => {
    const token = "unmatched-email-token";
    seed(token);
    store.unmatchedUpdate = true;

    await expect(completeEmailChange(token)).resolves.toMatchObject({ ok: false });
    expect(store.changes).toHaveLength(1);
    expect(store.users[0].email).toBe("owner@old.example");

    store.unmatchedUpdate = false;
    await expect(completeEmailChange(token)).resolves.toEqual({ ok: true, email: "owner@new.example", previousEmail: "owner@old.example" });
    expect(store.changes).toHaveLength(0);
  });
});
