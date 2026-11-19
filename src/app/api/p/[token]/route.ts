import { progress } from "@/lib/format/answers";
import { orderOptions } from "@/lib/format/option-order";
import { assignQuestionOrder, presentedQuestionIds } from "@/lib/format/question-order";
import { fail, json } from "@/lib/http";
import { ensureQuestionOrderAssignment, loadByToken } from "@/lib/repo";
import { looksLikeToken } from "@/lib/tokens";
import { shouldRecordVisit } from "@/lib/visit";

type Ctx = { params: Promise<{ token: string }> };

/** Everything the respondent shell needs: who they are, the questions and their saved answers. */
export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  if (!looksLikeToken(token)) return fail(404, "This link is not valid.");
  // Prefetch of the invite link must not count as the person opening it. Status changes only on save.
  const respondentVisit = shouldRecordVisit(req);
  const ctx = await loadByToken(token, { touch: respondentVisit });
  if (!ctx) return fail(404, "This link is not valid.");
  const { manifest } = ctx.version;
  const proposedOrder = assignQuestionOrder(manifest, ctx.participant.id, ctx.version.version);
  const questionOrderAssignment = respondentVisit && manifest.questionOrderGroups?.length
    ? await ensureQuestionOrderAssignment({ tenantId: ctx.tenantId, interviewId: ctx.interview.id, participantId: ctx.participant.id, surveyVersion: ctx.version.version, ...proposedOrder })
    : { ...proposedOrder, assignedAt: undefined };
  const questionOrder = presentedQuestionIds(manifest, questionOrderAssignment);
  const questions = manifest.questions.map((question) => question.randomizeOptions
    ? { ...question, options: orderOptions({ options: question.options ?? [], randomizeOptions: true, fixedOptionValues: question.fixedOptionValues, participantId: ctx.participant.id, questionnaireVersion: String(ctx.version.version), questionId: question.id }) }
    : question);
  return json({
    ok: true,
    participant: { name: ctx.participant.name, status: ctx.participant.status, revision: ctx.participant.revision, submittedAt: ctx.participant.submittedAt },
    interview: { name: ctx.interview.name, status: ctx.interview.status },
    version: ctx.version.version,
    title: manifest.title,
    presentation: manifest.presentation ?? "all",
    sections: manifest.sections ?? [],
    questionOrderGroups: manifest.questionOrderGroups ?? [],
    questionOrder,
    questionOrderAssignment: { algorithmVersion: questionOrderAssignment.algorithmVersion, groups: questionOrderAssignment.groups, assignedAt: questionOrderAssignment.assignedAt },
    questions,
    answers: ctx.participant.answers,
    recordGroups: ctx.participant.recordGroups ?? {},
    progress: progress(manifest, ctx.participant.answers, ctx.participant.recordGroups ?? {}),
  });
}
