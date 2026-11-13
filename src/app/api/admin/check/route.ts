import { fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { prepareSurvey, withCompat } from "@/lib/survey";

/** Check a file without storing anything. With interviewId it also reports what replacing the current version would do. */
export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const body = await readJson<{ html?: unknown; fileName?: unknown; interviewId?: unknown }>(req);
  if (!body.ok) return body.res;
  if (typeof body.data.html !== "string") return fail(400, "Send the file text as `html`.");
  let prepared = prepareSurvey(body.data.html, str(body.data.fileName, 200));
  const interviewId = str(body.data.interviewId, 40);
  if (interviewId) prepared = await withCompat(prepared, interviewId);
  return json({ ok: prepared.report.ok, report: prepared.report, markdown: prepared.markdown });
}
