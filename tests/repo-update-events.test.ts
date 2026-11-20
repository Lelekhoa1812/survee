import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  events: [] as Record<string, unknown>[],
  findOneAndUpdate: vi.fn(async () => ({ _id: new ObjectId(), name: "Renamed", status: "open" })),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: async (work: (s: unknown) => Promise<unknown>) => work({}),
  col: {
    interviews: async () => ({ findOneAndUpdate: mocks.findOneAndUpdate }),
    events: async () => ({ insertOne: async (doc: Record<string, unknown>) => { mocks.events.push(doc); return { acknowledged: true }; } }),
  },
}));
vi.mock("../src/lib/tenant-context", () => ({
  currentTenantId: async () => "tenant-a",
  currentPrincipal: () => null,
  tenantFilter: (_tenant: string, filter: Record<string, unknown>) => filter,
}));

import { promoteToMultiUser, updateInterview } from "../src/lib/repo";

const id = new ObjectId().toHexString();

async function flush() { await new Promise((resolve) => setTimeout(resolve, 0)); }

describe("updateInterview audit events", () => {
  beforeEach(() => { mocks.events.length = 0; mocks.findOneAndUpdate.mockClear(); });

  it("logs an update event naming the changed fields", async () => {
    await updateInterview(id, { name: "Renamed", description: "Notes" });
    await flush();
    expect(mocks.events).toHaveLength(1);
    expect(mocks.events[0]).toMatchObject({ type: "update", meta: { fields: ["name", "description"] } });
  });

  it("does not log an update event for a status-only change", async () => {
    await updateInterview(id, { status: "closed" });
    await flush();
    expect(mocks.events.map((e) => e.type)).toEqual(["status"]);
  });

  it("logs an update event when a One-person interview is promoted to Multi-user", async () => {
    await promoteToMultiUser(id);
    await flush();
    expect(mocks.events).toHaveLength(1);
    expect(mocks.events[0]).toMatchObject({ type: "update", meta: { fields: ["mode"] } });
  });
});
