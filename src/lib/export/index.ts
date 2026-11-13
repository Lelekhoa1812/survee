import { csvLong, csvWide } from "./csv";
import { jsonExport } from "./json";
import { markdownExport } from "./markdown";
import type { ExportFile, ExportFormat, ExportInput } from "./types";
import { xlsxExport } from "./xlsx";

export { EXPORT_FORMATS } from "./types";
export type { ExportFile, ExportFormat, ExportInput, ExportParticipant, ParticipantStatus } from "./types";
export { exportFilename } from "./rows";

/** Build one export of the interview in the requested format. */
export async function exportInterview(input: ExportInput, format: ExportFormat): Promise<ExportFile> {
  switch (format) {
    case "json":
      return jsonExport(input);
    case "csv-wide":
      return csvWide(input);
    case "csv-long":
      return csvLong(input);
    case "xlsx":
      return xlsxExport(input);
    case "md":
      return markdownExport(input);
    default: {
      const unknown: never = format;
      throw new Error(`Unknown export format: ${String(unknown)}`);
    }
  }
}
