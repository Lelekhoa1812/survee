import { fail, json, readJson, withServerErrors } from "@/lib/http";
import { submitAnswers } from "@/lib/repo";
import { looksLikeToken } from "@/lib/tokens";
import { respondentRateLimit } from "@/lib/respondent-rate-limit";

type Ctx = { params: Promise<{ token: string }> };

export const POST = withServerErrors("p/submit", async function POST(req: Request, { params }: Ctx) {
  const { token } = await params;
  if (!looksLikeToken(token)) return fail(404, "This link is not valid.", { code: "not_found" });
  const rateLimitFailure = await respondentRateLimit(req, token, "submit");
  if (rateLimitFailure) return rateLimitFailure;
  const body = await readJson<{ version?: unknown; writeEpoch?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  if (typeof body.data.version !== "number" || !Number.isSafeInteger(body.data.version) || body.data.version < 1) {
    return fail(409, "This questionnaire version is missing. Reload the page to continue.", { code: "questionnaire_version_changed" });
  }
  if (typeof body.data.writeEpoch !== "number" || !Number.isSafeInteger(body.data.writeEpoch) || body.data.writeEpoch < 0) return fail(409, "This response state is missing. Reload the page to continue.", { code: "respondent_state_changed" });
  const result = await submitAnswers(token, body.data.version, body.data.writeEpoch);
  return result.ok ? json(result) : fail(result.status, result.error, { code: result.code, missing: result.missing, invalidSelections: result.invalidSelections, invalidMinimumSelections: result.invalidMinimumSelections, invalidExclusiveSelections: result.invalidExclusiveSelections, invalidRankSelections: result.invalidRankSelections, invalidAnswers: result.invalidAnswers, repeatErrors: result.repeatErrors });
});
