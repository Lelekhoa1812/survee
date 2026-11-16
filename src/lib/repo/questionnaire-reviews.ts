import { createHash, randomBytes } from "node:crypto";
import { ObjectId } from "mongodb";
import type { Question } from "../format/schema";
import { LIMITS } from "../format/schema";
import { col } from "../db";
import type { QuestionnaireReviewDraftDoc } from "./types";

export const QUESTIONNAIRE_REVIEW_DRAFT_SLOTS = 5;

export interface SaveQuestionnaireReviewDraftInput {
  tenantId: string;
  interviewId: string;
  expectedVersion: number;
  candidateHash: string;
  fileName?: string;
  html: string;
  questions: Question[];
  expiresAt: Date;
}

export interface QuestionnaireReviewDraftView {
  interviewId: string;
  expectedVersion: number;
  candidateHash: string;
  fileName?: string;
  html: string;
  questions: Question[];
  expiresAt: Date;
}

/** Store one candidate in an available, bounded tenant/interview slot until its preview expires. */
export async function saveQuestionnaireReviewDraft(input: SaveQuestionnaireReviewDraftInput): Promise<
  | { available: true; reviewId: string; expiresAt: string }
  | { available: false; reason: "review_quota_reached" }
> {
  const interviewId = /^[0-9a-f]{24}$/i.test(input.interviewId) ? new ObjectId(input.interviewId) : null;
  const now = new Date();
  if (!input.tenantId || !interviewId) throw new Error("A tenant and valid interview are required.");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) throw new Error("A valid questionnaire version is required.");
  if (!/^[a-f0-9]{64}$/.test(input.candidateHash) || createHash("sha256").update(input.html).digest("hex") !== input.candidateHash) throw new Error("The candidate hash does not match the questionnaire.");
  if (Buffer.byteLength(input.html, "utf8") > LIMITS.maxFileBytes || !Array.isArray(input.questions) || input.questions.length > LIMITS.maxQuestions) {
    throw new Error("The questionnaire candidate is outside the supported size limits.");
  }
  if (input.expiresAt <= now || input.expiresAt.getTime() > now.getTime() + 10 * 60 * 1000 + 1000) {
    throw new Error("The review expiry must be within the signed preview window.");
  }

  const reviewId = randomBytes(24).toString("base64url");
  const reviewIdHash = createHash("sha256").update(reviewId).digest("hex");
  const draft: Omit<QuestionnaireReviewDraftDoc, "_id"> = {
    tenantId: input.tenantId,
    interviewId,
    slot: 0,
    reviewIdHash,
    expectedVersion: input.expectedVersion,
    candidateHash: input.candidateHash,
    ...(input.fileName ? { fileName: input.fileName } : {}),
    html: input.html,
    questions: input.questions,
    createdAt: now,
    expiresAt: input.expiresAt,
  };
  const drafts = await col.questionnaireReviewDrafts();
  for (let slot = 0; slot < QUESTIONNAIRE_REVIEW_DRAFT_SLOTS; slot += 1) {
    const row = { ...draft, slot };
    const reclaimed = await drafts.updateOne(
      { tenantId: input.tenantId, interviewId, slot, expiresAt: { $lte: now } },
      { $set: row },
    );
    if (reclaimed.matchedCount > 0) {
      return { available: true, reviewId, expiresAt: input.expiresAt.toISOString() };
    }
    try {
      await drafts.insertOne({ _id: new ObjectId(), ...row });
      return { available: true, reviewId, expiresAt: input.expiresAt.toISOString() };
    } catch (error) {
      // A concurrent save may have claimed this slot after the expired-row check.
      if ((error as { code?: number }).code !== 11000) throw error;
    }
  }
  return { available: false, reason: "review_quota_reached" };
}

/** Read only an unexpired draft belonging to the caller's signed-in tenant. */
export async function getQuestionnaireReviewDraft(reviewId: string, tenantId: string): Promise<QuestionnaireReviewDraftView | null> {
  if (!tenantId || !/^[A-Za-z0-9_-]{32}$/.test(reviewId)) return null;
  const reviewIdHash = createHash("sha256").update(reviewId).digest("hex");
  const draft = await (await col.questionnaireReviewDrafts()).findOne({ tenantId, reviewIdHash, expiresAt: { $gt: new Date() } });
  if (!draft || createHash("sha256").update(draft.html).digest("hex") !== draft.candidateHash) return null;
  return {
    interviewId: draft.interviewId.toHexString(),
    expectedVersion: draft.expectedVersion,
    candidateHash: draft.candidateHash,
    fileName: draft.fileName,
    html: draft.html,
    questions: draft.questions,
    expiresAt: draft.expiresAt,
  };
}
