import { participantRows } from "@/lib/host/participant-rows";
import { fail, guardAdmin, json, withServerErrors } from "@/lib/http";
import { getInterview, getVersion, listParticipantPage, ParticipantCursorError } from "@/lib/repo";
import { listCurrentMailByParticipants, mailRecord } from "@/lib/repo/mail";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withServerErrors("admin/interviews/[id]/participants", async function GET(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ roles: ["owner", "admin"] });
  if (denied) return denied;
  const { id } = await params;
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  const version = await getVersion(interview._id, interview.currentVersion);
  if (!version) return fail(404, "Survey version not found.");

  const url = new URL(req.url);
  const rawCursor = url.searchParams.get("cursor");
  const cursor = rawCursor === "" ? null : rawCursor;
  const rawLimit = url.searchParams.get("limit");
  const limit = rawLimit === null ? undefined : Number(rawLimit);
  const includeAnswersParam = url.searchParams.get("includeAnswers");
  if ((cursor !== null && cursor.length > 256)
    || (rawLimit !== null && (!/^\d{1,3}$/.test(rawLimit) || !Number.isInteger(limit) || Number(limit) < 1 || Number(limit) > 100))
    || (includeAnswersParam !== null && includeAnswersParam !== "1")) {
    return fail(400, "The participant page request is invalid.");
  }
  const includeAnswers = includeAnswersParam === "1";

  try {
    const page = await listParticipantPage(id, cursor, limit, false, includeAnswers);
    const mail = includeAnswers ? [] : await listCurrentMailByParticipants(interview._id, page.people);
    return json({ ok: true, people: participantRows(version.manifest, page.people, mail.map(mailRecord), includeAnswers), nextCursor: page.nextCursor });
  } catch (error) {
    if (error instanceof ParticipantCursorError) return fail(400, error.message, { code: "participant_cursor_invalid" });
    throw error;
  }
});
