import { parseEmail } from "@/lib/mail/address";
import { fail, guardAdmin, json, readJson, str, withServerErrors } from "@/lib/http";
import { deleteParticipant, updateParticipant } from "@/lib/repo";

type Ctx = { params: Promise<{ pid: string }> };

export const PATCH = withServerErrors("admin/people/[pid]", async function PATCH(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { pid } = await params;
  const body = await readJson<{ name?: unknown; note?: unknown; email?: unknown }>(req, 16 * 1024);
  if (!body.ok) return body.res;
  const patch: Parameters<typeof updateParticipant>[1] = {};
  if (body.data.name !== undefined) {
    const n = str(body.data.name, 120);
    if (!n) return fail(400, "The name cannot be empty.");
    patch.name = n;
  }
  if (body.data.note !== undefined) patch.note = str(body.data.note, 1000) ?? null;
  if (body.data.email !== undefined) {
    if (body.data.email === null || body.data.email === "") patch.email = null;
    else if (typeof body.data.email !== "string") return fail(400, "That does not look like an email address.");
    else {
      const parsed = parseEmail(body.data.email);
      if (!parsed.ok) return fail(400, parsed.error);
      patch.email = parsed.email;
    }
  }
  const p = await updateParticipant(pid, patch);
  return p ? json({ ok: true, person: p }) : fail(404, "Person not found.");
});

export const DELETE = withServerErrors("admin/people/[pid]", async function DELETE(_req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { pid } = await params;
  const result = await deleteParticipant(pid);
  if (result === "invite_pending") return fail(409, "This person's invite outcome is still unconfirmed. Resolve the invite status before deleting their data.", { code: "invite_outcome_pending" });
  return result ? json({ ok: true }) : fail(404, "Person not found.");
});
