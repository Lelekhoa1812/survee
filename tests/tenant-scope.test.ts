import { describe, expect, it } from "vitest";
import { currentTenantId, tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

function withLegacyFallback(value: string | undefined, run: () => void) {
  const previous = process.env.KQA_AXION_LEGACY_TENANT_FALLBACK;
  if (value === undefined) delete process.env.KQA_AXION_LEGACY_TENANT_FALLBACK;
  else process.env.KQA_AXION_LEGACY_TENANT_FALLBACK = value;
  try {
    run();
  } finally {
    if (previous === undefined) delete process.env.KQA_AXION_LEGACY_TENANT_FALLBACK;
    else process.env.KQA_AXION_LEGACY_TENANT_FALLBACK = previous;
  }
}

describe("tenant scope", () => {
  it("binds Axion queries to Axion plus legacy unscoped rows during migration", () => {
    withLegacyFallback("true", () => {
      expect(tenantFilter("axion", { interviewId: "legacy-id" })).toEqual({
        $and: [
          { $or: [{ tenantId: "axion" }, { tenantId: { $exists: false } }] },
          { interviewId: "legacy-id" },
        ],
      });
    });
  });

  it("does not include unscoped or other-tenant rows for a new workspace", () => {
    expect(tenantFilter("tenant-b", { interviewId: "shared-id" })).toEqual({
      $and: [{ tenantId: "tenant-b" }, { interviewId: "shared-id" }],
    });
  });

  it("can enforce strict Axion tenant filters after the reviewed legacy backfill", () => {
    withLegacyFallback(" FALSE ", () => {
      expect(tenantFilter("axion", { interviewId: "migrated-id" })).toEqual({
        $and: [{ tenantId: "axion" }, { interviewId: "migrated-id" }],
      });
    });
  });

  it("keeps legacy compatibility enabled when no cutover value is configured", () => {
    withLegacyFallback(undefined, () => {
      expect(tenantFilter("axion")).toEqual({ $or: [{ tenantId: "axion" }, { tenantId: { $exists: false } }] });
    });
  });

  it("uses the authenticated principal tenant, independent of request arguments", async () => {
    const tenantId = await withTenantPrincipal(
      { tenantId: "tenant-b", userId: "000000000000000000000001", role: "owner", source: "session" },
      currentTenantId,
    );
    expect(tenantId).toBe("tenant-b");
  });
});
