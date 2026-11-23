import { adminSession, fail, guardAdmin, json, readJson, withServerErrors } from "@/lib/http";
import { resolveInviteAttempt } from "@/lib/repo";

type Ctx = { params: Promise<{ pid: string }> };

export const POST = withServerErrors("admin/people/[pid]/invite-resolution", async function POST(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { pid } = await params;
  const body = await readJson<{ attemptId?: unknown; purpose?: unknown; reason?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  if (body.data.purpose !== "email_change" && body.data.purpose !== "token_rotation") return fail(400, "Choose the email change or link replacement action.", { code: "invalid_purpose" });
  if (typeof body.data.attemptId !== "string" || typeof body.data.reason !== "string") return fail(400, "An invitation attempt and a reason are required.", { code: "invalid_args" });
  const reason = body.data.reason.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  if (!reason || reason.length > 500) return fail(400, "Enter a reason of 1 to 500 characters.", { code: "invalid_reason" });
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const result = await resolveInviteAttempt({ participantId: pid, attemptId: body.data.attemptId, purpose: body.data.purpose, reason, actorId: session.userId });
  if (result === "not_found") return fail(404, "That invitation attempt was not found.", { code: result });
  if (result === "stale") return fail(409, "That invitation attempt is no longer awaiting delivery confirmation.", { code: result });
  if (result === "already_resolved") return fail(409, "That invitation attempt has already been acknowledged.", { code: result });
  return json({ ok: true, disposition: "unknown_acknowledged", purpose: body.data.purpose });
});
