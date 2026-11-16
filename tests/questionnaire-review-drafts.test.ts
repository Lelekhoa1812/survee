import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  draft: null as Record<string, any> | null,
  updateOne: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  col: {
    questionnaireReviewDrafts: async () => ({
      updateOne: mocks.updateOne,
      findOne: mocks.findOne,
    }),
  },
}));

import { getQuestionnaireReviewDraft, saveQuestionnaireReviewDraft } from "../src/lib/repo";

const html = "<!doctype html><main>candidate</main>";
const candidateHash = createHash("sha256").update(html).digest("hex");
const question = { id: "q1", type: "text" as const, label: "Question" };

beforeEach(() => {
  mocks.draft = null;
  mocks.updateOne.mockReset().mockImplementation(async (query, update, options) => {
    const existing = mocks.draft;
    if (!existing && options?.upsert) {
      mocks.draft = { ...update.$set, _id: update.$setOnInsert._id };
    } else if (existing && existing.tenantId === query.tenantId && existing.interviewId.equals(query.interviewId)) {
      mocks.draft = { ...existing, ...update.$set };
    }
    return { acknowledged: true };
  });
  mocks.findOne.mockReset().mockImplementation(async (query) => {
    const draft = mocks.draft;
    if (!draft || draft.tenantId !== query.tenantId || draft.reviewIdHash !== query.reviewIdHash || draft.expiresAt <= query.expiresAt.$gt) return null;
    return draft;
  });
});

describe("short-lived questionnaire review drafts", () => {
  it("stores only the review-id hash and scopes reads to the tenant and expiry", async () => {
    const expiresAt = new Date(Date.now() + 9 * 60 * 1000);
    const input = {
      tenantId: "tenant-a",
      interviewId: "0123456789abcdef01234567",
      expectedVersion: 4,
      candidateHash,
      fileName: "candidate.html",
      html,
      questions: [question],
      expiresAt,
    };
    const saved = await saveQuestionnaireReviewDraft(input);

    expect(saved.reviewId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(saved.expiresAt).toBe(expiresAt.toISOString());
    expect(mocks.updateOne).toHaveBeenCalledWith(
      { tenantId: "tenant-a", interviewId: new ObjectId(input.interviewId) },
      expect.objectContaining({ $set: expect.objectContaining({ tenantId: "tenant-a", candidateHash, html, expiresAt }) }),
      { upsert: true },
    );
    expect(mocks.draft?.reviewIdHash).toBe(createHash("sha256").update(saved.reviewId).digest("hex"));
    expect(mocks.draft?.reviewIdHash).not.toBe(saved.reviewId);

    const read = await getQuestionnaireReviewDraft(saved.reviewId, "tenant-a");
    expect(read).toMatchObject({ interviewId: input.interviewId, expectedVersion: 4, candidateHash, html, questions: [question] });
    expect(await getQuestionnaireReviewDraft(saved.reviewId, "tenant-b")).toBeNull();
    expect(await getQuestionnaireReviewDraft("invalid", "tenant-a")).toBeNull();
  });

  it("replaces the previous interview draft and rejects expired, tampered, or mismatched records", async () => {
    const saved = await saveQuestionnaireReviewDraft({
      tenantId: "tenant-a",
      interviewId: "0123456789abcdef01234567",
      expectedVersion: 1,
      candidateHash,
      html,
      questions: [question],
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    const replacement = await saveQuestionnaireReviewDraft({
      tenantId: "tenant-a",
      interviewId: "0123456789abcdef01234567",
      expectedVersion: 2,
      candidateHash,
      html,
      questions: [question],
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    expect(replacement.reviewId).not.toBe(saved.reviewId);
    expect(await getQuestionnaireReviewDraft(saved.reviewId, "tenant-a")).toBeNull();
    expect(await getQuestionnaireReviewDraft(replacement.reviewId, "tenant-a")).toMatchObject({ expectedVersion: 2 });

    // Make the replacement the record under test for expiry and tamper checks.
    mocks.draft!.expiresAt = new Date(Date.now() - 1000);
    expect(await getQuestionnaireReviewDraft(replacement.reviewId, "tenant-a")).toBeNull();

    mocks.draft!.expiresAt = new Date(Date.now() + 60_000);
    mocks.draft!.html = "changed";
    expect(await getQuestionnaireReviewDraft(replacement.reviewId, "tenant-a")).toBeNull();

    await expect(saveQuestionnaireReviewDraft({
      tenantId: "tenant-a",
      interviewId: "0123456789abcdef01234567",
      expectedVersion: 1,
      candidateHash: "f".repeat(64),
      html,
      questions: [question],
      expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toThrow("candidate hash");

    const oversized = "x".repeat(3 * 1024 * 1024 + 1);
    await expect(saveQuestionnaireReviewDraft({
      tenantId: "tenant-a",
      interviewId: "0123456789abcdef01234567",
      expectedVersion: 1,
      candidateHash: createHash("sha256").update(oversized).digest("hex"),
      html: oversized,
      questions: [question],
      expiresAt: new Date(Date.now() + 60_000),
    })).rejects.toThrow("supported size limits");
  });
});
