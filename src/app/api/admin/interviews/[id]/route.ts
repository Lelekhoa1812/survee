import { adminSession, fail, guardAdmin, json, readJson, str, withServerErrors } from "@/lib/http";
import { deleteInterview, getInterview, getVersion, listParticipantPage, listVersions, recentEvents, updateInterview } from "@/lib/repo";
import { participantRows } from "@/lib/host/participant-rows";
import { listCurrentMailByParticipants, mailRecord } from "@/lib/repo/mail";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withServerErrors("admin/interviews/[id]", async function GET(_req: Request, { params }: Ctx) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const { id } = await params;
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  const canManage = session.role === "owner" || session.role === "admin";
  const [peoplePage, versions, events, current] = await Promise.all([
    canManage ? listParticipantPage(id, null, undefined, false, false) : Promise.resolve({ people: [], nextCursor: null }),
    listVersions(interview._id),
    canManage ? recentEvents(id) : Promise.resolve([]),
    getVersion(interview._id, interview.currentVersion),
  ]);
  const mailRows = canManage ? await listCurrentMailByParticipants(interview._id, peoplePage.people) : [];
  return json({
    ok: true, interview: { ...interview, _id: id },
    people: current ? participantRows(current.manifest, peoplePage.people, mailRows.map(mailRecord), false) : [],
    nextCursor: peoplePage.nextCursor, versions, events,
  });
});

export const PATCH = withServerErrors("admin/interviews/[id]", async function PATCH(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
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
});

export const DELETE = withServerErrors("admin/interviews/[id]", async function DELETE(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { id } = await params;
  const body = await readJson<{ confirmName?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  if (body.data.confirmName !== interview.name) return fail(400, "Type the interview name exactly to confirm deleting it.", { code: "confirmation_mismatch" });
  const deleted = await deleteInterview(id);
  return deleted ? json({ ok: true }) : fail(404, "Interview not found.");
});
