import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ connectCalls: 0, indexes: [] as string[], reviewMigrationDone: false, reviewBackfills: 0, reviewIndexDrops: 0 }));

vi.mock("mongodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongodb")>();
  const database = {
    collection(name: string) {
      return {
        async createIndex(_spec: unknown, options?: { name?: string }) { if (options?.name) state.indexes.push(options.name); return "index"; },
        async dropIndex() { if (name === "questionnaire_review_drafts") state.reviewIndexDrops++; const error = new Error("index not found") as Error & { code: number }; error.code = 27; throw error; },
        async updateMany() { if (name === "questionnaire_review_drafts") state.reviewBackfills++; return { modifiedCount: 0 }; },
        async deleteMany() { return { deletedCount: 0 }; },
        async findOne() { return name === "schema_migrations" && state.reviewMigrationDone ? { _id: "questionnaire_review_slots_v1" } : null; },
        async insertOne() { if (name === "schema_migrations") state.reviewMigrationDone = true; return { acknowledged: true }; },
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
    state.indexes = [];
    state.reviewMigrationDone = false;
    state.reviewBackfills = 0;
    state.reviewIndexDrops = 0;
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
    expect(state.indexes).toContain("tenant_people_cursor");
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

  it("runs the review-draft backfill once across separate cold isolates", async () => {
    const { db } = await import("../src/lib/db");

    await expect(db()).rejects.toThrow("MongoDB unavailable during cold start");
    await db();
    expect(state.reviewBackfills).toBe(1);
    expect(state.reviewIndexDrops).toBe(1);

    (globalThis as typeof globalThis & { __kqaMongo?: unknown }).__kqaMongo = undefined;
    await db();

    expect(state.reviewBackfills).toBe(1);
    expect(state.reviewIndexDrops).toBe(1);
  });
});
