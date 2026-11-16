import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  user: null as any,
  memberships: [] as any[],
  tenants: [] as any[],
}));

vi.mock("../src/lib/password-kdf", () => ({
  PASSWORD_HASH_BYTES: 64,
  PASSWORD_HASH_COST: 16_384,
  derivePasswordKey: vi.fn(async () => Buffer.alloc(64, 7)),
}));

vi.mock("../src/lib/db", () => ({
  col: {
    users: async () => ({ findOne: async (filter: any) => state.user?.email === filter.email ? state.user : null }),
    memberships: async () => ({
      find: (filter: any) => ({
        sort() { return this; },
        toArray: async () => state.memberships.filter((item) => item.userId.equals(filter.userId)),
      }),
    }),
    tenants: async () => ({
      find: (filter: any) => ({
        toArray: async () => state.tenants.filter((tenant) => filter._id.$in.includes(tenant._id) && tenant.status === filter.status),
      }),
    }),
  },
}));

import { authenticateAccount } from "../src/lib/repo/accounts";

const userId = new ObjectId("000000000000000000000001");
const passwordHash = `scrypt$16384$salt$${Buffer.alloc(64, 7).toString("base64url")}`;

beforeEach(() => {
  state.user = { _id: userId, email: "owner@example.test", emailVerifiedAt: new Date(), passwordHash, lastTenantId: "workspace-b" };
  state.memberships = [
    { _id: new ObjectId(), tenantId: "axion", userId, role: "owner", createdAt: new Date("2026-01-01T00:00:00Z") },
    { _id: new ObjectId(), tenantId: "workspace-b", userId, role: "admin", createdAt: new Date("2026-02-01T00:00:00Z") },
  ];
  state.tenants = [
    { _id: "axion", name: "Axion", status: "active" },
    { _id: "workspace-b", name: "Workspace B", status: "active" },
  ];
});

describe("account workspace selection", () => {
  it("signs in to the last workspace used when the account still belongs to it", async () => {
    await expect(authenticateAccount(" OWNER@example.test ", "valid password")).resolves.toMatchObject({
      tenantId: "workspace-b", tenantName: "Workspace B", role: "admin",
    });
  });

  it("falls back to the first active membership when the saved workspace is unavailable", async () => {
    state.tenants = state.tenants.filter((tenant) => tenant._id !== "workspace-b");
    await expect(authenticateAccount("owner@example.test", "valid password")).resolves.toMatchObject({
      tenantId: "axion", tenantName: "Axion", role: "owner",
    });
  });

  it("does not let a stale workspace preference create membership access", async () => {
    state.user.lastTenantId = "not-a-member";
    await expect(authenticateAccount("owner@example.test", "valid password")).resolves.toMatchObject({ tenantId: "axion" });
  });
});
