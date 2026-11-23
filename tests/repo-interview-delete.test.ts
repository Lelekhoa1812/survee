import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: { transaction: true },
  deletedCount: 1,
  interviewExists: true,
  pendingInvite: null as Record<string, unknown> | null,
  aggregateRows: [] as { _id: "invited" | "in_progress" | "submitted"; count: number }[],
  aggregatePipelines: [] as unknown[][],
  calls: [] as { collection: string; filter: Record<string, unknown>; update?: unknown; options: Record<string, unknown> }[],
  participantAfterUpdate: null as Record<string, unknown> | null,
  failParticipantInsert: false,
  failEventInsert: false,
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => {
    const result = await work(mocks.session);
    if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
    return result;
  }),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    mcpOperations: async () => ({ updateMany: async (filter: Record<string, unknown>, update: unknown, options: Record<string, unknown>) => { mocks.calls.push({ collection: "mcpOperations", filter, update, options }); } }),
    interviews: async () => ({
      findOne: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "interviewLookup", filter, options }); return mocks.interviewExists ? { _id: new ObjectId(interviewId) } : null; },
      deleteOne: async (filter: Record<string, unknown>, options: Record<string, unknown>) => {
        mocks.calls.push({ collection: "interviews", filter, options });
        return { deletedCount: mocks.deletedCount };
      },
      updateOne: async (filter: Record<string, unknown>, _update: unknown, options: Record<string, unknown>) => {
        mocks.calls.push({ collection: "interviews", filter, options });
        return { matchedCount: 1, modifiedCount: 1 };
      },
    }),
    versions: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "versions", filter, options }); } }),
    participants: async () => ({
      findOne: async (filter: Record<string, unknown>, options: Record<string, unknown>) => {
        mocks.calls.push({ collection: "participantLookup", filter, options });
        return { interviewId: new ObjectId(interviewId) };
      },
      findOneAndUpdate: async (filter: Record<string, unknown>, _update: unknown, options: Record<string, unknown>) => {
        mocks.calls.push({ collection: "participants", filter, options });
        return mocks.participantAfterUpdate;
      },
      insertMany: async (docs: unknown[], options: Record<string, unknown>) => {
        mocks.calls.push({ collection: "participants.insertMany", filter: { count: docs.length }, options });
        if (mocks.failParticipantInsert) throw new Error("participant insert failed");
      },
      deleteOne: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "participants", filter, options }); return { deletedCount: mocks.deletedCount }; },
      deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "participants", filter, options }); },
      aggregate: (pipeline: unknown[]) => {
        mocks.aggregatePipelines.push(pipeline);
        return { toArray: async () => mocks.aggregateRows };
      },
    }),
    questionOrderAssignments: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "questionOrderAssignments", filter, options }); } }),
    events: async () => ({
      insertOne: async (_event: unknown, options: Record<string, unknown>) => { mocks.calls.push({ collection: "events.insert", filter: {}, options }); if (mocks.failEventInsert) throw new Error("event insert failed"); },
      deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "events", filter, options }); },
    }),
    analyticsRuns: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "analyticsRuns", filter, options }); } }),
    mail: async () => ({
      findOne: async (filter: Record<string, unknown>, options: Record<string, unknown>) => {
        mocks.calls.push({ collection: JSON.stringify(filter).includes("interviewId") ? "interviewPendingLookup" : "mailPendingLookup", filter, options });
        const resolved = mocks.pendingInvite?.delivery === "delivered" || mocks.pendingInvite?.delivery === "bounced";
        return resolved ? null : mocks.pendingInvite;
      },
      deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "mail", filter, options }); },
    }),
    questionnaireReviewDrafts: async () => ({ deleteMany: async (filter: Record<string, unknown>, options: Record<string, unknown>) => { mocks.calls.push({ collection: "questionnaireReviewDrafts", filter, options }); } }),
  },
}));

import { addParticipants, deleteInterview, deleteParticipant, getInterviewParticipantCounts, reopenParticipant } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const interviewId = new ObjectId().toHexString();
const session = mocks.session;
const asAxion = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, work);

beforeEach(() => {
  mocks.deletedCount = 1;
  mocks.interviewExists = true;
  mocks.pendingInvite = null;
  mocks.calls.length = 0;
  mocks.aggregateRows = [];
  mocks.aggregatePipelines.length = 0;
  mocks.participantAfterUpdate = null;
  mocks.failParticipantInsert = false;
  mocks.failEventInsert = false;
  mocks.withMongoTransaction.mockReset().mockImplementation(async (work) => {
    const result = await work(session);
    if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
    return result;
  });
});

