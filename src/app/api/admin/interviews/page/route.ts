import { fail, guardAdmin, json, withServerErrors } from "@/lib/http";
import { DEFAULT_INTERVIEW_PAGE_SIZE, InterviewPageCursorError, InterviewPageFilterError, listInterviewPage, MAX_INTERVIEW_PAGE_SIZE, MAX_INTERVIEW_SEARCH_LENGTH } from "@/lib/repo";

export const GET = withServerErrors("admin/interviews/page", async function GET(req: Request) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const params = new URL(req.url).searchParams;
  const rawLimit = params.get("limit");
  const limit = rawLimit === null ? DEFAULT_INTERVIEW_PAGE_SIZE : Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INTERVIEW_PAGE_SIZE) return fail(400, `limit must be an integer from 1 to ${MAX_INTERVIEW_PAGE_SIZE}.`);
  const cursor = params.get("cursor") || undefined;
  if (cursor && cursor.length > 256) return fail(400, "cursor must be a valid interview page cursor.");
  const search = params.get("search") || undefined;
  const status = params.get("status") || undefined;
  const mode = params.get("mode") || undefined;
  if (search && search.length > MAX_INTERVIEW_SEARCH_LENGTH) return fail(400, `search must be ${MAX_INTERVIEW_SEARCH_LENGTH} characters or fewer.`);
  if (status && status !== "open" && status !== "closed") return fail(400, "status must be open or closed.");
  if (mode && mode !== "single" && mode !== "multi") return fail(400, "mode must be single or multi.");
  try {
    return json({ ok: true, ...(await listInterviewPage({ cursor, limit, search, status: status as "open" | "closed" | undefined, mode: mode as "single" | "multi" | undefined })) });
  } catch (error) {
    if (error instanceof InterviewPageCursorError) return fail(400, error.message);
    if (error instanceof InterviewPageFilterError) return fail(400, error.message);
    throw error;
  }
});
