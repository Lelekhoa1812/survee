import { framePlaceholder, frameResponse } from "@/lib/frame";
import { AdminSessionUnavailableError, adminSession } from "@/lib/http";
import { getInterview, getQuestionnaireReviewDraft } from "@/lib/repo";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  let session;
  try {
    session = await adminSession();
  } catch (error) {
    if (error instanceof AdminSessionUnavailableError) return framePlaceholder("Sign-in is temporarily unavailable. Try again in a moment.", 503);
    throw error;
  }
  if (!session) return framePlaceholder("Sign in to preview.", 401);
  const { id } = await ctx.params;
  const draft = await getQuestionnaireReviewDraft(id, session.tenantId);
  if (!draft || !(await getInterview(draft.interviewId, session.tenantId))) return framePlaceholder("This questionnaire preview is unavailable.");
  return frameResponse(draft.html, new URL(req.url).origin);
}
