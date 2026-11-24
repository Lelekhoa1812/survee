import { createHash } from "node:crypto";

const OPERATION_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

export function isValidOperationId(value: unknown): value is string {
  return typeof value === "string" && OPERATION_ID_PATTERN.test(value);
}

export function operationArgumentDigest(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    return `{${entries.map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function requestOperationId(req: Request): string | null {
  const value = req.headers.get("idempotency-key");
  return isValidOperationId(value) ? value : null;
}
