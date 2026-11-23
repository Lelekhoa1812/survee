import { ObjectId } from "mongodb";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ insertedEvents: [] as Record<string, unknown>[], eventOptions: [] as Record<string, unknown>[], revisionUpdates: [] as unknown[], participantUpdates: [] as unknown[], pendingMail: false, resolutionPurpose: null as string | null, mailFilters: [] as Record<string, unknown>[], failEvent: false, withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => {
  const result = await work({ transaction: true });
  if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
  return result;
}) }));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    participants: async () => ({
      findOne: async () => ({ _id: new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"), interviewId: new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb"), email: "person@example.com" }),
      findOneAndUpdate: async (...args: unknown[]) => { mocks.participantUpdates.push(args); return {
        _id: new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"),
        interviewId: new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb"),
        tenantId: "workspace-1", token: "token", name: "Updated name", note: "Updated note", email: "person@example.com",
        status: "invited", answers: {}, revision: 0, writeEpoch: 0, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
      }; },
    }),
    mail: async () => ({ findOne: async (filter: Record<string, unknown>) => { mocks.mailFilters.push(filter); const clauses = filter.$and as Record<string, unknown>[] | undefined; const guard = clauses?.find((clause) => "resolution" in clause) ?? filter; const allowsResolved = (guard.resolution as { $exists?: boolean } | undefined)?.$exists === false; return mocks.pendingMail && !(allowsResolved && Boolean(mocks.resolutionPurpose)) ? { _id: new ObjectId("cccccccccccccccccccccccc") } : null; } }),
    interviews: async () => ({ updateOne: async (...args: unknown[]) => { mocks.revisionUpdates.push(args); return { matchedCount: 1 }; } }),
    events: async () => ({ insertOne: async (event: Record<string, unknown>, options: Record<string, unknown>) => { mocks.insertedEvents.push(event); mocks.eventOptions.push(options); if (mocks.failEvent) throw new Error("event insert failed"); } }),
  },
}));

import { updateParticipant } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

afterEach(() => { mocks.insertedEvents.length = 0; mocks.eventOptions.length = 0; mocks.revisionUpdates.length = 0; mocks.participantUpdates.length = 0; mocks.mailFilters.length = 0; mocks.pendingMail = false; mocks.resolutionPurpose = null; mocks.failEvent = false; });

describe("updateParticipant", () => {
  it("records which participant fields changed in the interview event stream", async () => {
    const updated = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => updateParticipant("aaaaaaaaaaaaaaaaaaaaaaaa", { name: "Updated name", note: "Updated note" }));
    if (!updated || updated === "invite_pending") throw new Error("Expected participant update result.");
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
    expect(mocks.revisionUpdates[0]).toEqual([
      tenantFilter("workspace-1", { _id: new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb") }),
      { $inc: { respondentWriteRevision: 1 } },
      { session: { transaction: true } },
    ]);
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
  });

  it("returns an error when the audit write fails so a host profile edit cannot be reported as committed", async () => {
    mocks.failEvent = true;
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => updateParticipant("aaaaaaaaaaaaaaaaaaaaaaaa", { name: "Updated name" }))).rejects.toThrow("event insert failed");
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.eventOptions[0]).toEqual({ session: { transaction: true } });
    expect(mocks.revisionUpdates).toHaveLength(1);
  });

  it("refuses to change or clear an email while an invite outcome is unresolved", async () => {
    mocks.pendingMail = true;
    const result = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => updateParticipant("aaaaaaaaaaaaaaaaaaaaaaaa", { email: "new@example.com" }));
    expect(result).toBe("invite_pending");
    expect(mocks.participantUpdates).toHaveLength(0);
    expect(mocks.insertedEvents).toHaveLength(0);
  });

  it("allows an email change after a host has acknowledged the ambiguous attempt", async () => {
    mocks.pendingMail = true;
    mocks.resolutionPurpose = "email_change";
    const result = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => updateParticipant("aaaaaaaaaaaaaaaaaaaaaaaa", { email: "new@example.com" }));
    expect(result).not.toBe("invite_pending");
    expect(mocks.mailFilters[0]).toEqual(tenantFilter("workspace-1", { participantId: new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa"), status: "pending", delivery: { $nin: ["delivered", "bounced"] }, resolution: { $exists: false } }));
  });

  it("allows an acknowledged link replacement to be followed by an email change", async () => {
    mocks.pendingMail = true;
    mocks.resolutionPurpose = "token_rotation";
    const result = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => updateParticipant("aaaaaaaaaaaaaaaaaaaaaaaa", { email: "new@example.com" }));
    expect(result).not.toBe("invite_pending");
  });
});
