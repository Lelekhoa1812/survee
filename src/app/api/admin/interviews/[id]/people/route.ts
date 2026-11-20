import { parseEmail } from "@/lib/mail/address";
import { fail, guardAdmin, json, readJson, str, withServerErrors } from "@/lib/http";
import { addParticipants, getInterview, promoteToMultiUser } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withServerErrors("admin/interviews/[id]/people", async function POST(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { id } = await params;
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  const body = await readJson<{ people?: unknown }>(req, 64 * 1024);
  if (!body.ok) return body.res;
  const raw = Array.isArray(body.data.people) ? body.data.people : [];
  const people: { name: string; note?: string; email?: string }[] = [];
  for (const item of raw.slice(0, 100)) {
    const row = item as { name?: unknown; note?: unknown; email?: unknown };
    const name = str(row?.name, 120) ?? "";
    if (!name) continue;
    if (row.email !== undefined && row.email !== null && row.email !== "") {
      if (typeof row.email !== "string") return fail(400, "That does not look like an email address.");
      const parsed = parseEmail(row.email);
      if (!parsed.ok || !parsed.email) return fail(400, parsed.ok ? "That does not look like an email address." : parsed.error);
      people.push({ name, note: str(row.note, 1000), email: parsed.email });
    } else {
      people.push({ name, note: str(row.note, 1000) });
    }
  }
  if (!people.length) return fail(400, "Add at least one person with a name.");
  // Validation is done; only now does a One-person interview become Multi-user.
  if (interview.mode !== "multi") await promoteToMultiUser(id);
  return json({ ok: true, people: await addParticipants(id, people) }, 201);
});
