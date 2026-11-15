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

function analyticsRunsMigrationDb(initialTenants: (string | undefined)[], analyticsRunsTenantMismatch = 0): { db: Db; tenants: (string | undefined)[] } {
  const tenants = [...initialTenants];
  return {
    tenants,
    db: {
      collection(name: string) {
        return {
          countDocuments: async (filter: Record<string, unknown> = {}) => {
            if (name !== "analytics_runs") return 0;
            if (Object.keys(filter).length === 0) return tenants.length;
            const tenantFilter = filter.tenantId as Record<string, unknown> | undefined;
            if (tenantFilter?.$ne === "axion") return tenants.filter((tenantId) => tenantId !== undefined && tenantId !== "axion").length;
            if (tenantFilter?.$exists === true) return tenants.filter((tenantId) => tenantId !== undefined).length;
            return 0;
          },
          aggregate: () => ({ toArray: async () => name === "analytics_runs" && analyticsRunsTenantMismatch ? [{ count: analyticsRunsTenantMismatch }] : [] }),
          updateOne: async () => ({ upsertedCount: 0 }),
          updateMany: async () => {
            if (name !== "analytics_runs") return { modifiedCount: 0 };
            const missingIndexes = tenants.flatMap((tenantId, index) => tenantId === undefined ? [index] : []);
            for (const index of missingIndexes) tenants[index] = "axion";
            return { modifiedCount: missingIndexes.length };
          },
        };
      },
    } as unknown as Db,
  };
}

function partialBackfillDb(failOnceAt: string): { db: Db; scoped: Set<string> } {
  const ownedCollections = ["interviews", "survey_versions", "participants", "events", "mail_messages", "api_keys", "oauth_codes", "analytics_runs"];
  const scoped = new Set<string>();
  let shouldFail = true;
  return {
    scoped,
    db: {
      collection(name: string) {
        return {
          countDocuments: async (filter: Record<string, unknown> = {}) => {
            if (!ownedCollections.includes(name)) return 0;
            if (Object.keys(filter).length === 0) return 1;
            const tenantFilter = filter.tenantId as Record<string, unknown> | undefined;
            if (tenantFilter?.$ne === "axion") return 0;
            if (tenantFilter?.$exists === true) return scoped.has(name) ? 1 : 0;
            return 0;
          },
          aggregate: () => ({ toArray: async () => [] }),
          updateOne: async () => ({ upsertedCount: 0 }),
          updateMany: async () => {
            if (name === failOnceAt && shouldFail) {
              shouldFail = false;
              throw new Error("simulated interrupted backfill");
            }
            if (!ownedCollections.includes(name) || scoped.has(name)) return { modifiedCount: 0 };
            scoped.add(name);
            return { modifiedCount: 1 };
          },
        };
      },
    } as unknown as Db,
  };
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

  it("counts and assigns unscoped aggregate analytics runs to Axion", async () => {
    const { db, tenants } = analyticsRunsMigrationDb([undefined, "axion"]);
    const before = await auditTenantMigration(db);

    expect(before.collections.analytics_runs).toEqual({ documents: 2, alreadyTenantScoped: 1, missingTenant: 1, otherTenant: 0 });
    expect(before.preflight.readyForReviewedBackfill).toBe(true);

    const modified = await backfillLegacyTenant(db);
    const after = await auditTenantMigration(db);
    expect(modified.analytics_runs).toBe(1);
    expect(tenants).toEqual(["axion", "axion"]);
    expect(after.collections.analytics_runs.missingTenant).toBe(0);
  });

  it("blocks analytics-run records with cross-tenant ownership references", async () => {
    const otherTenant = await auditTenantMigration(analyticsRunsMigrationDb(["other-tenant"]).db);
    expect(otherTenant.collections.analytics_runs.otherTenant).toBe(1);
    expect(otherTenant.preflight.readyForReviewedBackfill).toBe(false);

    const mismatchedReference = await auditTenantMigration(analyticsRunsMigrationDb([undefined], 1).db);
    expect(mismatchedReference.blockingIntegrity.analyticsRunsTenantMismatch).toBe(1);
    expect(mismatchedReference.preflight.readyForReviewedBackfill).toBe(false);
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

  it("resumes safely after a partial write when a backfill is retried", async () => {
    const { db, scoped } = partialBackfillDb("survey_versions");

    await expect(backfillLegacyTenant(db)).rejects.toThrow("simulated interrupted backfill");
    expect([...scoped]).toEqual(["interviews"]);

    const retried = await backfillLegacyTenant(db);
    expect(retried.interviews).toBe(0);
    expect(retried.survey_versions).toBe(1);
    expect(scoped.size).toBe(8);
    const audit = await auditTenantMigration(db);
    expect(audit.preflight.readyForReviewedBackfill).toBe(true);
    expect(Object.values(audit.collections).filter((collection) => "missingTenant" in collection).every((collection) => collection.missingTenant === 0)).toBe(true);
  });
});
