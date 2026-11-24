import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  docs: [] as Record<string, any>[],
  participantBytes: 0,
  pageSourceBytes: 0,
  requestedLimit: 0,
  pageHasMore: [] as boolean[],
  lookaheadCalls: 0,
  sortedBy: {} as Record<string, number>,
  findCalls: 0,
  aggregateCalls: 0,
  filters: [] as Record<string, any>[],
  pageDocs: [] as Record<string, any>[][],
  assignmentQueries: 0,
  assignmentRows: [] as Record<string, any>[],
  assignmentClose: vi.fn(async () => {}),
}));

vi.mock("../src/lib/db", () => ({
  col: {
    participants: async () => ({
      aggregate: (pipeline: Record<string, any>[]) => {
        mocks.aggregateCalls += 1;
        if (pipeline.some((stage) => Boolean(stage.$set?._pageDocBytes))) {
          mocks.requestedLimit = pipeline.find((stage) => stage.$limit)?.$limit ?? 0;
          return { toArray: async () => [{
            summary: mocks.pageSourceBytes ? [{ sourceBytes: mocks.pageSourceBytes }] : [],
            docs: (mocks.pageDocs.length ? mocks.pageDocs.shift()! : mocks.docs).slice(0, mocks.requestedLimit),
          }] };
        }
        const count = mocks.docs.length;
        const fits = count <= 100 && mocks.participantBytes <= 8 * 1024 * 1024;
        return { toArray: async () => [{
          summary: [{ count, bytes: mocks.participantBytes, cohortCount: count, cohortBytes: mocks.participantBytes }],
          docs: fits ? mocks.docs : [],
        }] };
      },
      find: (filter: Record<string, any>, options?: Record<string, any>) => {
        if (options?.projection?._id === 1) mocks.lookaheadCalls += 1;
        else mocks.findCalls += 1;
        mocks.filters.push(filter);
        return {
        sort: (sort: Record<string, number>) => {
          mocks.sortedBy = sort;
          return {
            limit: (limit: number) => {
              if (!options?.projection?._id) mocks.requestedLimit = limit;
              return { toArray: async () => options?.projection?._id === 1
                ? (mocks.pageHasMore.shift() ? [{ _id: new ObjectId() }] : [])
                : (mocks.pageDocs.length ? mocks.pageDocs.shift()! : mocks.docs).slice(0, limit) };
            },
          };
        },
      };
      },
    }),
    questionOrderAssignments: async () => ({ find: () => {
      mocks.assignmentQueries += 1;
      return { sort: () => ({
        [Symbol.asyncIterator]: async function* () { for (const row of mocks.assignmentRows) yield row; },
        close: mocks.assignmentClose,
        toArray: async () => mocks.assignmentRows,
      }) };
    } }),
  },
}));

import { listParticipantPage, listParticipants, MAX_EXPORT_SOURCE_BYTES, MAX_PARTICIPANTS_PER_READ, ParticipantExportSizeLimitError, ParticipantReadLimitError } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

