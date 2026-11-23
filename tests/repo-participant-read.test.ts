import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  docs: [] as Record<string, any>[],
  requestedLimit: 0,
  sortedBy: {} as Record<string, number>,
  assignmentQueries: 0,
}));

vi.mock("../src/lib/db", () => ({
  col: {
    participants: async () => ({
      find: () => ({
        sort: (sort: Record<string, number>) => {
          mocks.sortedBy = sort;
          return {
            limit: (limit: number) => {
              mocks.requestedLimit = limit;
              return { toArray: async () => mocks.docs };
            },
          };
        },
      }),
    }),
    questionOrderAssignments: async () => ({ find: () => { mocks.assignmentQueries += 1; return { sort: () => ({ toArray: async () => [] }) }; } }),
  },
}));

import { listParticipants, MAX_PARTICIPANTS_PER_READ, ParticipantReadLimitError } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

beforeEach(() => {
  mocks.docs = Array.from({ length: MAX_PARTICIPANTS_PER_READ + 1 }, () => ({ _id: new ObjectId() }));
  mocks.requestedLimit = 0;
  mocks.sortedBy = {};
  mocks.assignmentQueries = 0;
});

describe("bounded participant hydration", () => {
  it("reads only one over the cap and fails before loading assignments", async () => {
    await expect(withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipants(new ObjectId().toHexString())))
      .rejects.toBeInstanceOf(ParticipantReadLimitError);
    expect(mocks.requestedLimit).toBe(MAX_PARTICIPANTS_PER_READ + 1);
    expect(mocks.sortedBy).toEqual({ createdAt: 1, _id: 1 });
    expect(mocks.assignmentQueries).toBe(0);
  });

  it("does not fail for a result at the cap", async () => {
    mocks.docs = Array.from({ length: MAX_PARTICIPANTS_PER_READ }, (_, index) => ({
      _id: new ObjectId(), interviewId: new ObjectId(), token: `token-${index}`, name: `Person ${index}`,
      status: "invited", answers: {}, recordGroups: {}, createdAt: new Date(), updatedAt: new Date(), revision: 0,
    }));
    const people = await withTenantPrincipal({ tenantId: "workspace-1", role: "service", source: "service_token" }, () => listParticipants(new ObjectId().toHexString()));
    expect(people).toHaveLength(MAX_PARTICIPANTS_PER_READ);
    expect(mocks.requestedLimit).toBe(MAX_PARTICIPANTS_PER_READ + 1);
  });
});
