import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as any,
  denied: null as Response | null,
  dbCalls: 0,
  auditCalls: 0,
  backfillCalls: 0,
  readJsonCalls: 0,
  audit: { preflight: { readyForReviewedBackfill: true }, collections: {} },
  modified: { interviews: 1 },
}));

vi.mock("@/lib/db", () => ({
  db: async () => { state.dbCalls += 1; return {}; },
}));

vi.mock("@/lib/http", () => ({
  guardAdmin: async () => state.denied,
  adminSession: async () => state.session,
  readJson: async () => {
    state.readJsonCalls += 1;
    return { ok: true, data: { confirmation: "ASSIGN LEGACY DATA TO AXION", backupConfirmed: true } };
  },
  str: (value: unknown) => typeof value === "string" ? value.trim() : undefined,
  fail: (status: number, error: string) => new Response(JSON.stringify({ ok: false, error }), { status }),
  json: (data: unknown) => new Response(JSON.stringify(data), { status: 200 }),
}));

vi.mock("@/lib/tenant-migration", () => ({
  auditTenantMigration: async () => { state.auditCalls += 1; return state.audit; },
  backfillLegacyTenant: async () => { state.backfillCalls += 1; return state.modified; },
}));

import { GET, POST } from "../src/app/api/admin/tenant-migration/route";

function request() {
  return new Request("https://kqa.local/api/admin/tenant-migration", { method: "POST" });
}

describe("legacy tenant migration route authorization", () => {
  beforeEach(() => {
    state.session = { tenantId: "axion", role: "owner" };
    state.denied = null;
    state.dbCalls = 0;
    state.auditCalls = 0;
    state.backfillCalls = 0;
    state.readJsonCalls = 0;
  });

  it("does not expose instance-wide audit counts to another workspace owner", async () => {
    state.session.tenantId = "other-tenant";
    const response = await GET();
    expect(response.status).toBe(403);
    expect(state.auditCalls).toBe(0);
    expect(state.dbCalls).toBe(0);
  });

  it("does not let another workspace owner assign legacy records to Axion", async () => {
    state.session.tenantId = "other-tenant";
    const response = await POST(request());
    expect(response.status).toBe(403);
    expect(state.readJsonCalls).toBe(0);
    expect(state.backfillCalls).toBe(0);
    expect(state.auditCalls).toBe(0);
    expect(state.dbCalls).toBe(0);
  });

  it("allows the Axion owner to review migration counts", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, audit: state.audit });
    expect(state.auditCalls).toBe(1);
    expect(state.dbCalls).toBe(1);
  });

  it("allows the Axion owner to assign legacy data after confirmation", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, modified: state.modified, audit: state.audit });
    expect(state.readJsonCalls).toBe(1);
    expect(state.backfillCalls).toBe(1);
    expect(state.auditCalls).toBe(1);
    expect(state.dbCalls).toBe(2);
  });

  it("denies non-owners in Axion", async () => {
    state.session.role = "admin";
    const response = await GET();
    expect(response.status).toBe(403);
    expect(state.auditCalls).toBe(0);
    expect(state.dbCalls).toBe(0);
  });
});