beforeEach(() => {
  mocks.docs = Array.from({ length: MAX_PARTICIPANTS_PER_READ + 1 }, () => ({ _id: new ObjectId() }));
  mocks.participantBytes = 0;
  mocks.pageSourceBytes = 0;
  mocks.requestedLimit = 0;
  mocks.pageHasMore = [];
  mocks.lookaheadCalls = 0;
  mocks.sortedBy = {};
  mocks.findCalls = 0;
  mocks.aggregateCalls = 0;
  mocks.filters = [];
  mocks.pageDocs = [];
  mocks.assignmentQueries = 0;
  mocks.assignmentRows = [];
  mocks.assignmentClose.mockReset().mockResolvedValue(undefined);
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
    mocks.pageHasMore = [true, false];

    const first = await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", null, 2));
    expect(first.people.map((row) => row.id)).toEqual([c._id.toHexString(), b._id.toHexString()]);
    expect(first.nextCursor).toBeTruthy();
    expect(mocks.requestedLimit).toBe(2);
    expect(mocks.sortedBy).toEqual({ createdAt: -1, _id: -1 });

    const second = await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", first.nextCursor!, 2));
    expect(second.people.map((row) => row.id)).toEqual([a._id.toHexString()]);
    expect(second.nextCursor).toBeNull();
    const cursorFilter = mocks.filters[1];
    expect(JSON.stringify(cursorFilter)).toContain('"$lt"');
    expect(JSON.stringify(cursorFilter)).toContain(b._id.toHexString());
  });

  it("bounds source bytes before hydrating a streamed CSV page", async () => {
    const personDoc = person("000000000000000000000006", "2026-01-06T00:00:00.000Z");
    mocks.pageDocs = [[personDoc]];

    const page = await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", null, 10, false, true, MAX_EXPORT_SOURCE_BYTES));

    expect(page.people.map((row) => row.id)).toEqual([personDoc._id.toHexString()]);
    expect(mocks.findCalls).toBe(0);
    expect(mocks.lookaheadCalls).toBe(1);
    expect(mocks.aggregateCalls).toBe(1);
  });

  it("keeps a large lookahead respondent outside the current CSV page byte budget", async () => {
    const personDoc = person("000000000000000000000008", "2026-01-08T00:00:00.000Z");
    mocks.pageDocs = [[personDoc]];
    mocks.pageSourceBytes = MAX_EXPORT_SOURCE_BYTES - 1;
    mocks.pageHasMore = [true];

    const page = await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", null, 1, false, true, MAX_EXPORT_SOURCE_BYTES));

    expect(page.people.map((row) => row.id)).toEqual([personDoc._id.toHexString()]);
    expect(page.nextCursor).toBeTruthy();
    expect(mocks.requestedLimit).toBe(1);
    expect(mocks.lookaheadCalls).toBe(1);
  });

  it("rejects a streamed CSV page whose source payload exceeds the page budget", async () => {
    mocks.pageSourceBytes = MAX_EXPORT_SOURCE_BYTES + 1;

    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", null, 10, false, true, MAX_EXPORT_SOURCE_BYTES)))
      .rejects.toBeInstanceOf(ParticipantExportSizeLimitError);
    expect(mocks.findCalls).toBe(0);
    expect(mocks.assignmentQueries).toBe(0);
  });

  it("includes question-order history in the streamed page source-byte budget", async () => {
    const personDoc = person("000000000000000000000007", "2026-01-07T00:00:00.000Z");
    mocks.pageDocs = [[personDoc]];
    mocks.pageSourceBytes = MAX_EXPORT_SOURCE_BYTES - 1;
    mocks.assignmentRows = [{
      _id: new ObjectId(), participantId: personDoc._id, interviewId: personDoc.interviewId, tenantId: "workspace-1",
      surveyVersion: 1, algorithmVersion: "qorder/1", groups: { group: ["question-one", "question-two"] }, assignedAt: new Date(),
    }];
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipantPage("111111111111111111111111", null, 10, false, true, MAX_EXPORT_SOURCE_BYTES)))
      .rejects.toBeInstanceOf(ParticipantExportSizeLimitError);
    expect(mocks.assignmentClose).toHaveBeenCalledOnce();
  });

  it("includes assignment-history BSON in the buffered export source-byte budget", async () => {
    mocks.docs = [{
      _id: new ObjectId(), interviewId: new ObjectId(), token: "token-one", name: "Person", status: "invited",
      answers: {}, recordGroups: {}, createdAt: new Date(), updatedAt: new Date(), revision: 0,
    }];
    mocks.participantBytes = MAX_EXPORT_SOURCE_BYTES - 1;
    mocks.assignmentRows = [{
      _id: new ObjectId(), participantId: mocks.docs[0]._id, interviewId: mocks.docs[0].interviewId, tenantId: "workspace-1",
      surveyVersion: 1, algorithmVersion: "qorder/1", groups: { group: ["question-one", "question-two"] }, assignedAt: new Date(),
    }];
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipants(new ObjectId().toHexString())))
      .rejects.toBeInstanceOf(ParticipantExportSizeLimitError);
    expect(mocks.assignmentClose).toHaveBeenCalledOnce();
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
