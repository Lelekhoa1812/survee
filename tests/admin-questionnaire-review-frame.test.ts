import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: null as null | { tenantId: string },
  review: null as null | { interviewId: string; html: string },
  getReview: vi.fn(),
  getInterview: vi.fn(),
}));

vi.mock("../src/lib/http", () => ({ adminSession: async () => state.session }));
vi.mock("../src/lib/repo", () => ({
  getQuestionnaireReviewDraft: state.getReview,
  getInterview: state.getInterview,
}));

import { GET } from "../src/app/api/admin/previews/[id]/frame/route";

const params = { params: Promise.resolve({ id: "r".repeat(32) }) };

beforeEach(() => {
  state.session = null;
  state.review = null;
  state.getReview.mockReset().mockImplementation(async (id: string, tenantId: string) => {
    if (id !== "r".repeat(32) || tenantId !== "tenant-a") return null;
    return state.review;
  });
  state.getInterview.mockReset().mockResolvedValue({ _id: "interview" });
});

describe("authenticated questionnaire review frame", () => {
  it("requires a signed-in session", async () => {
    const response = await GET(new Request("https://kqa.example/api/admin/previews/x/frame"), params);
    expect(response.status).toBe(401);
    expect(state.getReview).not.toHaveBeenCalled();
  });

  it("does not reveal a review draft across tenants or after its expiry", async () => {
    state.session = { tenantId: "tenant-b" };
    state.review = { interviewId: "interview", html: "candidate html" };
    const response = await GET(new Request("https://kqa.example/api/admin/previews/x/frame"), params);
    expect(response.status).toBe(404);
    expect(state.getReview).toHaveBeenCalledWith("r".repeat(32), "tenant-b");
    expect(state.getInterview).not.toHaveBeenCalled();
  });

  it("serves the candidate only in KQA's non-cacheable sandboxed frame", async () => {
    state.session = { tenantId: "tenant-a" };
    state.review = { interviewId: "0123456789abcdef01234567", html: "<!doctype html><main>review candidate</main>" };
    const response = await GET(new Request("https://kqa.example/api/admin/previews/x/frame"), params);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("review candidate");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox allow-scripts allow-forms");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(state.getReview).toHaveBeenCalledWith("r".repeat(32), "tenant-a");
    expect(state.getInterview).toHaveBeenCalledWith("0123456789abcdef01234567", "tenant-a");
  });
});
