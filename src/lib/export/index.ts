import { csvLong, csvWide } from "./csv";
import { jsonExport } from "./json";
import { markdownExport } from "./markdown";
import type { ExportFile, ExportFormat, ExportInput } from "./types";
import { xlsxExport } from "./xlsx";
import { MAX_EXPORT_OUTPUT_BYTES } from "../participant-limits";
import { ExportOutputSizeLimitError } from "./errors";

export { EXPORT_FORMATS } from "./types";
export type { ExportFile, ExportFormat, ExportInput, ExportParticipant, ParticipantStatus } from "./types";
export { exportFilename } from "./rows";
export { MAX_EXPORT_OUTPUT_BYTES } from "../participant-limits";

export { ExportOutputSizeLimitError, XlsxComplexityLimitError } from "./errors";

/** Build one export of the interview in the requested format. */
export async function exportInterview(input: ExportInput, format: ExportFormat): Promise<ExportFile> {
  let file: ExportFile;
  switch (format) {
    case "json":
      file = jsonExport(input);
      break;
    case "csv-wide":
      file = csvWide(input);
      break;
    case "csv-long":
      file = csvLong(input);
      break;
    case "xlsx":
      file = await xlsxExport(input);
      break;
    case "md":
      file = markdownExport(input);
      break;
    default: {
      const unknown: never = format;
      throw new Error(`Unknown export format: ${String(unknown)}`);
    }
  }
  const outputBytes = typeof file.body === "string" ? Buffer.byteLength(file.body, "utf8") : file.body.byteLength;
  if (outputBytes > MAX_EXPORT_OUTPUT_BYTES) throw new ExportOutputSizeLimitError();
  return file;
}
