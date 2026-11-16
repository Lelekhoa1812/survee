import { framePlaceholder, frameResponse } from "@/lib/frame";
import { adminSession } from "@/lib/http";
import { getInterview, getQuestionnaireReviewDraft } from "@/lib/repo";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await adminSession();
  if (!session) return framePlaceholder("Sign in to preview.", 401);
  const { id } = await ctx.params;
  const draft = await getQuestionnaireReviewDraft(id, session.tenantId);
  if (!draft || !(await getInterview(draft.interviewId, session.tenantId))) return framePlaceholder("This questionnaire preview is unavailable.");
  return frameResponse(draft.html);
}
