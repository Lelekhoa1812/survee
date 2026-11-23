import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pages: [] as any[], filters: [] as Record<string, unknown>[], limits: [] as number[] }));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: vi.fn(),
  col: {
    events: async () => ({
      find: (filter: Record<string, unknown>) => {
        state.filters.push(filter);
        return {
          sort: () => ({
            limit: (value: number) => {
              state.limits.push(value);
              return { toArray: async () => state.pages.shift() ?? [] };
            },
          }),
        };
      },
    }),
  },
}));

import { listEventPage } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const interviewId = "0123456789abcdef01234567";
const at = new Date("2026-11-23T12:00:00.000Z");
function event(id: string) { return { _id: new ObjectId(id), interviewId: new ObjectId(interviewId), tenantId: "tenant-1", type: "save", at }; }
const inTenant = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "tenant-1", role: "admin", source: "session" }, work);

beforeEach(() => { state.pages = []; state.filters = []; state.limits = []; });

describe("listEventPage", () => {
  it("pages through tied timestamps with a stable id tiebreaker", async () => {
    const first = event("000000000000000000000003");
    const second = event("000000000000000000000002");
    const third = event("000000000000000000000001");
    state.pages.push([first, second, third], [third]);

    const page1 = await inTenant(() => listEventPage(interviewId, null, 2));
    const page2 = await inTenant(() => listEventPage(interviewId, page1.nextCursor, 2));

    expect(page1.events.map((row) => row.id)).toEqual([first._id.toHexString(), second._id.toHexString()]);
    expect(page1.nextCursor).toBeTruthy();
    expect(page2.events.map((row) => row.id)).toEqual([third._id.toHexString()]);
    expect(page2.nextCursor).toBeNull();
    expect(state.limits).toEqual([3, 3]);
    expect(JSON.stringify(state.filters[1])).toContain('"$lt"');
    expect(JSON.stringify(state.filters[1])).toContain(second._id.toHexString());
  });

  it("rejects malformed cursors and invalid page sizes", async () => {
    await expect(inTenant(() => listEventPage(interviewId, "not-a-cursor", 2))).rejects.toThrow("Invalid event cursor");
    await expect(inTenant(() => listEventPage(interviewId, null, 51))).rejects.toThrow("Invalid event page limit");
    expect(state.filters).toHaveLength(0);
  });
});
