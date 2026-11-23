import { fail, guardAdmin, json, withServerErrors } from "@/lib/http";
import { DEFAULT_INTERVIEW_PAGE_SIZE, InterviewPageCursorError, listInterviewPage, MAX_INTERVIEW_PAGE_SIZE } from "@/lib/repo";

export const GET = withServerErrors("admin/interviews/page", async function GET(req: Request) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? DEFAULT_INTERVIEW_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INTERVIEW_PAGE_SIZE) return fail(400, `limit must be an integer from 1 to ${MAX_INTERVIEW_PAGE_SIZE}.`);
  const cursor = params.get("cursor") || undefined;
  if (cursor && cursor.length > 256) return fail(400, "cursor must be a valid interview page cursor.");
  try {
    return json({ ok: true, ...(await listInterviewPage({ cursor, limit })) });
  } catch (error) {
    if (error instanceof InterviewPageCursorError) return fail(400, error.message);
    throw error;
  }
});
