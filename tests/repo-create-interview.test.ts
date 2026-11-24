import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interviewInserts: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  versionInserts: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  participantInserts: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  events: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  operations: [] as Array<Record<string, unknown>>,
  failVersionInsert: false,
  failParticipantInsert: false,
  failEventInsert: false,
  transactionTail: Promise.resolve() as Promise<void>,
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => {
    const previous = mocks.transactionTail;
    let release!: () => void;
    mocks.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const result = await work({ transaction: true });
      if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
      return result;
    } finally { release(); }
  }),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    interviews: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.interviewInserts.push({ document, options }); } }),
    versions: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.versionInserts.push({ document, options }); if (mocks.failVersionInsert) throw new Error("version insert failed"); } }),
    participants: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.participantInserts.push({ document, options }); if (mocks.failParticipantInsert) throw new Error("participant insert failed"); } }),
    events: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.events.push({ document, options }); if (mocks.failEventInsert) throw new Error("event insert failed"); return {}; } }),
    mcpOperations: async () => ({
      findOne: async (filter: Record<string, unknown>) => mocks.operations.find((row) => Object.entries(filter).every(([key, value]) => row[key] === value)) ?? null,
      deleteOne: async (filter: { _id: unknown }) => { const index = mocks.operations.findIndex((row) => row._id === filter._id); if (index >= 0) mocks.operations.splice(index, 1); return { deletedCount: index >= 0 ? 1 : 0 }; },
      insertOne: async (row: Record<string, unknown>) => {
        if (mocks.operations.some((current) => ["tenantId", "tool", "credentialIdHash", "operationIdHash"].every((key) => current[key] === row[key]))) throw Object.assign(new Error("duplicate key"), { code: 11000 });
        mocks.operations.push(row);
        return { insertedId: row._id };
      },
    }),
  },
}));

import { createInterview, createInterviewWithOperation } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const survey = {
  html: "<html></html>",
  manifest: { format: "kqa/1" as const, title: "Test", questions: [] },
  check: { errors: 0, warnings: 0, info: 0, checkedAt: "now", checkerVersion: "test" },
};

beforeEach(() => {
  mocks.interviewInserts.length = 0;
  mocks.versionInserts.length = 0;
  mocks.participantInserts.length = 0;
  mocks.events.length = 0;
  mocks.operations.length = 0;
  mocks.transactionTail = Promise.resolve();
  mocks.failVersionInsert = false;
  mocks.failParticipantInsert = false;
  mocks.failEventInsert = false;
  mocks.withMongoTransaction.mockReset().mockImplementation(async (work) => {
    const previous = mocks.transactionTail;
    let release!: () => void;
    mocks.transactionTail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      const result = await work({ transaction: true });
      if (result === undefined) throw new Error("MongoDB transaction completed without a result.");
      return result;
    } finally { release(); }
  });
});

