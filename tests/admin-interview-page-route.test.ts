import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  denied: false,
  listInterviewPage: vi.fn(async (..._args: unknown[]) => ({ interviews: [], nextCursor: null, hasMore: false })),
}));

vi.mock("@/lib/http", () => ({
  fail: (status: number, error: string) => Response.json({ ok: false, error }, { status }),
  guardAdmin: async () => state.denied ? Response.json({ ok: false }, { status: 401 }) : null,
  json: (value: unknown) => Response.json(value),
  withServerErrors: (_route: string, handler: (req: Request) => Promise<Response>) => handler,
}));
vi.mock("@/lib/repo", () => ({
  DEFAULT_INTERVIEW_PAGE_SIZE: 25,
  MAX_INTERVIEW_PAGE_SIZE: 100,
  MAX_INTERVIEW_SEARCH_LENGTH: 80,
  InterviewPageCursorError: class InterviewPageCursorError extends Error {},
  InterviewPageFilterError: class InterviewPageFilterError extends Error {},
  listInterviewPage: (...args: unknown[]) => state.listInterviewPage(...args),
}));

import { GET } from "../src/app/api/admin/interviews/page/route";

function request(query = "") {
  return new Request(`https://survee.example/api/admin/interviews/page${query}`);
}

beforeEach(() => {
  state.denied = false;
  state.listInterviewPage.mockReset().mockResolvedValue({ interviews: [], nextCursor: null, hasMore: false });
});

describe("admin interview page filters", () => {
  it("passes validated filters through to the tenant-scoped repository", async () => {
    const response = await GET(request("?search=permit&status=open&mode=multi&limit=40&cursor=opaque"));

    expect(response.status).toBe(200);
    expect(state.listInterviewPage).toHaveBeenCalledWith({ cursor: "opaque", limit: 40, search: "permit", status: "open", mode: "multi" });
  });

  it.each(["?status=unknown", "?mode=unknown", `?search=${"a".repeat(81)}`, "?limit=101"]) ("rejects invalid query %s", async (query) => {
    const response = await GET(request(query));

    expect(response.status).toBe(400);
    expect(state.listInterviewPage).not.toHaveBeenCalled();
  });

  it("does not expose interview pages without an authorized host session", async () => {
    state.denied = true;

    const response = await GET(request("?search=permit"));

    expect(response.status).toBe(401);
    expect(state.listInterviewPage).not.toHaveBeenCalled();
  });
});
