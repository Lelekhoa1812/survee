import { describe, expect, it } from "vitest";
import { currentTenantId, tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

describe("tenant scope", () => {
  it("binds Axion queries to Axion plus legacy unscoped rows during migration", () => {
    expect(tenantFilter("axion", { interviewId: "legacy-id" })).toEqual({
      $and: [
        { $or: [{ tenantId: "axion" }, { tenantId: { $exists: false } }] },
        { interviewId: "legacy-id" },
      ],
    });
  });

  it("does not include unscoped or other-tenant rows for a new workspace", () => {
    expect(tenantFilter("tenant-b", { interviewId: "shared-id" })).toEqual({
      $and: [{ tenantId: "tenant-b" }, { interviewId: "shared-id" }],
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
