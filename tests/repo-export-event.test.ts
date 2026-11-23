import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  interview: true,
  event: null as Record<string, unknown> | null,
  session: { transaction: true },
  withMongoTransaction: vi.fn(async (work: (session: unknown) => Promise<unknown>) => work(mocks.session)),
}));

vi.mock("../src/lib/db", () => ({
  withMongoTransaction: mocks.withMongoTransaction,
  col: {
    interviews: async () => ({
      findOne: async (filter: unknown, options: unknown) => {
        expect(filter).toEqual({ $and: [{ tenantId: "workspace-1" }, { _id: interviewId }] });
        expect(options).toEqual({ session: mocks.session, projection: { _id: 1 } });
        return mocks.interview ? { _id: interviewId } : null;
      },
    }),
    events: async () => ({ insertOne: async (event: Record<string, unknown>, options: unknown) => {
      mocks.event = event;
      expect(options).toEqual({ session: mocks.session });
    } }),
  },
}));

import { recordExportEvent } from "../src/lib/repo";
import { withTenantPrincipal } from "../src/lib/tenant-context";

const interviewId = new ObjectId("bbbbbbbbbbbbbbbbbbbbbbbb");
const asTenant = <T>(work: () => Promise<T>) => withTenantPrincipal({ tenantId: "workspace-1", role: "admin", source: "session" }, work);

beforeEach(() => {
  mocks.interview = true;
  mocks.event = null;
  mocks.withMongoTransaction.mockClear();
});

describe("recordExportEvent", () => {
  it("stores only the tenant-scoped interview, export kind, and format", async () => {
    const recorded = await asTenant(() => recordExportEvent(interviewId.toHexString(), "json"));

    expect(recorded).toBe(true);
    expect(mocks.event).toMatchObject({ tenantId: "workspace-1", interviewId, type: "export", meta: { format: "json" } });
    expect(mocks.event?.participantId).toBeUndefined();
    expect(mocks.withMongoTransaction).toHaveBeenCalledOnce();
  });

  it("does not insert an event if the interview no longer exists", async () => {
    mocks.interview = false;

    expect(await asTenant(() => recordExportEvent(interviewId.toHexString(), "csv-wide"))).toBe(false);
    expect(mocks.event).toBeNull();
  });
});
