import { fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { deleteInterview, getInterview, listParticipants, listVersions, recentEvents, updateInterview } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const { id } = await params;
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  const [people, versions, events] = await Promise.all([listParticipants(id), listVersions(interview._id), recentEvents(id)]);
  return json({ ok: true, interview: { ...interview, _id: id }, people, versions, events });
}

export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ name?: unknown; description?: unknown; status?: unknown }>(req, 16 * 1024);
  if (!body.ok) return body.res;
  const patch: Parameters<typeof updateInterview>[1] = {};
  if (body.data.name !== undefined) {
    const n = str(body.data.name, 120);
    if (!n) return fail(400, "The name cannot be empty.");
    patch.name = n;
  }
  if (body.data.description !== undefined) patch.description = str(body.data.description, 500) ?? null;
  if (body.data.status !== undefined) {
    if (body.data.status !== "open" && body.data.status !== "closed") return fail(400, "Status must be open or closed.");
    patch.status = body.data.status;
  }
  const updated = await updateInterview(id, patch);
  return updated ? json({ ok: true }) : fail(404, "Interview not found.");
}

export async function DELETE(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ confirmName?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  if (body.data.confirmName !== interview.name) return fail(400, "Type the interview name exactly to confirm deleting it.");
  const deleted = await deleteInterview(id);
  return deleted ? json({ ok: true }) : fail(404, "Interview not found.");
}
