import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  connectCalls: 0,
  indexes: [] as string[],
  reviewMigrationDone: false,
  reviewBackfills: 0,
  reviewIndexDrops: 0,
  respondentPolicyMigrationDone: false,
  respondentPolicyCleanupCalls: 0,
  signupRows: [] as { _id: { key: number }; email: string; createdAt: Date }[],
  signupEmailIndex: false,
  signupCleanupIndex: false,
  signupCleanupIndexDropped: false,
  signupBulkWriteSizes: [] as number[],
  signupDuplicateDeleteSizes: [] as number[],
  signupDeletedIds: [] as number[],
  signupEmailUpdates: [] as { id: number; email: string }[],
}));

vi.mock("mongodb", async (importOriginal) => {
  const actual = await importOriginal<typeof import("mongodb")>();
  const database = {
    collection(name: string) {
      return {
        async createIndex(spec: unknown, options?: { name?: string }) {
          if (options?.name) state.indexes.push(options.name);
          if (name === "pending_signups" && options?.name === "signup_cleanup_order") state.signupCleanupIndex = JSON.stringify(spec) === JSON.stringify({ createdAt: -1, _id: -1 });
          if (name === "pending_signups" && options?.name === "signup_email_unique") state.signupEmailIndex = true;
          return "index";
        },
        async dropIndex(indexName?: string) { if (name === "questionnaire_review_drafts") state.reviewIndexDrops++; if (name === "pending_signups" && indexName === "signup_cleanup_order") state.signupCleanupIndexDropped = true; const error = new Error("index not found") as Error & { code: number }; error.code = 27; throw error; },
        async updateMany(filter?: unknown, update?: unknown) {
          if (name === "questionnaire_review_drafts") state.reviewBackfills++;
          if (name === "tenants") {
            expect(filter).toEqual({ respondentPolicy: { $exists: true } });
            expect(update).toEqual({ $unset: { respondentPolicy: "" } });
            state.respondentPolicyCleanupCalls++;
          }
          return { modifiedCount: 0 };
        },
        async deleteMany(filter?: { _id?: { $in?: unknown[] } }) {
          if (name === "pending_signups" && filter?._id?.$in) {
            state.signupDuplicateDeleteSizes.push(filter._id.$in.length);
            state.signupDeletedIds.push(...filter._id.$in.map((id) => (id as { key: number }).key));
          }
          return { deletedCount: 0 };
        },
        async bulkWrite(operations: unknown[]) {
          if (name === "pending_signups") {
            state.signupBulkWriteSizes.push(operations.length);
            const updates = operations as { updateOne: { filter: { _id: { key: number } }; update: { $set: { email: string } } } }[];
            state.signupEmailUpdates.push(...updates.map(({ updateOne }) => ({ id: updateOne.filter._id.key, email: updateOne.update.$set.email })));
          }
          return { modifiedCount: operations.length };
        },
        async findOne(filter?: { _id?: string }) {
          if (name !== "schema_migrations") return null;
          if (filter?._id === "questionnaire_review_slots_v1" && state.reviewMigrationDone) return { _id: filter._id };
          if (filter?._id === "remove_respondent_policy_fields_v1" && state.respondentPolicyMigrationDone) return { _id: filter._id };
          return null;
        },
        async insertOne(document?: { _id?: string }) {
          if (name === "schema_migrations" && document?._id === "questionnaire_review_slots_v1") state.reviewMigrationDone = true;
          if (name === "schema_migrations" && document?._id === "remove_respondent_policy_fields_v1") state.respondentPolicyMigrationDone = true;
          return { acknowledged: true };
        },
        listIndexes() { return { toArray: async () => state.signupEmailIndex && name === "pending_signups" ? [{ key: { email: 1 }, unique: true }] : [] }; },
        find() {
          const rows = name === "pending_signups" ? [...state.signupRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b._id.key - a._id.key) : [];
          return {
            sort() { return this; },
            batchSize() { return this; },
            async toArray() {
              if (name === "pending_signups") throw new Error("Pending signup migration must stream its cursor.");
              return rows;
            },
            async *[Symbol.asyncIterator]() { yield* rows; },
          };
        },
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
    state.respondentPolicyMigrationDone = false;
    state.respondentPolicyCleanupCalls = 0;
    state.signupRows = [];
    state.signupEmailIndex = false;
    state.signupCleanupIndex = false;
    state.signupCleanupIndexDropped = false;
    state.signupBulkWriteSizes = [];
    state.signupDuplicateDeleteSizes = [];
    state.signupDeletedIds = [];
    state.signupEmailUpdates = [];
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
    expect(state.indexes).toContain("tenant_workspace_events");
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

  it("clears legacy respondent policy fields once across separate cold isolates", async () => {
    const { db } = await import("../src/lib/db");

    await expect(db()).rejects.toThrow("MongoDB unavailable during cold start");
    await db();
    expect(state.respondentPolicyCleanupCalls).toBe(1);

    (globalThis as typeof globalThis & { __kqaMongo?: unknown }).__kqaMongo = undefined;
    await db();

    expect(state.respondentPolicyCleanupCalls).toBe(1);
  });

  it("streams signup rows and flushes email cleanup in bounded batches", async () => {
    state.signupRows = Array.from({ length: 1001 }, (_, index) => ({
      _id: { key: index },
      email: `Person-${index}@Example.com`,
      createdAt: new Date(1001 - index),
    }));
    state.signupRows.push(
      { _id: { key: 2000 }, email: " Duplicate@Example.com ", createdAt: new Date(2000) },
      { _id: { key: 2001 }, email: "duplicate@example.com", createdAt: new Date(1000) },
      { _id: { key: 2002 }, email: "   ", createdAt: new Date(999) },
    );

    const { db } = await import("../src/lib/db");
    await expect(db()).rejects.toThrow("MongoDB unavailable during cold start");
    await expect(db()).resolves.toBeDefined();

    expect(state.signupEmailIndex).toBe(true);
    expect(state.signupCleanupIndex).toBe(true);
    expect(state.signupCleanupIndexDropped).toBe(true);
    expect(state.signupBulkWriteSizes).toEqual([500, 500, 2]);
    expect(state.signupDuplicateDeleteSizes).toEqual([2]);
    expect(state.signupDeletedIds).toEqual([2001, 2002]);
    expect(state.signupEmailUpdates).toContainEqual({ id: 2000, email: "duplicate@example.com" });
    expect(Math.max(...state.signupBulkWriteSizes, ...state.signupDuplicateDeleteSizes)).toBeLessThanOrEqual(500);
  });
});
