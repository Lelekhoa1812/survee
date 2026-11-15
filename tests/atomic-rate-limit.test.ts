import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  buckets: new Map<string, { count: number; windowEndsAt: Date; expireAt: Date }>(),
  duplicateUpserts: 0,
}));

vi.mock("../src/lib/db", () => ({
  col: {
    rateLimits: async () => ({
      findOneAndUpdate: async ({ _id }: { _id: string }, pipeline: Array<{ $set: Record<string, any> }>) => {
        if (state.duplicateUpserts > 0) {
          state.duplicateUpserts -= 1;
          throw Object.assign(new Error("duplicate key"), { code: 11000 });
        }
        const set = pipeline[0].$set;
        const now = set.count.$cond[0].$gt[1] as Date;
        const resetAt = set.windowEndsAt.$cond[2] as Date;
        const previous = state.buckets.get(_id);
        const inWindow = previous !== undefined && previous.windowEndsAt > now;
        const next = {
          count: inWindow ? previous.count + 1 : 1,
          windowEndsAt: inWindow ? previous.windowEndsAt : resetAt,
          expireAt: inWindow ? previous.expireAt : resetAt,
        };
        state.buckets.set(_id, next);
        return next;
      },
    }),
  },
}));

import { consumeRateLimit } from "../src/lib/repo";

describe("atomic request rate limits", () => {
  beforeEach(() => {
    state.buckets.clear();
    state.duplicateUpserts = 0;
  });

  it("caps concurrent requests at the configured limit and stores only a hashed key", async () => {
    const rawKey = "signup-email:person@example.com";
    const allowed = await Promise.all(Array.from({ length: 40 }, () => consumeRateLimit(rawKey, 5)));

    expect(allowed.filter(Boolean)).toHaveLength(5);
    expect(state.buckets).toHaveProperty("size", 1);
    const storedKey = [...state.buckets.keys()][0];
    expect(storedKey).toMatch(/^[a-f0-9]{64}$/);
    expect(storedKey).not.toContain("person");
    expect(state.buckets.get(storedKey)?.count).toBe(40);
  });

  it("keeps keys independent and resets the bucket after its window expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T00:00:00.000Z"));
    try {
      expect(await consumeRateLimit("signup-ip:192.0.2.1", 1)).toBe(true);
      expect(await consumeRateLimit("signup-ip:192.0.2.1", 1)).toBe(false);
      expect(await consumeRateLimit("signup-ip:192.0.2.2", 1)).toBe(true);

      vi.advanceTimersByTime(15 * 60 * 1000);
      expect(await consumeRateLimit("signup-ip:192.0.2.1", 1)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a concurrent first-write duplicate as an update", async () => {
    state.duplicateUpserts = 1;
    await expect(consumeRateLimit("signup-ip:192.0.2.3", 1)).resolves.toBe(true);
    expect(state.buckets).toHaveProperty("size", 1);
  });

  it("rejects invalid limits instead of silently accepting attempts", async () => {
    await expect(consumeRateLimit("signup-ip:192.0.2.1", 0)).rejects.toThrow("Invalid rate limit configuration.");
    await expect(consumeRateLimit("", 3)).rejects.toThrow("Invalid rate limit configuration.");
  });
});
