import { fail, guardAdmin, json, withServerErrors } from "@/lib/http";
import { toOid } from "@/lib/repo";
import { listPendingMailByPerson, mailRecord } from "@/lib/repo/mail";

type Ctx = { params: Promise<{ pid: string }> };

export const GET = withServerErrors("admin/people/[pid]/pending-invites", async function GET(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ roles: ["owner", "admin"] });
  if (denied) return denied;
  const { pid } = await params;
  const participantId = toOid(pid);
  if (!participantId) return fail(404, "Person not found.");
  const url = new URL(req.url);
  const before = url.searchParams.get("before");
  const beforeId = before ? toOid(before) : undefined;
  if (before && !beforeId) return fail(400, "That page cursor is invalid.", { code: "invalid_cursor" });
  const page = await listPendingMailByPerson(participantId, beforeId ?? undefined, 50);
  return json({
    ok: true, total: page.total, nextCursor: page.nextCursor,
    attempts: page.rows.map((row) => {
      const item = mailRecord(row);
      return { attemptId: item.id, email: item.to, sentAt: item.sentAt, resolution: item.resolution };
    }),
  });
});
