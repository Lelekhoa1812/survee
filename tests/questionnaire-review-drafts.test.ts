import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drafts: [] as Record<string, any>[],
  updateOne: vi.fn(),
  insertOne: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../src/lib/db", () => ({
  col: {
    questionnaireReviewDrafts: async () => ({
      updateOne: mocks.updateOne,
      insertOne: mocks.insertOne,
      findOne: mocks.findOne,
    }),
  },
}));

import { getQuestionnaireReviewDraft, saveQuestionnaireReviewDraft } from "../src/lib/repo";

const html = "<!doctype html><main>candidate</main>";
const candidateHash = createHash("sha256").update(html).digest("hex");
const question = { id: "q1", type: "text" as const, label: "Question" };

beforeEach(() => {
  mocks.drafts = [];
  mocks.updateOne.mockReset().mockImplementation(async (query, update) => {
    const existing = mocks.drafts.find((draft) => draft.tenantId === query.tenantId
      && draft.interviewId.equals(query.interviewId)
      && draft.slot === query.slot
      && draft.expiresAt <= query.expiresAt.$lte);
    if (existing) Object.assign(existing, update.$set);
    return { acknowledged: true, matchedCount: existing ? 1 : 0 };
  });
  mocks.insertOne.mockReset().mockImplementation(async (draft) => {
    const duplicate = mocks.drafts.some((existing) => existing.tenantId === draft.tenantId
      && existing.interviewId.equals(draft.interviewId)
      && existing.slot === draft.slot);
    if (duplicate) throw Object.assign(new Error("duplicate slot"), { code: 11000 });
    mocks.drafts.push(draft);
    return { acknowledged: true };
  });
  mocks.findOne.mockReset().mockImplementation(async (query) => {
    const draft = mocks.drafts.find((entry) => entry.tenantId === query.tenantId
      && entry.reviewIdHash === query.reviewIdHash
      && entry.expiresAt > query.expiresAt.$gt);
    if (!draft) return null;
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

    expect(saved.available).toBe(true);
    if (!saved.available) throw new Error("Expected the first review slot to be available.");
    expect(saved.reviewId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(saved.expiresAt).toBe(expiresAt.toISOString());
    expect(mocks.insertOne).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: "tenant-a", interviewId: new ObjectId(input.interviewId), slot: 0, candidateHash, html, expiresAt,
    }));
    expect(mocks.drafts[0].reviewIdHash).toBe(createHash("sha256").update(saved.reviewId).digest("hex"));
    expect(mocks.drafts[0].reviewIdHash).not.toBe(saved.reviewId);

    const read = await getQuestionnaireReviewDraft(saved.reviewId, "tenant-a");
    expect(read).toMatchObject({ interviewId: input.interviewId, expectedVersion: 4, candidateHash, html, questions: [question] });
    expect(await getQuestionnaireReviewDraft(saved.reviewId, "tenant-b")).toBeNull();
    expect(await getQuestionnaireReviewDraft("invalid", "tenant-a")).toBeNull();
  });

  it("preserves concurrent candidates and reports when all five active slots are occupied", async () => {
    const save = (expectedVersion: number, htmlContent: string) => saveQuestionnaireReviewDraft({
      tenantId: "tenant-a",
      interviewId: "0123456789abcdef01234567",
      expectedVersion,
      candidateHash: createHash("sha256").update(htmlContent).digest("hex"),
      html: htmlContent,
      questions: [question],
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    const saved: Array<{ available: true; reviewId: string; expiresAt: string }> = [];
    for (let version = 1; version <= 5; version += 1) {
      const result = await save(version, `${html}<p>${version}</p>`);
      expect(result.available).toBe(true);
      if (result.available) saved.push(result);
    }
    expect(mocks.drafts.map((draft) => draft.slot)).toEqual([0, 1, 2, 3, 4]);
    expect(saved).toHaveLength(5);
    expect(await getQuestionnaireReviewDraft(saved[0].reviewId, "tenant-a")).toMatchObject({ expectedVersion: 1 });
    expect(await getQuestionnaireReviewDraft(saved[4].reviewId, "tenant-a")).toMatchObject({ expectedVersion: 5 });

    await expect(save(6, `${html}<p>sixth</p>`)).resolves.toEqual({ available: false, reason: "review_quota_reached" });
    expect(mocks.drafts).toHaveLength(5);
  });

  it("reclaims expired slots and rejects expired, tampered, or mismatched records", async () => {
    const saved = await saveQuestionnaireReviewDraft({
      tenantId: "tenant-a", interviewId: "0123456789abcdef01234567", expectedVersion: 1, candidateHash,
      html, questions: [question], expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    if (!saved.available) throw new Error("Expected the first review slot to be available.");
    const firstDraft = mocks.drafts[0];
    firstDraft.expiresAt = new Date(Date.now() - 1000);
    expect(await getQuestionnaireReviewDraft(saved.reviewId, "tenant-a")).toBeNull();

    const replacement = await saveQuestionnaireReviewDraft({
      tenantId: "tenant-a", interviewId: "0123456789abcdef01234567", expectedVersion: 2, candidateHash,
      html, questions: [question], expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
    expect(replacement.available).toBe(true);
    if (!replacement.available) throw new Error("Expected the expired review slot to be reclaimed.");
    expect(mocks.drafts).toHaveLength(1);
    expect(await getQuestionnaireReviewDraft(saved.reviewId, "tenant-a")).toBeNull();
    expect(await getQuestionnaireReviewDraft(replacement.reviewId, "tenant-a")).toMatchObject({ expectedVersion: 2 });

    firstDraft.html = "changed";
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
