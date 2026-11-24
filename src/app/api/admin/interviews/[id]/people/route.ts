import { parseEmail } from "@/lib/mail/address";
import { fail, guardAdmin, json, readJson, str, adminSession, withServerErrors } from "@/lib/http";
import { MAX_PEOPLE_PER_BATCH } from "@/lib/participant-limits";
import { addParticipantsWithOperation, getAddPeopleOperation, getInterview } from "@/lib/repo";
import { operationArgumentDigest, requestOperationId } from "@/lib/operation-id";

type Ctx = { params: Promise<{ id: string }> };

export const POST = withServerErrors("admin/interviews/[id]/people", async function POST(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const operationId = requestOperationId(req);
  if (!operationId) return fail(400, "Send a valid Idempotency-Key header so an uncertain retry cannot add duplicate people.", { code: "idempotency_key_required" });
  const { id } = await params;
  const body = await readJson<{ people?: unknown }>(req, 64 * 1024);
  if (!body.ok) return body.res;
  const raw = Array.isArray(body.data.people) ? body.data.people : [];
  if (raw.length > MAX_PEOPLE_PER_BATCH) return fail(400, `Add at most ${MAX_PEOPLE_PER_BATCH} people per request. Split the list into batches.`);
  const people: { name: string; note?: string; email?: string }[] = [];
  for (const item of raw) {
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
  const operation = {
    operationId,
    credentialId: `host:${session.userId}`,
    tool: "host_add_people",
    argumentDigest: operationArgumentDigest({ interviewId: id, people }),
  };
  const previous = await getAddPeopleOperation(operation);
  if (previous?.kind === "conflict") return fail(409, "This Idempotency-Key was already used with different people or an interview.", { code: "idempotency_key_conflict" });
  if (previous?.kind === "deleted") return fail(410, "The people from this operation were deleted. Use a new Idempotency-Key to add another batch.", { code: "operation_result_unavailable" });
  if (previous?.kind === "replayed") return json({ ok: true, people: previous.people }, 201);
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  // Adding people and promoting a one-person interview are committed together with the replay receipt.
  const added = await addParticipantsWithOperation(id, people, operation);
  if (added.kind === "conflict") return fail(409, "This Idempotency-Key was already used with different people or an interview.", { code: "idempotency_key_conflict" });
  if (added.kind === "deleted") return fail(410, "The people from this operation were deleted. Use a new Idempotency-Key to add another batch.", { code: "operation_result_unavailable" });
  return json({ ok: true, people: added.people }, 201);
});