describe("deleteInterview", () => {
  it("deletes the parent and all dependent records sequentially in one tenant-scoped transaction", async () => {
    const deleted = await asAxion(() => deleteInterview(interviewId));

    expect(deleted).toBe(true);
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual([
      "interviewLookup", "interviewPendingLookup", "interviews", "mcpOperations", "versions", "participants", "questionOrderAssignments", "events", "analyticsRuns", "mail", "questionnaireReviewDrafts",
    ]);
    expect(mocks.calls.every(({ options }) => options.session === session)).toBe(true);
    expect(mocks.calls[0].filter).toEqual(tenantFilter("axion", { _id: new ObjectId(interviewId) }));
    expect(mocks.calls[1].filter).toEqual(tenantFilter("axion", { interviewId: new ObjectId(interviewId), status: "pending", delivery: { $nin: ["delivered", "bounced"] } }));
    expect(mocks.calls[3]).toMatchObject({ filter: tenantFilter("axion", { interviewId: new ObjectId(interviewId) }), update: { $set: { result: { deleted: true }, deletedAt: expect.any(Date) }, $unset: { participantIds: "", interviewId: "", argumentDigest: "" } }, options: { session } });
  });

  it("retains the interview while one of its invite outcomes is unconfirmed", async () => {
    mocks.pendingInvite = { _id: new ObjectId() };

    const deleted = await asAxion(() => deleteInterview(interviewId));

    expect(deleted).toBe("invite_pending");
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["interviewLookup", "interviewPendingLookup"]);
  });

  it("does not remove dependent records when the tenant-scoped interview no longer exists", async () => {
    mocks.interviewExists = false;
    const deleted = await asAxion(() => deleteInterview(interviewId));

    expect(deleted).toBe(false);
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["interviewLookup"]);
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

describe("respondent revision writes", () => {
  it("adds invitees in the same transaction as the analytics revision bump", async () => {
    const added = await asAxion(() => addParticipants(interviewId, [{ name: "Ada" }]));

    expect(added).toHaveLength(1);
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["interviews", "interviews", "participants.insertMany", "events.insert"]);
    expect(mocks.calls[0]).toMatchObject({
      filter: tenantFilter("axion", { _id: new ObjectId(interviewId), mode: "single" }),
      options: { session },
    });
    expect(mocks.calls[1].options).toEqual({ session });
    expect(mocks.calls[2].options).toEqual({ session });
    expect(mocks.calls[3].options).toEqual({ session });
  });

  it("rolls mode promotion back with the batch when participant insertion fails", async () => {
    mocks.failParticipantInsert = true;
    await expect(asAxion(() => addParticipants(interviewId, [{ name: "Ada" }]))).rejects.toThrow("participant insert failed");
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["interviews", "interviews", "participants.insertMany"]);
    expect(mocks.calls.every(({ options }) => options.session === session)).toBe(true);
  });

  it("bumps the analysis revision atomically when reopening a submitted response", async () => {
    mocks.participantAfterUpdate = {
      _id: new ObjectId(), interviewId: new ObjectId(interviewId), tenantId: "axion", token: "token",
      name: "Ada", status: "in_progress", answers: {}, revision: 1, createdAt: new Date(), updatedAt: new Date(),
    };

    const reopened = await asAxion(() => reopenParticipant(new ObjectId().toHexString()));

    expect(reopened?.status).toBe("in_progress");
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["participants", "interviews", "events.insert"]);
    expect(mocks.calls[0].options).toMatchObject({ session });
    expect(mocks.calls[1].options).toEqual({ session });
  });
});

describe("deleteParticipant", () => {
  it("removes person-linked data and invalidates interview analytics in one tenant-scoped transaction", async () => {
    const deleted = await asAxion(() => deleteParticipant(interviewId));

    expect(deleted).toBe(true);
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["participantLookup", "mailPendingLookup", "participants", "mcpOperations", "interviews", "questionOrderAssignments", "events", "mail", "analyticsRuns"]);
    expect(mocks.calls.every(({ options }) => options.session === session)).toBe(true);
    expect(mocks.calls[1].filter).toEqual({ participantId: new ObjectId(interviewId), status: "pending", delivery: { $nin: ["delivered", "bounced"] } });
    expect(mocks.calls[1].options).toMatchObject({ session, projection: { _id: 1 } });
    expect(mocks.calls[3]).toMatchObject({ filter: tenantFilter("axion", { participantIds: new ObjectId(interviewId) }), update: { $set: { result: { deleted: true }, deletedAt: expect.any(Date) }, $unset: { participantIds: "", interviewId: "", argumentDigest: "" } }, options: { session } });
    expect(mocks.calls[6].filter).toEqual({ participantId: new ObjectId(interviewId) });
    expect(mocks.calls[7].filter).toEqual({ participantId: new ObjectId(interviewId) });
    expect(mocks.calls[8].filter).toEqual(tenantFilter("axion", { interviewId: new ObjectId(interviewId) }));
  });

  it("retains respondent data while an invite outcome is unconfirmed", async () => {
    mocks.pendingInvite = { _id: new ObjectId() };

    const deleted = await asAxion(() => deleteParticipant(interviewId));

    expect(deleted).toBe("invite_pending");
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["participantLookup", "mailPendingLookup"]);
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
  });

  it.each(["delivered", "bounced"]) ("allows deletion after a pending attempt is resolved as %s", async (delivery) => {
    mocks.pendingInvite = { _id: new ObjectId(), delivery };

    const deleted = await asAxion(() => deleteParticipant(interviewId));

    expect(deleted).toBe(true);
    expect(mocks.calls.map(({ collection }) => collection)).toContain("analyticsRuns");
  });

  it("leaves dependent records untouched when the participant no longer exists", async () => {
    mocks.deletedCount = 0;

    const deleted = await asAxion(() => deleteParticipant(interviewId));

    expect(deleted).toBe(false);
    expect(mocks.calls.map(({ collection }) => collection)).toEqual(["participantLookup", "mailPendingLookup", "participants"]);
  });
});
