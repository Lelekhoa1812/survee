import { describe, expect, it, vi } from "vitest";
import { auditTenantMigration, backfillLegacyTenant } from "../src/lib/tenant-migration";
import type { Db } from "mongodb";

function emptyAuditDb(eventMismatch = 0, tenantMismatch = 0, otherTenantCount = 0, writes = vi.fn()): Db {
  return {
    collection(name: string) {
      return {
        countDocuments: async (filter: Record<string, unknown> = {}) => {
          if (name === "interviews" && Object.keys(filter).length === 0) return otherTenantCount;
          const tenantFilter = filter.tenantId as Record<string, unknown> | undefined;
          if (name === "interviews" && tenantFilter?.$exists === true) return otherTenantCount;
          if (name === "interviews" && tenantFilter?.$ne === "axion") return otherTenantCount;
          return 0;
        },
        aggregate(pipeline: Record<string, unknown>[]) {
          const encoded = JSON.stringify(pipeline);
          let count = 0;
          if (name === "events" && pipeline.some((stage) => "$count" in stage)) {
            if (encoded.includes("$person.interviewId")) count = eventMismatch;
            if (encoded.includes("$interview.tenantId")) count = tenantMismatch;
          }
          return { toArray: async () => count ? [{ count }] : [] };
        },
        updateOne: async () => { writes(); return { upsertedCount: 0 }; },
        updateMany: async () => { writes(); return { modifiedCount: 0 }; },
      };
    },
  } as unknown as Db;
}

function backfillDb(verifyWrites: boolean): Db {
  let interviewScoped = false;
  return {
    collection(name: string) {
      return {
        countDocuments: async (filter: Record<string, unknown> = {}) => {
          if (name !== "interviews") return 0;
          if (Object.keys(filter).length === 0) return 1;
          const tenantFilter = filter.tenantId as Record<string, unknown> | undefined;
          if (tenantFilter?.$ne === "axion") return 0;
          if (tenantFilter?.$exists === true) return interviewScoped ? 1 : 0;
          return 0;
        },
        aggregate: () => ({ toArray: async () => [] }),
        updateOne: async () => ({ upsertedCount: 0 }),
        updateMany: async () => {
          if (name === "interviews" && verifyWrites) interviewScoped = true;
          return { modifiedCount: verifyWrites && name === "interviews" ? 1 : 0 };
        },
      };
    },
  } as unknown as Db;
}

describe("tenant migration preflight", () => {
  it("allows assignment when only missing legacy event links need preservation", async () => {
    const audit = await auditTenantMigration(emptyAuditDb());
    expect(audit.legacyEventReferences.eventsInterviewParticipantMismatch).toBe(0);
    expect(audit.legacyEventReferences.eventsTenantMismatch).toBe(0);
    expect(audit.preflight.readyForReviewedBackfill).toBe(true);
  });

  it("blocks records that point across interviews or tenant boundaries", async () => {
    const audit = await auditTenantMigration(emptyAuditDb(2, 1));
    expect(audit.legacyEventReferences.eventsInterviewParticipantMismatch).toBe(2);
    expect(audit.legacyEventReferences.eventsTenantMismatch).toBe(1);
    expect(audit.preflight.readyForReviewedBackfill).toBe(false);
  });

  it("blocks a syntactically valid tenant ID that is not Axion", async () => {
    const audit = await auditTenantMigration(emptyAuditDb(0, 0, 1));
    expect(audit.collections.interviews.otherTenant).toBe(1);
    expect(audit.preflight.tenantIdsMatchAxion).toBe(false);
    expect(audit.preflight.readyForReviewedBackfill).toBe(false);
  });

  it("does not write anything while another tenant owns legacy records", async () => {
    const writes = vi.fn();
    await expect(backfillLegacyTenant(emptyAuditDb(0, 0, 1, writes))).rejects.toThrow("Tenant preflight is not ready");
    expect(writes).not.toHaveBeenCalled();
  });

  it("checks the final audit and refuses to report a backfill that left unscoped records", async () => {
    await expect(backfillLegacyTenant(backfillDb(false))).rejects.toThrow("Tenant backfill verification found unscoped records");
    await expect(backfillLegacyTenant(backfillDb(true))).resolves.toMatchObject({ interviews: 1 });
  });
});
