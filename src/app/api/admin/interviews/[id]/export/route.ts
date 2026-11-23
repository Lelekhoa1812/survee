import { EXPORT_FORMATS, exportFilename, exportInterview, ExportOutputSizeLimitError, type ExportFormat, type ExportParticipant } from "@/lib/export";
import { encodeCsvRow } from "@/lib/export/csv";
import { LONG_HEADER, wideColumns, longParticipantRows, wideParticipantRow } from "@/lib/export/rows";
import { fail, guardAdmin, withServerErrors } from "@/lib/http";
import { getInterview, getVersion, listParticipantPage, listParticipants, ParticipantExportSizeLimitError, ParticipantReadLimitError } from "@/lib/repo";
import { MAX_EXPORT_SOURCE_BYTES, MAX_STREAMED_CSV_OUTPUT_BYTES } from "@/lib/participant-limits";
import { NextResponse } from "next/server";

type Ctx = { params: Promise<{ id: string }> };

async function csvPage(id: string, cursor: string | null) {
  // Large answers can make ten documents exceed the hydration budget even when
  // each respondent is valid. Reduce the page until its lookahead also fits.
  for (let limit = 10; limit >= 1; limit = Math.max(1, Math.floor(limit / 2))) {
    try {
      return await listParticipantPage(id, cursor, limit, false, false, MAX_EXPORT_SOURCE_BYTES);
    } catch (error) {
      if (!(error instanceof ParticipantExportSizeLimitError) || limit === 1) throw error;
    }
  }
  throw new Error("CSV export page could not be loaded.");
}

class StaleExportError extends Error {
  constructor() {
    super("Interview data changed while the export was being created. Run the export again.");
    this.name = "StaleExportError";
  }
}

async function assertExportSnapshot(id: string, version: number, revision: number): Promise<void> {
  const current = await getInterview(id);
  if (!current || current.currentVersion !== version || (current.respondentWriteRevision ?? 0) !== revision) {
    throw new StaleExportError();
  }
}

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
  const snapshot = { version: interview.currentVersion, revision: interview.respondentWriteRevision ?? 0 };
  try {
    await assertExportSnapshot(id, snapshot.version, snapshot.revision);
  } catch (error) {
    if (error instanceof StaleExportError) return fail(409, error.message, { code: "export_stale" });
    throw error;
  }
  const base = {
    interview: { id, name: interview.name, description: interview.description, mode: interview.mode, status: interview.status, createdAt: interview.createdAt.toISOString() },
    manifest: version.manifest,
    surveyVersion: version.version,
    participants: [],
    generatedAt: new Date().toISOString(),
  };
  if (format === "csv-wide" || format === "csv-long") {
    {
      let firstPage;
      try {
        await assertExportSnapshot(id, snapshot.version, snapshot.revision);
        firstPage = await csvPage(id, null);
        await assertExportSnapshot(id, snapshot.version, snapshot.revision);
      } catch (error) {
        if (error instanceof StaleExportError) return fail(409, error.message, { code: "export_stale" });
        if (error instanceof ParticipantExportSizeLimitError) return fail(413, error.message, { code: "export_page_limit", limitBytes: error.limitBytes });
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
      let emittedBytes = 0;
      const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const enqueue = (value: string) => {
            const chunk = encoder.encode(value);
            if (emittedBytes + chunk.byteLength > MAX_STREAMED_CSV_OUTPUT_BYTES) throw new Error(`CSV export exceeded the ${MAX_STREAMED_CSV_OUTPUT_BYTES}-byte output limit.`);
            emittedBytes += chunk.byteLength;
            controller.enqueue(chunk);
          };
          const rowsFor = (person: ExportParticipant) => format === "csv-wide"
            ? [wideParticipantRow(version.manifest, version.version, person)]
            : longParticipantRows(version.manifest, person);
          try {
            if (!headerSent) {
              headerSent = true;
              enqueue("\uFEFF" + encodeCsvRow(headers));
              return;
            }
            while (controller.desiredSize === null || controller.desiredSize > 0) {
              if (rowIndex < rows.length) {
                enqueue(encodeCsvRow(rows[rowIndex++]));
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
              await assertExportSnapshot(id, snapshot.version, snapshot.revision);
              page = await csvPage(id, cursor);
              await assertExportSnapshot(id, snapshot.version, snapshot.revision);
              personIndex = 0;
            }
          } catch (error) {
            controller.error(error instanceof Error ? error : new Error("CSV export stream failed"));
          }
        },
      });
      return new NextResponse(stream, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "")}"`, "Cache-Control": "no-store", "X-Export-Max-Bytes": String(MAX_STREAMED_CSV_OUTPUT_BYTES) },
      });
    }
  }
  let people;
  try {
    await assertExportSnapshot(id, snapshot.version, snapshot.revision);
    people = await listParticipants(id);
    await assertExportSnapshot(id, snapshot.version, snapshot.revision);
  } catch (error) {
    if (error instanceof StaleExportError) return fail(409, error.message, { code: "export_stale" });
    if (error instanceof ParticipantReadLimitError) return fail(413, `This interview is too large for a single export request. Export supports up to ${error.limit} people per request.`, { code: "export_participant_limit", limit: error.limit });
    if (error instanceof ParticipantExportSizeLimitError) return fail(413, error.message, { code: "export_payload_limit", limitBytes: error.limitBytes });
    throw error;
  }
  let file: Awaited<ReturnType<typeof exportInterview>>;
  try {
    file = await exportInterview(
    {
      ...base,
      participants: people.map((p) => ({ id: p.id, name: p.name, note: p.note, status: p.status, createdAt: p.createdAt, lastSavedAt: p.lastSavedAt, submittedAt: p.submittedAt, answers: p.answers, recordGroups: p.recordGroups, questionOrderAssignments: p.questionOrderAssignments })),
    },
      format,
    );
  } catch (error) {
    if (error instanceof ExportOutputSizeLimitError) return fail(413, error.message, { code: "export_output_limit", limitBytes: error.limitBytes });
    throw error;
  }
  const body = typeof file.body === "string" ? file.body : new Uint8Array(file.body);
  return new NextResponse(body, {
    headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename.replace(/"/g, "")}"`, "Cache-Control": "no-store" },
  });
});
