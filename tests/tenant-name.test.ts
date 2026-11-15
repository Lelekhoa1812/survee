import { beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ tenants: [] as any[], updateCount: 0 }));

vi.mock("../src/lib/db", () => ({
  col: {
    tenants: async () => ({
      updateOne: async (query: Record<string, unknown>, update: Record<string, any>) => {
        store.updateCount += 1;
        const tenant = store.tenants.find((item) => item._id === query._id && item.status === query.status);
        if (!tenant) return { matchedCount: 0 };
        Object.assign(tenant, update.$set);
        return { matchedCount: 1 };
      },
    }),
  },
}));

import { updateTenantName } from "../src/lib/repo/accounts";

describe("workspace name updates", () => {
  beforeEach(() => {
    store.tenants = [
      { _id: "axion", name: "Axion", status: "active", slug: "axion" },
      { _id: "suspended", name: "Paused", status: "suspended", slug: "paused" },
    ];
    store.updateCount = 0;
  });

  it("trims and updates the name and timestamp of the requested active tenant", async () => {
    await expect(updateTenantName("axion", "  Axion Research  ")).resolves.toBe(true);
    expect(store.tenants[0]).toMatchObject({ name: "Axion Research", status: "active", slug: "axion" });
    expect(store.tenants[0].updatedAt).toBeInstanceOf(Date);
    expect(store.updateCount).toBe(1);
  });

  it("does not update blank, overlong, or control-character names", async () => {
    await expect(updateTenantName("axion", "   ")).resolves.toBe(false);
    await expect(updateTenantName("axion", "x".repeat(101))).resolves.toBe(false);
    await expect(updateTenantName("axion", "Axion\nResearch")).resolves.toBe(false);
    expect(store.updateCount).toBe(0);
  });

  it("does not rename suspended or missing tenants", async () => {
    await expect(updateTenantName("suspended", "Current name")).resolves.toBe(false);
    await expect(updateTenantName("missing", "Current name")).resolves.toBe(false);
    expect(store.tenants[1].name).toBe("Paused");
    expect(store.updateCount).toBe(2);
  });
});
