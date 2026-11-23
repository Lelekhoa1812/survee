import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interviewInserts: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  versionInserts: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  failVersionInsert: false,
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work({ transaction: true })),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    interviews: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.interviewInserts.push({ document, options }); } }),
    versions: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.versionInserts.push({ document, options }); if (mocks.failVersionInsert) throw new Error("version insert failed"); } }),
    events: async () => ({ insertOne: async () => ({}) }),
  },
}));

import { createInterview } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const survey = {
  html: "<html></html>",
  manifest: { format: "kqa/1" as const, title: "Test", questions: [] },
  check: { errors: 0, warnings: 0, info: 0, checkedAt: "now", checkerVersion: "test" },
};

beforeEach(() => {
  mocks.interviewInserts.length = 0;
  mocks.versionInserts.length = 0;
  mocks.failVersionInsert = false;
  mocks.withMongoTransaction.mockReset().mockImplementation(async (work) => work({ transaction: true }));
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
  });

  it("propagates an initial-version write failure so the transaction can roll back the interview", async () => {
    mocks.failVersionInsert = true;
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, () => createInterview({ name: "Test", mode: "multi", survey }))).rejects.toThrow("version insert failed");
    expect(mocks.interviewInserts).toHaveLength(1);
    expect(mocks.versionInserts).toHaveLength(1);
    expect(mocks.interviewInserts[0].options.session).toBe(mocks.versionInserts[0].options.session);
  });
});
