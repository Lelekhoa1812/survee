import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as Record<string, unknown>[],
  eventOptions: [] as Record<string, unknown>[],
  failEvent: false,
  findOneAndUpdate: vi.fn(async () => ({ _id: new ObjectId(), name: "Renamed", status: "open" })),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: async (work: (s: unknown) => Promise<unknown>) => {
    const result = await work({ transaction: true });
    if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
    return result;
  },
  col: {
    interviews: async () => ({ findOneAndUpdate: mocks.findOneAndUpdate }),
    events: async () => ({ insertOne: async (doc: Record<string, unknown>, options: Record<string, unknown>) => { mocks.events.push(doc); mocks.eventOptions.push(options); if (mocks.failEvent) throw new Error("event insert failed"); return { acknowledged: true }; } }),
  },
}));
vi.mock("../src/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-a",
  currentPrincipal: () => null,
  tenantFilter: (_tenant: string, filter: Record<string, unknown>) => filter,
}));

import { updateInterview } from "../src/lib/repo";

const id = new ObjectId().toHexString();

describe("updateInterview audit events", () => {
  beforeEach(() => { mocks.events.length = 0; mocks.eventOptions.length = 0; mocks.failEvent = false; mocks.findOneAndUpdate.mockClear(); });

  it("logs an update event naming the changed fields", async () => {
    await updateInterview(id, { name: "Renamed", description: "Notes" });
    expect(mocks.events).toHaveLength(1);
    expect(mocks.events[0]).toMatchObject({ type: "update", meta: { fields: ["name", "description"] } });
    expect(mocks.eventOptions[0]).toEqual({ session: { transaction: true } });
  });

  it("does not log an update event for a status-only change", async () => {
    await updateInterview(id, { status: "closed" });
    expect(mocks.events.map((e) => e.type)).toEqual(["status"]);
  });

  it("does not report an interview update as successful when its audit event cannot be stored", async () => {
    mocks.failEvent = true;
    await expect(updateInterview(id, { name: "Renamed" })).rejects.toThrow("event insert failed");
    expect(mocks.eventOptions[0]).toEqual({ session: { transaction: true } });
  });
});
