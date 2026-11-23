import { MAX_EXPORT_OUTPUT_BYTES, MAX_XLSX_EXPORT_CELLS } from "../participant-limits";

export class ExportOutputSizeLimitError extends Error {
  readonly limitBytes = MAX_EXPORT_OUTPUT_BYTES;
  constructor() {
    super(`The generated export exceeds the ${MAX_EXPORT_OUTPUT_BYTES}-byte output limit.`);
    this.name = "ExportOutputSizeLimitError";
  }
}

export class XlsxComplexityLimitError extends Error {
  readonly limitCells = MAX_XLSX_EXPORT_CELLS;
  constructor(readonly estimatedCells: number) {
    super(`This workbook would exceed the ${MAX_XLSX_EXPORT_CELLS}-cell safety limit. Export as CSV to keep memory use bounded.`);
    this.name = "XlsxComplexityLimitError";
  }
}
