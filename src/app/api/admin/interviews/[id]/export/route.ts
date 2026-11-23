import { EXPORT_FORMATS, exportInterview, type ExportFormat } from "@/lib/export";
import { fail, guardAdmin, withServerErrors } from "@/lib/http";
import { getInterview, getVersion, listParticipants } from "@/lib/repo";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

export const GET = withServerErrors("admin/interviews/[id]/export", async function GET(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ roles: ["owner", "admin"] });
  if (denied) return denied;
  const { id } = await params;
  const format = new URL(req.url).searchParams.get("format") as ExportFormat | null;
  if (!format || !EXPORT_FORMATS.includes(format)) return fail(400, `format must be one of ${EXPORT_FORMATS.join(", ")}.`);
  const interview = await getInterview(id);
  if (!interview) return fail(404, "Interview not found.");
  const version = await getVersion(interview._id, interview.currentVersion);
  if (!version) return fail(404, "Survey version not found.");
  const people = await listParticipants(id);
  const file = await exportInterview(
    {
      interview: { id, name: interview.name, description: interview.description, mode: interview.mode, status: interview.status, createdAt: interview.createdAt.toISOString() },
      manifest: version.manifest,
      surveyVersion: version.version,
      participants: people.map((p) => ({ id: p.id, name: p.name, note: p.note, status: p.status, createdAt: p.createdAt, lastSavedAt: p.lastSavedAt, submittedAt: p.submittedAt, answers: p.answers, recordGroups: p.recordGroups, questionOrderAssignments: p.questionOrderAssignments })),
      generatedAt: new Date().toISOString(),
    },
    format,
  );
  const body = typeof file.body === "string" ? file.body : new Uint8Array(file.body);
  return new NextResponse(body, {
    headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`, "Cache-Control": "no-store" },
  });
});
