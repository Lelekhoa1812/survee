import { fail, json, readJson } from "@/lib/http";
import { saveAnswers, type AnswerPatch } from "@/lib/repo";
import { looksLikeToken } from "@/lib/tokens";

type Ctx = { params: Promise<{ token: string }> };

/** Body: { answers: { [questionId]: { value?, note? } } }. Only the ids sent are changed. */
export async function PUT(req: Request, { params }: Ctx) {
  const { token } = await params;
  if (!looksLikeToken(token)) return fail(404, "This link is not valid.");
  const body = await readJson<{ answers?: unknown }>(req, 512 * 1024);
  if (!body.ok) return body.res;
  const a = body.data.answers;
  if (!a || typeof a !== "object" || Array.isArray(a)) return fail(400, "Send answers as an object keyed by question id.");
  const result = await saveAnswers(token, a as AnswerPatch);
  return result.ok ? json(result) : fail(result.status, result.error, { details: result.details });
}
