import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  session: { tenantId: "tenant-a" },
  draft: {
    interviewId: "0123456789abcdef01234567",
    expectedVersion: 4,
    candidateHash: "a".repeat(64),
    html: "candidate html",
    questions: [{ id: "q1", type: "text", label: "Candidate question" }],
    expiresAt: new Date("2026-11-16T01:00:00.000Z"),
  },
  interview: { name: "Axion intake" },
  getDraft: vi.fn(),
  getInterview: vi.fn(),
}));

vi.mock("../src/lib/http", () => ({ adminSession: async () => state.session }));
vi.mock("../src/lib/repo", () => ({
  getQuestionnaireReviewDraft: state.getDraft,
  getInterview: state.getInterview,
}));
vi.mock("../src/components/PreviewFrame", async () => {
  const { createElement } = await import("react");
  return { PreviewFrame: ({ src, title }: { src: string; title: string }) => createElement("iframe", { src, title }) };
});

import QuestionnaireReviewPage from "../src/app/admin/(shell)/previews/[id]/page";

const reviewId = "r".repeat(32);

beforeEach(() => {
  state.getDraft.mockReset().mockResolvedValue(state.draft);
  state.getInterview.mockReset().mockResolvedValue(state.interview);
});

describe("questionnaire review page", () => {
  it("renders the candidate metadata and sandboxed frame path for the signed-in tenant", async () => {
    const markup = renderToStaticMarkup(await QuestionnaireReviewPage({ params: Promise.resolve({ id: reviewId }) }));
    expect(markup).toContain("Axion intake");
    expect(markup).toContain("Candidate for version 5");
    expect(markup).toContain("read-only preview");
    expect(markup).toContain("Candidate question");
    expect(markup).toContain(`/api/admin/previews/${reviewId}/frame`);
    expect(markup).toContain("/admin/interviews/0123456789abcdef01234567");
    expect(state.getDraft).toHaveBeenCalledWith(reviewId, "tenant-a");
    expect(state.getInterview).toHaveBeenCalledWith("0123456789abcdef01234567", "tenant-a");
  });
});
