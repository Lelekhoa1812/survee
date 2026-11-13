import { fail, json } from "@/lib/http";
import { submitAnswers } from "@/lib/repo";
import { looksLikeToken } from "@/lib/tokens";

type Ctx = { params: Promise<{ token: string }> };

export async function POST(_req: Request, { params }: Ctx) {
  const { token } = await params;
  if (!looksLikeToken(token)) return fail(404, "This link is not valid.");
  const result = await submitAnswers(token);
  return result.ok ? json(result) : fail(result.status, result.error, { missing: result.missing });
}
