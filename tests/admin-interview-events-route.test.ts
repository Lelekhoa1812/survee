import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  getInterview: vi.fn(async () => ({ _id: "interview-1" })),
  listEventPage: vi.fn(async () => ({ events: [{ id: "event-1", type: "save", at: "2026-11-23T12:00:00.000Z" }], nextCursor: "next" })),
}));

vi.mock("../src/lib/http", () => ({
  guardAdmin: vi.fn(async () => null),
  fail: (status: number, error: string, extra?: Record<string, unknown>) => Response.json({ ok: false, error, ...extra }, { status }),
  json: (value: unknown) => Response.json(value),
  withServerErrors: (_name: string, handler: (...args: any[]) => unknown) => handler,
}));
vi.mock("../src/lib/repo", () => ({ getInterview: state.getInterview, listEventPage: state.listEventPage }));

import { GET } from "../src/app/api/admin/interviews/[id]/events/route";

const context = { params: Promise.resolve({ id: "0123456789abcdef01234567" }) };

beforeEach(() => { state.getInterview.mockClear(); state.listEventPage.mockClear(); });

describe("admin interview event pages", () => {
  it("returns the requested cursor page", async () => {
    const response = await GET(new Request("https://kqa.test/api/admin/interviews/0123456789abcdef01234567/events?limit=10&cursor=prior"), context);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ events: [{ id: "event-1" }], nextCursor: "next" });
    expect(state.listEventPage).toHaveBeenCalledWith("0123456789abcdef01234567", "prior", 10);
  });

  it("rejects invalid limits and malformed cursors", async () => {
    const invalidLimit = await GET(new Request("https://kqa.test/api/events?limit=51"), context);
    const invalidCursor = await GET(new Request("https://kqa.test/api/events?cursor="), context);
    expect(invalidLimit.status).toBe(400);
    expect(invalidCursor.status).toBe(400);
    expect(state.listEventPage).not.toHaveBeenCalled();
  });
});
