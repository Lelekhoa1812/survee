import { fail, guardAdmin, json } from "@/lib/http";
import { regenerateToken, reopenParticipant } from "@/lib/repo";

type Ctx = { params: Promise<{ pid: string; action: string }> };

/** POST /api/admin/people/:pid/reopen unlocks a submitted person. POST .../token replaces their link. */
export async function POST(_req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true });
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
  return fail(404, "Unknown action.");
}
