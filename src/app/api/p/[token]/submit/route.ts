import { fail, json, readJson, withServerErrors } from "@/lib/http";
import { submitAnswers } from "@/lib/repo";
import { looksLikeToken } from "@/lib/tokens";

type Ctx = { params: Promise<{ token: string }> };

export const POST = withServerErrors("p/submit", async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  if (!looksLikeToken(token)) return fail(404, "This link is not valid.", { code: "not_found" });
  const body = await readJson<{ version?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  if (typeof body.data.version !== "number" || !Number.isSafeInteger(body.data.version) || body.data.version < 1) {
    return fail(409, "This questionnaire version is missing. Reload the page to continue.", { code: "questionnaire_version_changed" });
  }
  const result = await submitAnswers(token, body.data.version);
  return result.ok ? json(result) : fail(result.status, result.error, { code: result.code, missing: result.missing, invalidSelections: result.invalidSelections, invalidMinimumSelections: result.invalidMinimumSelections, invalidExclusiveSelections: result.invalidExclusiveSelections, invalidRankSelections: result.invalidRankSelections, repeatErrors: result.repeatErrors });
});
