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
  signupAggregationPipeline: [] as unknown[],
  signupAggregationOptions: null as null | { allowDiskUse?: boolean; batchSize?: number },
  signupAggregationRuns: 0,
  signupIndexDuplicateKeyConflicts: 0,
  signupIndexCreatedDuringConflict: false,
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
          if (name === "pending_signups" && options?.name === "signup_email_unique") {
            if (state.signupIndexDuplicateKeyConflicts > 0) {
              state.signupIndexDuplicateKeyConflicts--;
              if (state.signupIndexCreatedDuringConflict) state.signupEmailIndex = true;
              throw Object.assign(new Error("duplicate key during index build"), { code: 11000 });
            }
            state.signupEmailIndex = true;
          }
          return "index";
        },
        async dropIndex() { if (name === "questionnaire_review_drafts") state.reviewIndexDrops++; const error = new Error("index not found") as Error & { code: number }; error.code = 27; throw error; },
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
        aggregate(pipeline: unknown[], options: { allowDiskUse?: boolean; batchSize?: number }) {
          state.signupAggregationPipeline = pipeline;
          state.signupAggregationOptions = options;
          state.signupAggregationRuns++;
          const rows = name === "pending_signups" ? [...state.signupRows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b._id.key - a._id.key) : [];
          const ranks = new Map<string, number>();
          const rankedRows = rows.map((row) => {
            const normalizedEmail = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
            const duplicateRank = (ranks.get(normalizedEmail) ?? 0) + 1;
            ranks.set(normalizedEmail, duplicateRank);
            return { ...row, normalizedEmail, duplicateRank };
          });
          return { async *[Symbol.asyncIterator]() { yield* rankedRows; } };
        },
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
    state.signupAggregationPipeline = [];
    state.signupAggregationOptions = null;
    state.signupAggregationRuns = 0;
    state.signupIndexDuplicateKeyConflicts = 0;
    state.signupIndexCreatedDuringConflict = false;
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
    expect(state.indexes).toContain("mcp_operations_by_interview");
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
    expect(state.signupAggregationPipeline.some((stage) => "$setWindowFields" in (stage as Record<string, unknown>))).toBe(true);
    expect(state.signupAggregationOptions).toEqual({ allowDiskUse: true, batchSize: 500 });
    expect(state.signupBulkWriteSizes).toEqual([500, 500, 2]);
    expect(state.signupDuplicateDeleteSizes).toEqual([2]);
    expect(state.signupDeletedIds).toEqual([2001, 2002]);
    expect(state.signupEmailUpdates).toContainEqual({ id: 2000, email: "duplicate@example.com" });
    expect(Math.max(...state.signupBulkWriteSizes, ...state.signupDuplicateDeleteSizes)).toBeLessThanOrEqual(500);
  });

  it("repeats the bounded signup scan after a concurrent claim defeats unique-index creation", async () => {
    state.signupRows = [
      { _id: { key: 2 }, email: "person@example.com", createdAt: new Date(2) },
      { _id: { key: 1 }, email: " Person@Example.com ", createdAt: new Date(1) },
    ];
    state.signupIndexDuplicateKeyConflicts = 1;

    const { db } = await import("../src/lib/db");
    await expect(db()).rejects.toThrow("MongoDB unavailable during cold start");
    await db();

    expect(state.signupAggregationRuns).toBe(2);
    expect(state.signupEmailIndex).toBe(true);
    expect(state.signupDeletedIds).toEqual([1, 1]);
  });

  it("accepts a unique signup index another cold isolate created during duplicate-key recovery", async () => {
    state.signupIndexDuplicateKeyConflicts = 1;
    state.signupIndexCreatedDuringConflict = true;

    const { db } = await import("../src/lib/db");
    await expect(db()).rejects.toThrow("MongoDB unavailable during cold start");
    await db();

    expect(state.signupAggregationRuns).toBe(1);
    expect(state.signupEmailIndex).toBe(true);
  });
});
