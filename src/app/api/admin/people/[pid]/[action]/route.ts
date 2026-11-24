import { checkInviteDelivery } from "@/lib/mail/delivery";
import { sendInvite } from "@/lib/mail/invite";
import { adminSession, fail, guardAdmin, json, readJson, withServerErrors } from "@/lib/http";
import { operationArgumentDigest, requestOperationId } from "@/lib/operation-id";
import { getRegenerateLinkOperation, regenerateTokenWithOperation, reopenParticipant } from "@/lib/repo";

type Ctx = { params: Promise<{ pid: string; action: string }> };

export const maxDuration = 30;

/** POST reopen, token, invite, or delivery for one person. Invite sends a single message. */
export const POST = withServerErrors("admin/people/[pid]/[action]", async function POST(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { pid, action } = await params;
  if (action === "reopen") {
    const p = await reopenParticipant(pid);
    return p ? json({ ok: true, person: p }) : fail(409, "That person has not submitted, so there is nothing to reopen.");
  }
  if (action === "token") {
    const session = await adminSession();
    if (!session) return fail(401, "Sign in to continue.");
    const operationId = requestOperationId(req);
    if (!operationId) return fail(400, "Send a valid Idempotency-Key header so an uncertain retry cannot replace the private link again.", { code: "idempotency_key_required" });
    const operation = {
      operationId,
      credentialId: `host:${session.userId}`,
      tool: "host_regenerate_link",
      argumentDigest: operationArgumentDigest({ personId: pid }),
    };
    const previous = await getRegenerateLinkOperation(operation);
    if (previous?.kind === "conflict") return fail(409, "This Idempotency-Key was already used for a different private-link replacement.", { code: "idempotency_key_conflict" });
    if (previous?.kind === "deleted") return fail(410, "The person from this operation was deleted. Use a new Idempotency-Key to replace another link.", { code: "operation_result_unavailable" });
    if (previous?.kind === "replayed") return json({ ok: true, token: previous.token });
    const rotated = await regenerateTokenWithOperation(pid, operation);
    if (rotated.kind === "conflict") return fail(409, "This Idempotency-Key was already used for a different private-link replacement.", { code: "idempotency_key_conflict" });
    if (rotated.kind === "deleted") return fail(410, "The person from this operation was deleted. Use a new Idempotency-Key to replace another link.", { code: "operation_result_unavailable" });
    if (rotated.kind === "invite_pending") return fail(409, "Resolve the pending invitation before replacing this private link.", { code: "invite_pending" });
    if (rotated.kind === "not_found") return fail(404, "Person not found.");
    return json({ ok: true, token: rotated.token });
  }
  if (action === "invite") {
    const body = await readJson<{ resend?: unknown }>(req, 4096);
    if (!body.ok) return body.res;
    const result = await sendInvite({ personId: pid, triggeredBy: "admin", resend: body.data.resend === true });
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : result.code === "closed" || result.code === "outcome_unknown" ? 409 : result.code === "attempt_unavailable" || result.code === "rate_limit_unavailable" || result.code === "preflight_unavailable" ? 503 : result.code === "rate_limited" ? 429 : 400;
      return fail(status, result.error, { code: result.code });
    }
    return json({ ok: true, result: result.result, sentAt: result.sentAt });
  }
  if (action === "delivery") {
    const body = await readJson<{ attemptId?: unknown }>(req, 4096);
    if (!body.ok) return body.res;
    if (body.data.attemptId !== undefined && typeof body.data.attemptId !== "string") return fail(400, "That invite attempt is invalid.", { code: "invalid_args" });
    const result = await checkInviteDelivery(pid, {}, body.data.attemptId as string | undefined);
    if (!result.ok) return fail(result.code === "not_found" ? 404 : result.code === "superseded" ? 409 : result.code === "rate_limited" ? 429 : result.code === "rate_limit_unavailable" ? 503 : 400, result.error, { code: result.code });
    return json({ ok: true, delivery: result.delivery, detail: result.detail ?? null, checkedAt: result.checkedAt });
  }
  return fail(404, "Unknown action.");
});
