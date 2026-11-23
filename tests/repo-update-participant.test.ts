import { ObjectId } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ insertedEvents: [] as Record<string, unknown>[], eventOptions: [] as Record<string, unknown>[], failEvent: false, withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work({ transaction: true })) }));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    participants: async () => ({ findOneAndUpdate: async () => ({
      _id: new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"),
      interviewId: new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb"),
      tenantId: "workspace-1", token: "token", name: "Updated name", note: "Updated note", email: "person@example.com",
      status: "invited", answers: {}, revision: 0, writeEpoch: 0, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
    }) }),
    events: async () => ({ insertOne: async (event: Record<string, unknown>, options: Record<string, unknown>) => { mocks.insertedEvents.push(event); mocks.eventOptions.push(options); if (mocks.failEvent) throw new Error("event insert failed"); } }),
  },
}));

import { updateParticipant } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

afterEach(() => { mocks.insertedEvents.length = 0; mocks.eventOptions.length = 0; mocks.failEvent = false; });

describe("updateParticipant", () => {
  it("records which participant fields changed in the interview event stream", async () => {
    const updated = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => updateParticipant("aaaaaaaaaaaaaaaaaaaaaaaa", { name: "Updated name", note: "Updated note" }));
    expect(updated?.name).toBe("Updated name");
    await vi.waitFor(() => expect(mocks.insertedEvents).toHaveLength(1));
    expect(mocks.insertedEvents[0]).toMatchObject({
      tenantId: "workspace-1",
      interviewId: new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb"),
      participantId: new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"),
      type: "update",
      meta: { fields: ["name", "note"] },
    });
    expect(mocks.eventOptions[0]).toEqual({ session: { transaction: true } });
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
  });

  it("returns an error when the audit write fails so a host profile edit cannot be reported as committed", async () => {
    mocks.failEvent = true;
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => updateParticipant("aaaaaaaaaaaaaaaaaaaaaaaa", { name: "Updated name" }))).rejects.toThrow("event insert failed");
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.eventOptions[0]).toEqual({ session: { transaction: true } });
  });
});
