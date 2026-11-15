import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mongoMocks = vi.hoisted(() => {
  const find = vi.fn();
  const participants = vi.fn(async () => ({ find }));
  return { find, participants };
});

vi.mock("../src/lib/db", () => ({ col: { participants: mongoMocks.participants } }));

import { iterateAnalyticsParticipants, type AnalyticsParticipant } from "../src/lib/repo";
import { tenantFilter, withTenantPrincipal } from "../src/lib/tenant-context";

const asAxion = <T>(run: () => T) => withTenantPrincipal({ tenantId: "axion", role: "service", source: "service_token" }, run);

describe("analytics participant query", () => {
  let cursor: { batchSize: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>; [Symbol.asyncIterator]: () => AsyncGenerator<Record<string, unknown>> };
  const interviewId = new ObjectId();

  beforeEach(() => {
    cursor = {
      batchSize: vi.fn(function (this: typeof cursor) { return this; }),
      close: vi.fn(async () => {}),
      async *[Symbol.asyncIterator]() {
        yield {
          token: "private-link-token",
          name: "Private Name",
          email: "private@example.com",
          status: "submitted",
          answers: {
            fit: { value: "yes", note: "Private note text", updatedAt: "2026-11-15T00:00:00Z" },
            unrelated: { value: "raw unrelated answer", updatedAt: "2026-11-15T00:00:00Z" },
          },
        };
      },
    };
    mongoMocks.find.mockReset().mockReturnValue(cursor);
    mongoMocks.participants.mockClear();
  });

  it("filters status in Mongo and streams only selected answer fields without identity or note text", async () => {
    const rows: AnalyticsParticipant[] = [];
    await asAxion(async () => {
      for await (const row of iterateAnalyticsParticipants(interviewId.toHexString(), ["fit", "unsafe.path"], false)) rows.push(row);
    });

    expect(mongoMocks.find).toHaveBeenCalledWith(
      tenantFilter("axion", { interviewId, status: { $in: ["invited", "in_progress", "submitted"] } }),
      { projection: { _id: 0, status: 1, "answers.fit.value": 1, "answers.fit.note": 1 } },
    );
    expect(cursor.batchSize).toHaveBeenCalledWith(250);
    expect(cursor.close).toHaveBeenCalledOnce();
    expect(rows).toEqual([{ status: "submitted", answers: { fit: { value: "yes", note: "present", updatedAt: "" } } }]);
    expect(JSON.stringify(rows)).not.toContain("private-link-token");
    expect(JSON.stringify(rows)).not.toContain("private@example.com");
    expect(JSON.stringify(rows)).not.toContain("Private note text");
    expect(JSON.stringify(rows)).not.toContain("raw unrelated answer");
  });

  it("filters submitted respondents in Mongo", async () => {
    await asAxion(async () => {
      for await (const _row of iterateAnalyticsParticipants(interviewId.toHexString(), ["fit"], true)) { /* consume cursor */ }
    });
    expect(mongoMocks.find).toHaveBeenCalledWith(
      tenantFilter("axion", { interviewId, status: "submitted" }),
      { projection: { _id: 0, status: 1, "answers.fit.value": 1, "answers.fit.note": 1 } },
    );
  });

  it("filters a caller-selected status subset in Mongo", async () => {
    await asAxion(async () => {
      for await (const _row of iterateAnalyticsParticipants(interviewId.toHexString(), ["fit"], { statuses: ["invited", "in_progress"] })) { /* consume cursor */ }
    });
    expect(mongoMocks.find).toHaveBeenCalledWith(
      tenantFilter("axion", { interviewId, status: { $in: ["invited", "in_progress"] } }),
      { projection: { _id: 0, status: 1, "answers.fit.value": 1, "answers.fit.note": 1 } },
    );
  });
});
