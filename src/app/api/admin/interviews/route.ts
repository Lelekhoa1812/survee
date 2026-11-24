import { fail, guardAdmin, json, readJson, str, adminSession, withServerErrors } from "@/lib/http";
import { createInterviewWithOperation, getCreateInterviewOperation, listInterviews } from "@/lib/repo";
import { prepareSurvey } from "@/lib/survey";
import { operationArgumentDigest, requestOperationId } from "@/lib/operation-id";

export const GET = withServerErrors("admin/interviews", async function GET() {
  const denied = await guardAdmin();
  if (denied) return denied;
  return json({ ok: true, interviews: await listInterviews() });
});

export const POST = withServerErrors("admin/interviews", async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const operationId = requestOperationId(req);
  if (!operationId) return fail(400, "Send a valid Idempotency-Key header so an uncertain retry cannot create a duplicate interview.", { code: "idempotency_key_required" });
  const body = await readJson<{ name?: unknown; description?: unknown; mode?: unknown; html?: unknown; fileName?: unknown }>(req);
  if (!body.ok) return body.res;
  const name = str(body.data.name, 120);
  if (!name) return fail(400, "Give the interview a name.");
  const mode = body.data.mode === "multi" ? "multi" : body.data.mode === "single" ? "single" : null;
  if (!mode) return fail(400, "Choose One person or Multi-user.");
  if (typeof body.data.html !== "string") return fail(400, "Upload the questionnaire file.");
  const description = str(body.data.description, 500) || undefined;
  const fileName = str(body.data.fileName, 200);
  const operation = {
    operationId,
    credentialId: `host:${session.userId}`,
    tool: "host_create_interview",
    argumentDigest: operationArgumentDigest({ name, description, mode, html: body.data.html, fileName }),
  };
  const previous = await getCreateInterviewOperation(operation);
  if (previous?.kind === "conflict") return fail(409, "This Idempotency-Key was already used with different interview details.", { code: "idempotency_key_conflict" });
  if (previous?.kind === "deleted") return fail(410, "The interview from this operation was deleted. Use a new Idempotency-Key to create another.", { code: "operation_result_unavailable" });
  if (previous?.kind === "replayed") return json({ ok: true, id: previous.result.id, report: previous.result.report }, 201);

  const prepared = prepareSurvey(body.data.html, fileName);
  if (!prepared.survey) return json({ ok: false, error: "The file did not pass the checker.", report: prepared.report, markdown: prepared.markdown }, 422);
  const created = await createInterviewWithOperation({ name, description, mode, survey: prepared.survey }, { ...operation, report: prepared.report as unknown as Record<string, unknown> });
  if (created.kind === "conflict") return fail(409, "This Idempotency-Key was already used with different interview details.", { code: "idempotency_key_conflict" });
  if (created.kind === "deleted") return fail(410, "The interview from this operation was deleted. Use a new Idempotency-Key to create another.", { code: "operation_result_unavailable" });
  return json({ ok: true, id: created.result.id, report: created.result.report }, 201);
});
