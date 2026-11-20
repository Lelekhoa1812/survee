import { fail, json, readJson, withServerErrors } from "@/lib/http";
import { saveAnswers, type AnswerPatch } from "@/lib/repo";
import { ID_RE, type RepeatRecordOperation } from "@/lib/format/schema";
import { looksLikeToken } from "@/lib/tokens";

type Ctx = { params: Promise<{ token: string }> };

/** Body: { version, answers?, recordOperations? }. Only supplied scalar ids and explicit record operations are changed. */
export const PUT = withServerErrors("p/answers", async function PUT(req: Request, { params }: Ctx) {
  const { token } = await params;
  if (!looksLikeToken(token)) return fail(404, "This link is not valid.");
  const body = await readJson<{ version?: unknown; answers?: unknown; recordOperations?: unknown }>(req, 512 * 1024);
  if (!body.ok) return body.res;
  if (typeof body.data.version !== "number" || !Number.isSafeInteger(body.data.version) || body.data.version < 1) {
    return fail(409, "This questionnaire version is missing. Reload the page to continue.", { code: "questionnaire_version_changed" });
  }
  const a = body.data.answers;
  if (a !== undefined && (!a || typeof a !== "object" || Array.isArray(a))) return fail(400, "Send answers as an object keyed by question id.");
  const ops = body.data.recordOperations;
  if (ops !== undefined && (!Array.isArray(ops) || ops.length > 200 || ops.some((op) => !isRepeatRecordOperation(op)))) {
    return fail(400, "Send recordOperations as an array of record operations.");
  }
  const result = await saveAnswers(token, body.data.version, (a ?? {}) as AnswerPatch, (ops ?? []) as RepeatRecordOperation[]);
  return result.ok ? json(result) : fail(result.status, result.error, { code: result.code, details: result.details, recordErrors: result.recordErrors });
});

function isRepeatRecordOperation(value: unknown): value is RepeatRecordOperation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const op = value as Record<string, unknown>;
  if (typeof op.questionId !== "string" || !ID_RE.test(op.questionId) || typeof op.rowId !== "string" || !ID_RE.test(op.rowId)) return false;
  if (op.op === "add") return true;
  if (op.op === "remove") return Number.isSafeInteger(op.expectedRowRevision) && (op.expectedRowRevision as number) >= 0;
  if (op.op === "set" || op.op === "clear") {
    if (typeof op.fieldId !== "string" || !ID_RE.test(op.fieldId) || !Number.isSafeInteger(op.expectedFieldRevision) || (op.expectedFieldRevision as number) < 0) return false;
    if (op.op === "clear") return true;
    return (typeof op.value === "string" || typeof op.value === "number") && (typeof op.value !== "number" || Number.isFinite(op.value));
  }
  return false;
}
