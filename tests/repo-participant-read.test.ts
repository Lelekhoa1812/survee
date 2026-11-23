import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  docs: [] as Record<string, any>[],
  participantBytes: 0,
  requestedLimit: 0,
  sortedBy: {} as Record<string, number>,
  findCalls: 0,
  aggregateCalls: 0,
  filters: [] as Record<string, any>[],
  pageDocs: [] as Record<string, any>[][],
  assignmentQueries: 0,
}));

vi.mock("../src/lib/db", () => ({
  col: {
    participants: async () => ({
      aggregate: () => {
        mocks.aggregateCalls += 1;
        const count = mocks.docs.length;
        const fits = count <= 100 && mocks.participantBytes <= 8 * 1024 * 1024;
        return { toArray: async () => [{
          summary: [{ count, bytes: mocks.participantBytes, cohortCount: count, cohortBytes: mocks.participantBytes }],
          docs: fits ? mocks.docs : [],
        }] };
      },
      find: (filter: Record<string, any>) => {
        mocks.findCalls += 1;
        mocks.filters.push(filter);
        return {
        sort: (sort: Record<string, number>) => {
          mocks.sortedBy = sort;
          return {
            limit: (limit: number) => {
              mocks.requestedLimit = limit;
              return { toArray: async () => mocks.pageDocs.length ? mocks.pageDocs.shift()! : mocks.docs };
            },
          };
        },
      };
      },
    }),
    questionOrderAssignments: async () => ({ find: () => { mocks.assignmentQueries += 1; return { sort: () => ({ toArray: async () => [] }) }; } }),
  },
}));

import { listParticipantPage, listParticipants, MAX_EXPORT_SOURCE_BYTES, MAX_PARTICIPANTS_PER_READ, ParticipantExportSizeLimitError, ParticipantReadLimitError } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

beforeEach(() => {
  mocks.docs = Array.from({ length: MAX_PARTICIPANTS_PER_READ + 1 }, () => ({ _id: new ObjectId() }));
  mocks.participantBytes = 0;
  mocks.requestedLimit = 0;
  mocks.sortedBy = {};
  mocks.findCalls = 0;
  mocks.aggregateCalls = 0;
  mocks.filters = [];
  mocks.pageDocs = [];
  mocks.assignmentQueries = 0;
});

describe("bounded participant hydration", () => {
  it("checks cohort size before hydrating answer documents or assignments", async () => {
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipants(new ObjectId().toHexString())))
      .rejects.toBeInstanceOf(ParticipantReadLimitError);
    expect(mocks.aggregateCalls).toBe(1);
    expect(mocks.findCalls).toBe(0);
    expect(mocks.assignmentQueries).toBe(0);
  });

  it("checks the aggregate BSON budget before returning buffered export data", async () => {
    mocks.docs = [{ _id: new ObjectId() }];
    mocks.participantBytes = MAX_EXPORT_SOURCE_BYTES + 1;

    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipants(new ObjectId().toHexString())))
      .rejects.toBeInstanceOf(ParticipantExportSizeLimitError);
    expect(mocks.findCalls).toBe(0);
    expect(mocks.assignmentQueries).toBe(0);
  });

  it("does not fail for a result at the cap", async () => {
    mocks.docs = Array.from({ length: MAX_PARTICIPANTS_PER_READ }, (_, index) => ({
      _id: new ObjectId(), interviewId: new ObjectId(), token: `token-${index}`, name: `Person ${index}`,
      status: "invited", answers: {}, recordGroups: {}, createdAt: new Date(), updatedAt: new Date(), revision: 0,
    }));
    const people = await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipants(new ObjectId().toHexString()));
    expect(people).toHaveLength(MAX_PARTICIPANTS_PER_READ);
    expect(mocks.findCalls).toBe(0);
  });
});

describe("cursor participant pages", () => {
  function person(id: string, at: string) {
    return { _id: new ObjectId(id), interviewId: new ObjectId("111111111111111111111111"), token: `token-${id}`, name: "Person", status: "invited", answers: {}, recordGroups: {}, createdAt: new Date(at), updatedAt: new Date(at), revision: 0 };
  }

  it("limits each page, orders newest first, and uses a stable createdAt/id cursor", async () => {
    const a = person("000000000000000000000001", "2026-01-01T00:00:00.000Z");
    const b = person("000000000000000000000002", "2026-01-02T00:00:00.000Z");
    const c = person("000000000000000000000003", "2026-01-03T00:00:00.000Z");
    mocks.pageDocs = [[c, b, a], [a]];

    const first = await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", null, 2));
    expect(first.people.map((row) => row.id)).toEqual([c._id.toHexString(), b._id.toHexString()]);
    expect(first.nextCursor).toBeTruthy();
    expect(mocks.requestedLimit).toBe(3);
    expect(mocks.sortedBy).toEqual({ createdAt: -1, _id: -1 });

    const second = await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", first.nextCursor!, 2));
    expect(second.people.map((row) => row.id)).toEqual([a._id.toHexString()]);
    expect(second.nextCursor).toBeNull();
    const cursorFilter = mocks.filters[1];
    expect(JSON.stringify(cursorFilter)).toContain('"$lt"');
    expect(JSON.stringify(cursorFilter)).toContain(b._id.toHexString());
  });

  it("rejects malformed and oversized cursors", async () => {
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", "%%%")))
      .rejects.toThrow("cursor is invalid or expired");
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", "x".repeat(300))))
      .rejects.toThrow("cursor is invalid or expired");
  });

  it("applies submittedOnly before paging so pages are not sparse or silently incomplete", async () => {
    const submitted = { ...person("000000000000000000000004", "2026-01-04T00:00:00.000Z"), status: "submitted" };
    mocks.pageDocs = [[submitted]];

    const page = await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", null, 10, true));

    expect(page.people.map((row) => row.status)).toEqual(["submitted"]);
    expect((mocks.filters[0].$and as Record<string, unknown>[])[1].status).toBe("submitted");
  });

  it("skips order-assignment history when a caller only needs participant progress", async () => {
    mocks.pageDocs = [[person("000000000000000000000005", "2026-01-05T00:00:00.000Z")]];

    await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", null, 10, false, false));

    expect(mocks.assignmentQueries).toBe(0);
  });
});
