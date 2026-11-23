import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mongoMocks = vi.hoisted(() => {
  const find = vi.fn();
  const deleteMany = vi.fn();
  const insertOne = vi.fn();
  const findOne = vi.fn();
  const interviewUpdateOne = vi.fn();
  const participants = vi.fn(async () => ({ find }));
  const analyticsRuns = vi.fn(async () => ({ deleteMany, insertOne, findOne }));
  const interviews = vi.fn(async () => ({ updateOne: interviewUpdateOne }));
  const withMongoTransaction = vi.fn(async (work: (session: object) => Promise<unknown>) => work({}));
  return { find, participants, deleteMany, insertOne, findOne, analyticsRuns, interviewUpdateOne, interviews, withMongoTransaction };
});

vi.mock("../src/lib/db", () => ({ col: { participants: mongoMocks.participants, analyticsRuns: mongoMocks.analyticsRuns, interviews: mongoMocks.interviews }, withMongoTransaction: mongoMocks.withMongoTransaction }));

import { createAnalyticsRun, getAnalyticsRun, iterateAnalyticsParticipants, type AnalyticsParticipant } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const asAxion = <T>(run: () => T) => withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, run);

describe("analytics participant query", () => {
  let cursor: { batchSize: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; [Symbol.asyncIterator]: () => AsyncGenerator<Record<string, unknown>> };
  const interviewId = new ObjectId();

  beforeEach(() => {
    cursor = {
      batchSize: vi.fn(function (this: typeof cursor) { return this; }),
      close: vi.fn(async () => {}),
      async *[Symbol.asyncIterator]() {
        yield {
          token: "private-link-token",
          name: "Private Name",
          email: "private@example.com",
          status: "submitted",
          answers: {
            fit: { value: "yes", note: "Private note text", updatedAt: "2026-11-15T00:00:00Z" },
            unrelated: { value: "raw unrelated answer", updatedAt: "2026-11-15T00:00:00Z" },
          },
          recordGroups: { fit: [{ id: "private-row", values: { detail: "private record value" } }], unrelated: [{ values: { detail: "unrelated record" } }] },
        };
      },
    };
    mongoMocks.find.mockReset().mockReturnValue(cursor);
    mongoMocks.participants.mockClear();
    mongoMocks.deleteMany.mockReset().mockResolvedValue({ deletedCount: 0 });
    mongoMocks.insertOne.mockReset().mockResolvedValue({ acknowledged: true });
    mongoMocks.findOne.mockReset().mockResolvedValue(null);
    mongoMocks.analyticsRuns.mockClear();
    mongoMocks.interviewUpdateOne.mockReset().mockResolvedValue({ matchedCount: 1 });
    mongoMocks.interviews.mockClear();
    mongoMocks.withMongoTransaction.mockClear();
  });

  it("filters status in Mongo and streams only selected answer fields without identity or note text", async () => {
    const rows: AnalyticsParticipant[] = [];
    await asAxion(async () => {
      for await (const row of iterateAnalyticsParticipants(interviewId.toHexString(), ["fit", "unsafe.path"], false)) rows.push(row);
    });

    expect(mongoMocks.find).toHaveBeenCalledWith(
      tenantFilter("axion", { interviewId, status: { $in: ["invited", "in_progress", "submitted"] } }),
      { projection: { _id: 0, status: 1, "answers.fit.value": 1, "answers.fit.note": 1, "recordGroups.fit.deletedAt": 1 } },
    );
    expect(cursor.batchSize).toHaveBeenCalledWith(250);
    expect(cursor.close).toHaveBeenCalledOnce();
    expect(rows).toEqual([{ status: "submitted", answers: { fit: { value: "yes", note: "present", updatedAt: "" } }, recordGroups: { fit: [{ id: "present", values: {}, revision: 0, fieldRevisions: {} }] } }]);
    expect(JSON.stringify(rows)).not.toContain("private-link-token");
    expect(JSON.stringify(rows)).not.toContain("private@example.com");
    expect(JSON.stringify(rows)).not.toContain("Private note text");
    expect(JSON.stringify(rows)).not.toContain("raw unrelated answer");
    expect(JSON.stringify(rows)).not.toContain("private-row");
    expect(JSON.stringify(rows)).not.toContain("private record value");
  });

  it("filters submitted respondents in Mongo", async () => {
    await asAxion(async () => {
      for await (const _row of iterateAnalyticsParticipants(interviewId.toHexString(), ["fit"], true)) { /* consume cursor */ }
    });
    expect(mongoMocks.find).toHaveBeenCalledWith(
      tenantFilter("axion", { interviewId, status: "submitted" }),
      { projection: { _id: 0, status: 1, "answers.fit.value": 1, "answers.fit.note": 1, "recordGroups.fit.deletedAt": 1 } },
    );
  });

  it("filters a caller-selected status subset in Mongo", async () => {
    await asAxion(async () => {
      for await (const _row of iterateAnalyticsParticipants(interviewId.toHexString(), ["fit"], { statuses: ["invited", "in_progress"] })) { /* consume cursor */ }
    });
    expect(mongoMocks.find).toHaveBeenCalledWith(
      tenantFilter("axion", { interviewId, status: { $in: ["invited", "in_progress"] } }),
      { projection: { _id: 0, status: 1, "answers.fit.value": 1, "answers.fit.note": 1, "recordGroups.fit.deletedAt": 1 } },
    );
  });
});

