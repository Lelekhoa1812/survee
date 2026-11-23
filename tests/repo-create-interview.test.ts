import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interviewInserts: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  versionInserts: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  participantInserts: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  events: [] as Array<{ document: Record<string, unknown>; options: Record<string, unknown> }>,
  failVersionInsert: false,
  failParticipantInsert: false,
  failEventInsert: false,
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work({ transaction: true })),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    interviews: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.interviewInserts.push({ document, options }); } }),
    versions: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.versionInserts.push({ document, options }); if (mocks.failVersionInsert) throw new Error("version insert failed"); } }),
    participants: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.participantInserts.push({ document, options }); if (mocks.failParticipantInsert) throw new Error("participant insert failed"); } }),
    events: async () => ({ insertOne: async (document: Record<string, unknown>, options: Record<string, unknown>) => { mocks.events.push({ document, options }); if (mocks.failEventInsert) throw new Error("event insert failed"); return {}; } }),
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
  mocks.participantInserts.length = 0;
  mocks.events.length = 0;
  mocks.failVersionInsert = false;
  mocks.failParticipantInsert = false;
  mocks.failEventInsert = false;
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
});
