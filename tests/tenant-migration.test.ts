import { describe, expect, it } from "vitest";
import { auditTenantMigration } from "../src/lib/tenant-migration";
import type { Db } from "mongodb";

function emptyAuditDb(eventMismatch = 0, tenantMismatch = 0): Db {
  return {
    collection(name: string) {
      return {
        countDocuments: async () => 0,
        aggregate(pipeline: Record<string, unknown>[]) {
          const encoded = JSON.stringify(pipeline);
          let count = 0;
          if (name === "events" && pipeline.some((stage) => "$count" in stage)) {
            if (encoded.includes("$person.interviewId")) count = eventMismatch;
            if (encoded.includes("$interview.tenantId")) count = tenantMismatch;
          }
          return { toArray: async () => count ? [{ count }] : [] };
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
});