describe("repeatable analytics runs", () => {
  const interviewId = new ObjectId();

  beforeEach(() => {
    mongoMocks.deleteMany.mockReset().mockResolvedValue({ deletedCount: 0 });
    mongoMocks.insertOne.mockReset().mockResolvedValue({ acknowledged: true });
    mongoMocks.findOne.mockReset().mockResolvedValue(null);
    mongoMocks.analyticsRuns.mockClear();
  });

  it("stores only a bounded aggregate result with a tenant slot and one-hour expiry", async () => {
    const result = { questionCount: 3, questions: [{ id: "fit", count: 1 }] };
    const created = await asAxion(() => createAnalyticsRun(interviewId.toHexString(), 2, result));
    expect(created).toMatchObject({ ok: true });
    expect(mongoMocks.deleteMany).toHaveBeenCalledWith({ tenantId: "axion", expiresAt: { $lte: expect.any(Date) } });
    const doc = mongoMocks.insertOne.mock.calls[0][0];
    expect(doc).toMatchObject({ tenantId: "axion", interviewId, slot: 0, surveyVersion: 2, result });
    expect(mongoMocks.interviewUpdateOne).toHaveBeenCalledWith(
      tenantFilter("axion", { _id: interviewId, currentVersion: 2 }),
      { $inc: { analyticsRunRevision: 1 } },
      { session: expect.any(Object) },
    );
    expect(mongoMocks.insertOne).toHaveBeenCalledWith(doc, { session: expect.any(Object) });
    expect((doc.expiresAt as Date).getTime() - (doc.createdAt as Date).getTime()).toBe(60 * 60 * 1000);
  });

  it("refuses a run when participant data changed after the scan and does not persist its aggregates", async () => {
    mongoMocks.interviewUpdateOne.mockResolvedValueOnce({ matchedCount: 0 });

    const created = await asAxion(() => createAnalyticsRun(interviewId.toHexString(), 2, { questionCount: 1 }, 7));

    expect(created).toEqual({ ok: false, reason: "stale" });
    expect(mongoMocks.interviewUpdateOne).toHaveBeenCalledWith(
      tenantFilter("axion", { _id: interviewId, currentVersion: 2, respondentWriteRevision: 7 }),
      { $inc: { analyticsRunRevision: 1 } },
      { session: expect.any(Object) },
    );
    expect(mongoMocks.insertOne).not.toHaveBeenCalled();
  });

  it("retrieves runs with a strict tenant and interview filter", async () => {
    const runId = new ObjectId();
    const now = new Date();
    const row = { result: { questionCount: 1 }, surveyVersion: 4, expiresAt: new Date(now.getTime() + 60_000) };
    mongoMocks.findOne.mockResolvedValue(row);
    const found = await asAxion(() => getAnalyticsRun(runId.toHexString(), interviewId.toHexString()));
    expect(found).toEqual(row);
    const filter = mongoMocks.findOne.mock.calls[0][0];
    expect(filter.tenantId).toBe("axion");
    expect(filter._id.equals(runId)).toBe(true);
    expect(filter.interviewId.equals(interviewId)).toBe(true);
    expect(filter.expiresAt.$gt).toBeInstanceOf(Date);
    expect(filter.$or).toBeUndefined();
  });

  it("does not store an oversized result or exceed the active-run slot limit", async () => {
    const tooLarge = await asAxion(() => createAnalyticsRun(interviewId.toHexString(), 1, { payload: "x".repeat(1024 * 1024) }));
    expect(tooLarge).toEqual({ ok: false, reason: "too_large" });
    expect(mongoMocks.insertOne).not.toHaveBeenCalled();

    const duplicateKey = Object.assign(new Error("slot already used"), { code: 11000 });
    mongoMocks.insertOne.mockRejectedValue(duplicateKey);
    const full = await asAxion(() => createAnalyticsRun(interviewId.toHexString(), 1, { questionCount: 1 }));
    expect(full).toEqual({ ok: false, reason: "capacity" });
    expect(mongoMocks.insertOne).toHaveBeenCalledTimes(10);
  });
});
