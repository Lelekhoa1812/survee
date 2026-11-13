import { fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { addVersion, getInterview } from "@/lib/repo";
import { prepareSurvey, withCompat } from "@/lib/survey";

type Ctx = { params: Promise<{ id: string }> };

/** Upload a new version of the survey. Static errors block it; compatibility warnings are shown but do not. */
export async function POST(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const { id } = await params;
  if (!(await getInterview(id))) return fail(404, "Interview not found.");
  const body = await readJson<{ html?: unknown; fileName?: unknown }>(req);
  if (!body.ok) return body.res;
  if (typeof body.data.html !== "string") return fail(400, "Upload the questionnaire file.");
  const prepared = await withCompat(prepareSurvey(body.data.html, str(body.data.fileName, 200)), id);
  if (!prepared.survey) return json({ ok: false, error: "The file did not pass the checker.", report: prepared.report, markdown: prepared.markdown }, 422);
  const version = await addVersion(id, prepared.survey);
  return json({ ok: true, version, report: prepared.report }, 201);
}
