import { readFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interviewFilter: null as Record<string, unknown> | null,
  versionFilter: null as Record<string, unknown> | null,
  participantFilter: null as Record<string, unknown> | null,
  participantOptions: null as Record<string, unknown> | null,
  people: [] as Record<string, any>[],
  failAfter: -1,
  close: vi.fn(async () => {}),
}));

vi.mock("../src/lib/db", () => ({
  col: {
    interviews: async () => ({ findOne: async (filter: Record<string, unknown>) => { mocks.interviewFilter = filter; return { currentVersion: 1, respondentWriteRevision: 123 }; } }),
    versions: async () => ({ findOne: async (filter: Record<string, unknown>) => { mocks.versionFilter = filter; return { manifest: { format: "kqa/1", title: "Old", questions: [{ id: "removed", type: "text", label: "Old question" }] } }; } }),
    participants: async () => ({
      find: (filter: Record<string, unknown>, options: Record<string, unknown>) => {
        mocks.participantFilter = filter;
        mocks.participantOptions = options;
        let index = 0;
        return {
          [Symbol.asyncIterator]: async function* () {
            while (index < mocks.people.length) {
              if (mocks.failAfter >= 0 && index === mocks.failAfter) throw new Error("cursor failed");
              yield mocks.people[index++];
            }
          },
          toArray: async () => { throw new Error("compatibility scan must not materialize the cohort"); },
          close: mocks.close,
        };
      },
    }),
  },
}));

import { prepareSurvey, withCompat } from "../src/lib/survey";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const tenantId = "compat-tenant";
const interviewId = new ObjectId("aaaaaaaaaaaaaaaaaaaaaaaa").toHexString();
const prepared = prepareSurvey(readFileSync(new URL("../docs/template/starter.kqa.html", import.meta.url), "utf8"));

beforeEach(() => {
  mocks.interviewFilter = null;
  mocks.versionFilter = null;
  mocks.participantFilter = null;
  mocks.participantOptions = null;
  mocks.people = [];
  mocks.failAfter = -1;
  mocks.close.mockReset().mockResolvedValue(undefined);
});

describe("withCompat", () => {
  it("streams a large cohort, closes its cursor, and captures the revision used by publication", async () => {
    mocks.people = Array.from({ length: 1000 }, () => ({ status: "in_progress", answers: { removed: { value: "saved", updatedAt: "now" } }, recordGroups: {} }));
    const result = await withTenantPrincipal({ tenantId, role: "service", source: "service_token" }, () => withCompat(prepared, interviewId));
    expect(result.compatibilityRevision).toBe(123);
    expect(result.report.diagnostics.find((diagnostic) => diagnostic.code === "KQA700")?.message).toContain("1000 people have answered it");
    expect(mocks.participantFilter).toEqual(tenantFilter(tenantId, { interviewId: new ObjectId(interviewId) }));
    expect(mocks.participantOptions).toEqual({ projection: { answers: 1, recordGroups: 1, status: 1 } });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("closes the cursor when a compatibility scan fails", async () => {
    mocks.people = [
      { status: "in_progress", answers: {}, recordGroups: {} },
      { status: "in_progress", answers: {}, recordGroups: {} },
    ];
    mocks.failAfter = 1;
    await expect(withTenantPrincipal({ tenantId, role: "service", source: "service_token" }, () => withCompat(prepared, interviewId))).rejects.toThrow("cursor failed");
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
