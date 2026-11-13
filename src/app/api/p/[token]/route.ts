import { progress } from "@/lib/format/answers";
import { fail, json } from "@/lib/http";
import { loadByToken } from "@/lib/repo";
import { looksLikeToken } from "@/lib/tokens";
import { shouldRecordVisit } from "@/lib/visit";

type Ctx = { params: Promise<{ token: string }> };

/** Everything the respondent shell needs: who they are, the questions and their saved answers. */
export async function GET(req: Request, { params }: Ctx) {
  const { token } = await params;
  if (!looksLikeToken(token)) return fail(404, "This link is not valid.");
  // Prefetch of the invite link must not count as the person opening it. Status changes only on save.
  const ctx = await loadByToken(token, { touch: shouldRecordVisit(req) });
  if (!ctx) return fail(404, "This link is not valid.");
  const { manifest } = ctx.version;
  return json({
    ok: true,
    participant: { name: ctx.participant.name, status: ctx.participant.status, revision: ctx.participant.revision, submittedAt: ctx.participant.submittedAt },
    interview: { name: ctx.interview.name, status: ctx.interview.status },
    title: manifest.title,
    questions: manifest.questions,
    answers: ctx.participant.answers,
    progress: progress(manifest, ctx.participant.answers),
  });
}
