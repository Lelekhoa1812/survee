import { fail, guardAdmin, json, withServerErrors } from "@/lib/http";
import { EventCursorError, getInterview, listEventPage } from "@/lib/repo";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withServerErrors("admin/interviews/[id]/events", async function GET(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ roles: ["owner", "admin"] });
  if (denied) return denied;
  const { id } = await params;
  if (!(await getInterview(id))) return fail(404, "Interview not found.");
  const query = new URL(req.url).searchParams;
  const rawLimit = query.get("limit");
  const limit = rawLimit === null ? 25 : Number(rawLimit);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 50) return fail(400, "limit must be an integer from 1 to 50.", { code: "invalid_args" });
  const cursor = query.get("cursor");
  if (cursor !== null && (!cursor || cursor.length > 512)) return fail(400, "cursor is invalid.", { code: "invalid_cursor" });
  try {
    return json({ ok: true, ...await listEventPage(id, cursor, limit) });
  } catch (error) {
    if (error instanceof EventCursorError) return fail(400, "cursor is invalid.", { code: "invalid_cursor" });
    throw error;
  }
});
