import { frameResponse, framePlaceholder } from "@/lib/frame";
import { loadByToken } from "@/lib/repo";
import { looksLikeToken } from "@/lib/tokens";

type Ctx = { params: Promise<{ token: string }> };

/** The questionnaire document for one respondent. Loaded inside a sandboxed frame by the /[token] page. */
export async function GET(_req: Request, { params }: Ctx) {
  const { token } = await params;
  if (!looksLikeToken(token)) return framePlaceholder("This link is not valid.");
  const ctx = await loadByToken(token);
  if (!ctx) return framePlaceholder("This link is not valid.");
  return frameResponse(ctx.version.html);
}
