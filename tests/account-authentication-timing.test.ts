import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ users: [] as any[] }));

vi.mock("../src/lib/password-kdf", () => ({
  PASSWORD_HASH_BYTES: 64,
  PASSWORD_HASH_COST: 16_384,
  derivePasswordKey: vi.fn(async () => Buffer.alloc(64, 1)),
}));

vi.mock("../src/lib/db", () => ({
  col: {
    users: async () => ({
      findOne: async (query: Record<string, unknown>) => state.users.find((user) => user.email === query.email) ?? null,
    }),
  },
}));

import { authenticateAccount } from "../src/lib/repo/accounts";
import { derivePasswordKey } from "../src/lib/password-kdf";

describe("account login timing", () => {
  beforeEach(() => {
    state.users.splice(0);
    vi.mocked(derivePasswordKey).mockClear();
  });

  it("performs one password-cost derivation for both missing and existing accounts", async () => {
    state.users.push({
      email: "known@example.test",
      passwordHash: `scrypt$16384$salt$${Buffer.alloc(64, 2).toString("base64url")}`,
      emailVerifiedAt: new Date(),
    });

    let before = vi.mocked(derivePasswordKey).mock.calls.length;
    await expect(authenticateAccount("missing@example.test", "incorrect password")).resolves.toBeNull();
    expect(vi.mocked(derivePasswordKey).mock.calls.length - before).toBe(1);

    before = vi.mocked(derivePasswordKey).mock.calls.length;
    await expect(authenticateAccount("known@example.test", "incorrect password")).resolves.toBeNull();
    expect(vi.mocked(derivePasswordKey).mock.calls.length - before).toBe(1);
  });

  it("does the same password-cost work for an unverified account", async () => {
    state.users.push({
      email: "unverified@example.test",
      passwordHash: `scrypt$16384$salt$${Buffer.alloc(64, 2).toString("base64url")}`,
    });

    await expect(authenticateAccount("unverified@example.test", "incorrect password")).resolves.toBeNull();
    expect(derivePasswordKey).toHaveBeenCalledTimes(1);
  });

  it("does the same password-cost work for a malformed stored hash", async () => {
    state.users.push({
      email: "corrupt@example.test",
      passwordHash: "not-a-scrypt-hash",
      emailVerifiedAt: new Date(),
    });

    await expect(authenticateAccount("corrupt@example.test", "incorrect password")).resolves.toBeNull();
    expect(derivePasswordKey).toHaveBeenCalledTimes(1);
  });
});