describe("createInterview", () => {
  it("inserts the interview and initial version in the same tenant transaction", async () => {
    const created = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => createInterview({ name: "Test", mode: "multi", survey }));
    expect(created).toMatchObject({ tenantId: "workspace-1", currentVersion: 1 });
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.interviewInserts).toHaveLength(1);
    expect(mocks.versionInserts).toHaveLength(1);
    expect(mocks.interviewInserts[0].options).toEqual({ session: { transaction: true } });
    expect(mocks.versionInserts[0]).toMatchObject({
      document: { tenantId: "workspace-1", interviewId: created._id, version: 1, html: survey.html },
      options: { session: { transaction: true } },
    });
    expect(mocks.events[0]).toMatchObject({ document: { type: "created", tenantId: "workspace-1", interviewId: created._id }, options: { session: { transaction: true } } });
  });

  it("propagates an initial-version write failure so the transaction can roll back the interview", async () => {
    mocks.failVersionInsert = true;
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => createInterview({ name: "Test", mode: "multi", survey }))).rejects.toThrow("version insert failed");
    expect(mocks.interviewInserts).toHaveLength(1);
    expect(mocks.versionInserts).toHaveLength(1);
    expect(mocks.interviewInserts[0].options.session).toBe(mocks.versionInserts[0].options.session);
  });

  it("creates a single-mode interview, its default person, version, and audit event in one transaction", async () => {
    const created = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => createInterview({ name: "Solo", mode: "single", survey }));
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
    expect(mocks.participantInserts).toHaveLength(1);
    expect(mocks.participantInserts[0]).toMatchObject({ document: { tenantId: "workspace-1", interviewId: created._id, name: "Respondent", status: "invited", answers: {} }, options: { session: { transaction: true } } });
    expect(mocks.interviewInserts[0].options.session).toBe(mocks.participantInserts[0].options.session);
    expect(mocks.participantInserts[0].options.session).toBe(mocks.events[0].options.session);
  });

  it("propagates default-person or audit write failures so interview creation rolls back", async () => {
    mocks.failParticipantInsert = true;
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => createInterview({ name: "Solo", mode: "single", survey }))).rejects.toThrow("participant insert failed");
    expect(mocks.interviewInserts[0].options.session).toBe(mocks.versionInserts[0].options.session);
    expect(mocks.versionInserts[0].options.session).toBe(mocks.participantInserts[0].options.session);

    mocks.failParticipantInsert = false;
    mocks.failEventInsert = true;
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => createInterview({ name: "Solo", mode: "single", survey }))).rejects.toThrow("event insert failed");
    expect(mocks.interviewInserts.at(-1)?.options.session).toBe(mocks.events.at(-1)?.options.session);
  });

  it("replays the original create result for the same operation key and arguments", async () => {
    const operation = { operationId: "request-1", credentialId: "api_key:key-a", argumentDigest: "digest-a", report: { ok: true, counts: { error: 0 }, diagnostics: [] } };
    const first = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => createInterviewWithOperation({ name: "Test", mode: "multi", survey }, operation));
    const replay = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => createInterviewWithOperation({ name: "Test", mode: "multi", survey }, operation));
    expect(first.kind).toBe("created");
    if (first.kind !== "created") throw new Error("expected create success");
    expect(replay).toEqual({ kind: "replayed", result: first.result });
    expect(mocks.interviewInserts).toHaveLength(1);
    expect(mocks.operations).toHaveLength(1);
    expect(mocks.operations[0]).toMatchObject({ tool: "create_interview", tenantId: "workspace-1", expiresAt: expect.any(Date) });
    expect((mocks.operations[0].expiresAt as Date).getTime() - (mocks.operations[0].createdAt as Date).getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it("keeps host REST operation receipts separate from MCP receipts", async () => {
    const operation = { operationId: "request-1", credentialId: "host:user-a", tool: "host_create_interview", argumentDigest: "digest-a", report: { ok: true } };
    const host = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => createInterviewWithOperation({ name: "Test", mode: "multi", survey }, operation));
    const mcp = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => createInterviewWithOperation({ name: "Test", mode: "multi", survey }, { ...operation, tool: undefined, credentialId: "api_key:key-a" }));
    expect([host.kind, mcp.kind]).toEqual(["created", "created"]);
    expect(mocks.operations.map((item) => item.tool)).toEqual(["host_create_interview", "create_interview"]);
  });

  it("rejects reuse of a create operation key with different arguments", async () => {
    const base = { operationId: "request-1", credentialId: "api_key:key-a", argumentDigest: "digest-a", report: { ok: true } };
    await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => createInterviewWithOperation({ name: "Test", mode: "multi", survey }, base));
    const mismatch = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => createInterviewWithOperation({ name: "Different", mode: "multi", survey }, { ...base, argumentDigest: "digest-b" }));
    expect(mismatch).toEqual({ kind: "conflict" });
    expect(mocks.interviewInserts).toHaveLength(1);
  });

  it("isolates operation keys by tenant and credential", async () => {
    const operation = { operationId: "request-1", credentialId: "api_key:key-a", argumentDigest: "digest-a", report: { ok: true } };
    const first = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => createInterviewWithOperation({ name: "Test", mode: "multi", survey }, operation));
    const credential = await withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => createInterviewWithOperation({ name: "Test", mode: "multi", survey }, { ...operation, credentialId: "api_key:key-b" }));
    const tenant = await withTenantPrincipal({ tenantId: "workspace-2", role: "admin", source: "api_key" }, () => createInterviewWithOperation({ name: "Test", mode: "multi", survey }, operation));
    expect([first.kind, credential.kind, tenant.kind]).toEqual(["created", "created", "created"]);
    expect(mocks.interviewInserts).toHaveLength(3);
    expect(mocks.operations).toHaveLength(3);
  });

  it("creates only one interview for concurrent duplicate operation keys", async () => {
    const operation = { operationId: "request-1", credentialId: "api_key:key-a", argumentDigest: "digest-a", report: { ok: true } };
    const results = await Promise.all([1, 2].map(() => withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "api_key" }, () => createInterviewWithOperation({ name: "Test", mode: "multi", survey }, operation))));
    expect(results.map((result) => result.kind).sort()).toEqual(["created", "replayed"]);
    const ids = results.flatMap((result) => result.kind === "created" || result.kind === "replayed" ? [result.result.id] : []);
    expect(ids[0]).toBe(ids[1]);
    expect(mocks.interviewInserts).toHaveLength(1);
    expect(mocks.operations).toHaveLength(1);
  });
});
