import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interviews: [] as Record<string, any>[],
  participantGroups: [] as Record<string, any>[],
  interviewFilter: null as Record<string, any> | null,
  interviewSort: null as Record<string, number> | null,
  aggregatePipeline: [] as Record<string, any>[],
  aggregateFilter: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  col: {
    interviews: async () => ({
      find: (filter: Record<string, any>) => {
        mocks.interviewFilter = filter;
        return {
          sort: (sort: Record<string, number>) => {
            mocks.interviewSort = sort;
            return { toArray: async () => mocks.interviews };
          },
        };
      },
    }),
    participants: async () => ({
      aggregate: (pipeline: Record<string, any>[]) => {
        mocks.aggregatePipeline = pipeline;
        const rows = mocks.participantGroups as Record<string, any>[] & { filter: typeof Array.prototype.filter };
        rows.filter = mocks.aggregateFilter as unknown as typeof Array.prototype.filter;
        return { toArray: async () => rows };
      },
    }),
  },
}));

import { listInterviews } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const tenantId = "workspace-1";
const interviewA = new ObjectId("111111111111111111111111");
const interviewB = new ObjectId("222222222222222222222222");
const interviewWithoutPeople = new ObjectId("333333333333333333333333");

beforeEach(() => {
  mocks.interviews = [
    { _id: interviewA, name: "A", mode: "multi", status: "open", currentVersion: 2, createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-04T00:00:00Z") },
    { _id: interviewB, name: "B", description: "Second", mode: "single", status: "closed", currentVersion: 1, createdAt: new Date("2026-01-02T00:00:00Z"), updatedAt: new Date("2026-01-03T00:00:00Z") },
    { _id: interviewWithoutPeople, name: "C", mode: "multi", status: "open", currentVersion: 1, createdAt: new Date("2026-01-03T00:00:00Z"), updatedAt: new Date("2026-01-02T00:00:00Z") },
  ];
  mocks.participantGroups = [
    { _id: { i: interviewA, s: "invited" }, n: 2, last: new Date("2026-01-05T00:00:00Z") },
    { _id: { i: interviewB, s: "submitted" }, n: 4, last: new Date("2026-01-07T00:00:00Z") },
    { _id: { i: interviewA, s: "submitted" }, n: 3, last: new Date("2026-01-06T00:00:00Z") },
    { _id: { i: interviewA, s: "in_progress" }, n: 1, last: new Date("2026-01-04T00:00:00Z") },
  ];
  mocks.interviewFilter = null;
  mocks.interviewSort = null;
  mocks.aggregatePipeline = [];
  mocks.aggregateFilter.mockReset();
  mocks.aggregateFilter.mockImplementation(() => []);
});

describe("listInterviews", () => {
  it("preserves summaries and tenant ordering while indexing grouped statuses in one pass", async () => {
    const result = await withTenantPrincipal({ tenantId, role: "service", source: "service_token" }, () => listInterviews());

    expect(result).toEqual([
      {
        id: interviewA.toHexString(), name: "A", description: undefined, mode: "multi", status: "open", currentVersion: 2,
        createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-04T00:00:00.000Z",
        counts: { people: 6, invited: 2, inProgress: 1, submitted: 3 }, lastActivityAt: "2026-01-06T00:00:00.000Z",
      },
      {
        id: interviewB.toHexString(), name: "B", description: "Second", mode: "single", status: "closed", currentVersion: 1,
        createdAt: "2026-01-02T00:00:00.000Z", updatedAt: "2026-01-03T00:00:00.000Z",
        counts: { people: 4, invited: 0, inProgress: 0, submitted: 4 }, lastActivityAt: "2026-01-07T00:00:00.000Z",
      },
      {
        id: interviewWithoutPeople.toHexString(), name: "C", description: undefined, mode: "multi", status: "open", currentVersion: 1,
        createdAt: "2026-01-03T00:00:00.000Z", updatedAt: "2026-01-02T00:00:00.000Z",
        counts: { people: 0, invited: 0, inProgress: 0, submitted: 0 }, lastActivityAt: undefined,
      },
    ]);
    expect(mocks.interviewFilter).toEqual(tenantFilter(tenantId));
    expect(mocks.interviewSort).toEqual({ updatedAt: -1 });
    expect(mocks.aggregatePipeline).toEqual([
      { $match: tenantFilter(tenantId) },
      { $group: { _id: { i: "$interviewId", s: "$status" }, n: { $sum: 1 }, last: { $max: "$updatedAt" } } },
    ]);
    expect(mocks.aggregateFilter).not.toHaveBeenCalled();
  });
});
