import { fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { addParticipants, getInterview } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const { id } = await params;
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  if (interview.mode !== "multi") return fail(400, "This interview is in One person mode, so it has a single link.");
  const body = await readJson<{ people?: unknown }>(req, 64 * 1024);
  if (!body.ok) return body.res;
  const raw = Array.isArray(body.data.people) ? body.data.people : [];
  const people = raw
    .slice(0, 100)
    .map((p) => ({ name: str((p as { name?: unknown })?.name, 120) ?? "", note: str((p as { note?: unknown })?.note, 1000) }))
    .filter((p) => p.name);
  if (!people.length) return fail(400, "Add at least one person with a name.");
  return json({ ok: true, people: await addParticipants(id, people) }, 201);
}
