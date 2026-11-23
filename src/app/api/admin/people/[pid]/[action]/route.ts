import { checkInviteDelivery } from "@/lib/mail/delivery";
import { sendInvite } from "@/lib/mail/invite";
import { fail, guardAdmin, json, readJson, withServerErrors } from "@/lib/http";
import { regenerateToken, reopenParticipant } from "@/lib/repo";

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
    const token = await regenerateToken(pid);
    return token ? json({ ok: true, token }) : fail(404, "Person not found.");
  }
  if (action === "invite") {
    const body = await readJson<{ resend?: unknown }>(req, 4096);
    if (!body.ok) return body.res;
    const result = await sendInvite({ personId: pid, triggeredBy: "admin", resend: body.data.resend === true });
    if (!result.ok) {
      const status = result.code === "not_found" ? 404 : result.code === "closed" || result.code === "outcome_unknown" ? 409 : result.code === "attempt_unavailable" || result.code === "rate_limit_unavailable" ? 503 : result.code === "rate_limited" ? 429 : 400;
      return fail(status, result.error, { code: result.code });
    }
    return json({ ok: true, result: result.result, sentAt: result.sentAt });
  }
  if (action === "delivery") {
    const result = await checkInviteDelivery(pid);
    if (!result.ok) return fail(result.code === "not_found" ? 404 : result.code === "rate_limited" ? 429 : result.code === "rate_limit_unavailable" ? 503 : 400, result.error, { code: result.code });
    return json({ ok: true, delivery: result.delivery, detail: result.detail ?? null, checkedAt: result.checkedAt });
  }
  return fail(404, "Unknown action.");
});
