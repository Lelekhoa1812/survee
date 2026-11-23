import { ObjectId } from "mongodb";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  participant: null as any,
  interview: null as any,
  version: null as any,
  updates: [] as Array<Record<string, unknown>>,
  events: [] as Array<Record<string, unknown>>,
  eventOptions: [] as Array<Record<string, unknown>>,
  transactionSession: { transaction: true },
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: async (work: (session: unknown) => Promise<unknown>) => {
    const result = await work(state.transactionSession);
    if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
    return result;
  },
  col: {
    participants: async () => ({
      findOne: async () => state.participant,
      updateOne: async (_filter: unknown, update: Record<string, unknown>, options: Record<string, unknown>) => {
        state.updates.push({ update, options });
        return { matchedCount: 1 };
      },
    }),
    interviews: async () => ({ findOne: async () => state.interview }),
    versions: async () => ({ findOne: async () => state.version }),
    events: async () => ({ insertOne: async (event: Record<string, unknown>, options: Record<string, unknown>) => { state.events.push(event); state.eventOptions.push(options); } }),
  },
}));

vi.mock("../src/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-a",
  tenantFilter: (tenantId: string, filter: Record<string, unknown> = {}) => ({ tenantId, ...filter }),
}));

import { loadByToken } from "../src/lib/repo";

describe("loadByToken access events", () => {
  it("returns a real transaction result when touching a new respondent visit", async () => {
    const interviewId = new ObjectId();
    const participantId = new ObjectId();
    state.participant = {
      _id: participantId, tenantId: "tenant-a", interviewId, token: "token", name: "Alex", status: "invited", answers: {}, revision: 0,
      createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
    };
    state.interview = { _id: interviewId, currentVersion: 1, name: "Check", mode: "multi", status: "open" };
    state.version = { _id: new ObjectId(), tenantId: "tenant-a", interviewId, version: 1, html: "<html></html>", htmlSha256: "a".repeat(64), bytes: 13, manifest: { format: "kqa/1", title: "Check", questions: [] }, check: { errors: 0, warnings: 0, info: 0, checkedAt: "now", checkerVersion: "test" }, createdAt: new Date() };
    state.updates.length = 0;
    state.events.length = 0;
    state.eventOptions.length = 0;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const context = await loadByToken("token", { touch: true });
    await vi.waitFor(() => expect(state.events).toHaveLength(1));

    expect(context?.participant.id).toBe(participantId.toHexString());
    expect(state.updates).toHaveLength(1);
    expect(state.events[0]).toMatchObject({ type: "open", tenantId: "tenant-a", interviewId, participantId });
    expect(state.eventOptions).toEqual([{ session: state.transactionSession }]);
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });
});
