import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { transaction: true },
  deletedCount: 1,
  aggregateRows: [] as { _id: "invited" | "in_progress" | "submitted"; count: number }[],
  aggregatePipelines: [] as unknown[][],
  calls: [] as { collection: string; filter: Record<string, unknown>; options: Record<string, unknown> }[],
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work(mocks.session)),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    interviews: async () => ({
      deleteOne: async (filter: Record<string, unknown>, options: Record<string, unknown>) => {
        mocks.calls.push({ collection: "interviews", filter, options });
        return { deletedCount: mocks.deletedCount };
      },
    }),
    versions: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "versions", filter, options }); } }),
    participants: async () => ({
      findOne: async (filter: Record<string, unknown>, options: Record<string, unknown>) => {
        mocks.calls.push({ collection: "participantLookup", filter, options });
        return { interviewId: new ObjectId(interviewId) };
      },
      deleteOne: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "participants", filter, options }); return { deletedCount: mocks.deletedCount }; },
      deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "participants", filter, options }); },
      aggregate: (pipeline: unknown[]) => {
        mocks.aggregatePipelines.push(pipeline);
        return { toArray: async () => mocks.aggregateRows };
      },
    }),
    questionOrderAssignments: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "questionOrderAssignments", filter, options }); } }),
    events: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "events", filter, options }); } }),
    analyticsRuns: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "analyticsRuns", filter, options }); } }),
    mail: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "mail", filter, options }); } }),
  },
}));

import { deleteInterview, deleteParticipant, getInterviewParticipantCounts } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const interviewId = new ObjectId().toHexString();
const session = mocks.session;
const asAxion = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, work);

beforeEach(() => {
  mocks.deletedCount = 1;
  mocks.calls.length = 0;
  mocks.aggregateRows = [];
  mocks.aggregatePipelines.length = 0;
  mocks.withMongoTransaction.mockReset().mockImplementation(async (work) => work(session));
});

describe("deleteInterview", () => {
  it("deletes the parent and all dependent records sequentially in one tenant-scoped transaction", async () => {
    const deleted = await asAxion(() => deleteInterview(interviewId));

    expect(deleted).toBe(true);
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual([
      "interviews", "versions", "participants", "questionOrderAssignments", "events", "analyticsRuns", "mail",
    ]);
    expect(mocks.calls.every(({ options }) => options.session === session)).toBe(true);
    expect(mocks.calls[0].filter).toEqual(tenantFilter("axion", { _id: new ObjectId(interviewId) }));
  });

  it("does not remove dependent records when the tenant-scoped interview no longer exists", async () => {
    mocks.deletedCount = 0;
    const deleted = await asAxion(() => deleteInterview(interviewId));

    expect(deleted).toBe(false);
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["interviews"]);
  });
});

describe("aggregate interview participant counts", () => {
  it("counts statuses in Mongo without loading respondent documents", async () => {
    mocks.aggregateRows = [
      { _id: "invited", count: 2 },
      { _id: "in_progress", count: 1 },
      { _id: "submitted", count: 4 },
    ];

    const counts = await asAxion(() => getInterviewParticipantCounts(interviewId));

    expect(counts).toEqual({ people: 7, invited: 2, inProgress: 1, submitted: 4 });
    expect(mocks.aggregatePipelines[0][0]).toEqual({ $match: tenantFilter("axion", { interviewId: new ObjectId(interviewId) }) });
    expect(mocks.aggregatePipelines[0][1]).toEqual({ $group: { _id: "$status", count: { $sum: 1 } } });
  });
});

describe("deleteParticipant", () => {
  it("removes person-linked data and invalidates interview analytics in one tenant-scoped transaction", async () => {
    const deleted = await asAxion(() => deleteParticipant(interviewId));

    expect(deleted).toBe(true);
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["participantLookup", "participants", "questionOrderAssignments", "events", "mail", "analyticsRuns"]);
    expect(mocks.calls.every(({ options }) => options.session === session)).toBe(true);
    expect(mocks.calls[3].filter).toEqual({ participantId: new ObjectId(interviewId) });
    expect(mocks.calls[4].filter).toEqual({ participantId: new ObjectId(interviewId) });
    expect(mocks.calls[5].filter).toEqual(tenantFilter("axion", { interviewId: new ObjectId(interviewId) }));
  });

  it("leaves dependent records untouched when the participant no longer exists", async () => {
    mocks.deletedCount = 0;

    const deleted = await asAxion(() => deleteParticipant(interviewId));

    expect(deleted).toBe(false);
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["participantLookup", "participants"]);
  });
});
