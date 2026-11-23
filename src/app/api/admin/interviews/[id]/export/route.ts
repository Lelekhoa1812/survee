import { EXPORT_FORMATS, exportFilename, exportInterview, type ExportFormat, type ExportParticipant } from "@/lib/export";
import { encodeCsvRow } from "@/lib/export/csv";
import { LONG_HEADER, wideColumns, longParticipantRows, wideParticipantRow } from "@/lib/export/rows";
import { fail, guardAdmin, withServerErrors } from "@/lib/http";
import { getInterview, getInterviewParticipantCounts, getVersion, listParticipantPage, listParticipants, ParticipantExportSizeLimitError, ParticipantReadLimitError } from "@/lib/repo";
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
  const base = {
    interview: { id, name: interview.name, description: interview.description, mode: interview.mode, status: interview.status, createdAt: interview.createdAt.toISOString() },
    manifest: version.manifest,
    surveyVersion: version.version,
    participants: [],
    generatedAt: new Date().toISOString(),
  };
  if (format === "csv-wide" || format === "csv-long") {
    const counts = await getInterviewParticipantCounts(id);
    if (counts.people > 100) {
      let firstPage;
      try {
        firstPage = await listParticipantPage(id, null, 10, false, true);
      } catch {
        return fail(503, "The export could not be started. Try again in a moment.", { code: "export_stream_unavailable" });
      }
      const filename = exportFilename(base, format);
      const encoder = new TextEncoder();
      const headers = format === "csv-wide" ? wideColumns(version.manifest, version.version).map((column) => column.header) : LONG_HEADER;
      let page = firstPage;
      let personIndex = 0;
      let rows: string[][] = [];
      let rowIndex = 0;
      let cursor: string | null = null;
      let headerSent = false;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const rowsFor = (person: ExportParticipant) => format === "csv-wide"
            ? [wideParticipantRow(version.manifest, version.version, person)]
            : longParticipantRows(version.manifest, person);
          try {
            if (!headerSent) {
              headerSent = true;
              controller.enqueue(encoder.encode("\uFEFF" + encodeCsvRow(headers)));
              return;
            }
            while (controller.desiredSize === null || controller.desiredSize > 0) {
              if (rowIndex < rows.length) {
                controller.enqueue(encoder.encode(encodeCsvRow(rows[rowIndex++])));
                continue;
              }
              if (personIndex < page.people.length) {
                const view = page.people[personIndex++];
                const person: ExportParticipant = {
                  id: view.id, name: view.name, note: view.note, status: view.status, createdAt: view.createdAt,
                  lastSavedAt: view.lastSavedAt, submittedAt: view.submittedAt, answers: view.answers,
                  recordGroups: view.recordGroups, questionOrderAssignments: view.questionOrderAssignments,
                };
                rows = rowsFor(person);
                rowIndex = 0;
                continue;
              }
              if (!page.nextCursor) {
                controller.close();
                return;
              }
              cursor = page.nextCursor;
              page = await listParticipantPage(id, cursor, 10, false, true);
              personIndex = 0;
            }
          } catch {
            controller.error(new Error("CSV export stream failed"));
          }
        },
      });
      return new NextResponse(stream, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`, "Cache-Control": "no-store" },
      });
    }
  }
  let people;
  try {
    people = await listParticipants(id);
  } catch (error) {
    if (error instanceof ParticipantReadLimitError) return fail(413, `This interview is too large for a single export request. Export supports up to ${error.limit} people per request.`, { code: "export_participant_limit", limit: error.limit });
    if (error instanceof ParticipantExportSizeLimitError) return fail(413, error.message, { code: "export_payload_limit", limitBytes: error.limitBytes });
    throw error;
  }
  const file = await exportInterview(
    {
      ...base,
      participants: people.map((p) => ({ id: p.id, name: p.name, note: p.note, status: p.status, createdAt: p.createdAt, lastSavedAt: p.lastSavedAt, submittedAt: p.submittedAt, answers: p.answers, recordGroups: p.recordGroups, questionOrderAssignments: p.questionOrderAssignments })),
    },
    format,
  );
  const body = typeof file.body === "string" ? file.body : new Uint8Array(file.body);
  return new NextResponse(body, {
    headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`, "Cache-Control": "no-store" },
  });
});
