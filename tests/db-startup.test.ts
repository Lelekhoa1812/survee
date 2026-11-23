import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connectCalls: 0 }));

vi.mock("mongodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongodb")>();
  const database = {
    collection() {
      return {
        async createIndex() { return "index"; },
        async dropIndex() { const error = new Error("index not found") as Error & { code: number }; error.code = 27; throw error; },
        async updateMany() { return { modifiedCount: 0 }; },
        async deleteMany() { return { deletedCount: 0 }; },
        listIndexes() { return { toArray: async () => [] }; },
        find() { return { sort() { return { toArray: async () => [] }; } }; },
      };
    },
  };
  class TestMongoClient {
    constructor(..._args: unknown[]) {}
    async connect() {
      state.connectCalls += 1;
      if (state.connectCalls === 1) throw new Error("MongoDB unavailable during cold start");
      return this;
    }
    db() { return database; }
    startSession() { throw new Error("not used"); }
  }
  return { ...actual, MongoClient: TestMongoClient };
});

describe("MongoDB cold-start connection recovery", () => {
  beforeEach(() => {
    state.connectCalls = 0;
    (globalThis as typeof globalThis & { __kqaMongo?: unknown }).__kqaMongo = undefined;
    process.env.MONGODB_URI = "mongodb://127.0.0.1:27017/kqa-test";
    process.env.MONGODB_DB = "kqa-test";
    vi.resetModules();
  });

  it("retries initial connection after a rejected cold-start attempt", async () => {
    const { db } = await import("../src/lib/db");

    await expect(db()).rejects.toThrow("MongoDB unavailable during cold start");
    await expect(db()).resolves.toBeDefined();

    expect(state.connectCalls).toBe(2);
  });

  it("shares one in-flight cold-start attempt among concurrent callers", async () => {
    const { db } = await import("../src/lib/db");

    const first = db();
    const concurrent = db();
    await expect(Promise.all([first, concurrent])).rejects.toThrow("MongoDB unavailable during cold start");
    expect(state.connectCalls).toBe(1);

    await expect(db()).resolves.toBeDefined();
    expect(state.connectCalls).toBe(2);
  });
});
