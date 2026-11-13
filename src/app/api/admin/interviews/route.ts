import { fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { createInterview, listInterviews } from "@/lib/repo";
import { prepareSurvey } from "@/lib/survey";

export async function GET() {
  const denied = await guardAdmin();
  if (denied) return denied;
  return json({ ok: true, interviews: await listInterviews() });
}

export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const body = await readJson<{ name?: unknown; description?: unknown; mode?: unknown; html?: unknown; fileName?: unknown }>(req);
  if (!body.ok) return body.res;
  const name = str(body.data.name, 120);
  if (!name) return fail(400, "Give the interview a name.");
  const mode = body.data.mode === "multi" ? "multi" : body.data.mode === "single" ? "single" : null;
  if (!mode) return fail(400, "Choose One person or Multi-user.");
  if (typeof body.data.html !== "string") return fail(400, "Upload the questionnaire file.");
  const prepared = prepareSurvey(body.data.html, str(body.data.fileName, 200));
  if (!prepared.survey) return json({ ok: false, error: "The file did not pass the checker.", report: prepared.report, markdown: prepared.markdown }, 422);
  const doc = await createInterview({ name, description: str(body.data.description, 500) || undefined, mode, survey: prepared.survey });
  return json({ ok: true, id: doc._id.toHexString(), report: prepared.report }, 201);
}
