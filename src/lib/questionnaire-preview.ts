import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "./env";

export interface QuestionnairePreviewClaims {
  v: 1;
  tenantId: string;
  interviewId: string;
  expectedVersion: number;
  baseHash: string;
  candidateHash: string;
  fileNameHash: string;
  compatibilityHash: string;
  exp: number;
}

export type QuestionnairePreviewFailure = "preview_required" | "preview_expired" | "invalid_preview";

export type QuestionnairePreviewBindings = Omit<QuestionnairePreviewClaims, "v" | "exp">;
export type QuestionnairePreviewVerificationBindings = Pick<QuestionnairePreviewBindings, "tenantId" | "interviewId" | "expectedVersion" | "baseHash" | "candidateHash" | "fileNameHash">;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function fileNameHash(fileName?: string): string {
  return sha256(fileName ?? "");
}

export function hasCompatibilityImpact(diagnostics: readonly { code: string }[]): boolean {
  return diagnostics.some((diagnostic) => /^KQA70[0-6]$/.test(diagnostic.code));
}

export function hashCompatibilityFindings(diagnostics: readonly { code: string }[]): string {
  const findings = diagnostics
    .filter((diagnostic) => /^KQA70[0-6]$/.test(diagnostic.code))
    .map((diagnostic) => JSON.stringify(diagnostic))
    .sort();
  return sha256(JSON.stringify(findings));
}

/** Sign the exact candidate, interview base, compatibility report, and tenant for a short-lived review. */
export function createQuestionnairePreviewToken(
  tenantId: string | null | undefined,
  bindings: Omit<QuestionnairePreviewBindings, "tenantId">,
): { previewToken: string; previewExpiresAt: string } | null {
  const secret = sessionSecret();
  if (!tenantId || !secret) return null;
  const exp = Math.floor(Date.now() / 1000) + 10 * 60;
  const claims: QuestionnairePreviewClaims = { v: 1, ...bindings, tenantId, exp };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`kqa-questionnaire-preview:v1:${payload}`).digest("base64url");
  return { previewToken: `${payload}.${signature}`, previewExpiresAt: new Date(exp * 1000).toISOString() };
}

export function verifyQuestionnairePreviewToken(
  token: unknown,
  bindings: QuestionnairePreviewVerificationBindings,
): { ok: true; claims: QuestionnairePreviewClaims } | { ok: false; code: QuestionnairePreviewFailure } {
  if (typeof token !== "string" || !token) return { ok: false, code: "preview_required" };
  if (token.length > 2048) return { ok: false, code: "invalid_preview" };
  const [payload, signature, extra] = token.split(".");
  const secret = sessionSecret();
  if (!payload || !signature || extra !== undefined || !secret) return { ok: false, code: "invalid_preview" };
  const actualBytes = Buffer.from(signature);
  const expectedSignatures = [
    createHmac("sha256", secret).update(`kqa-questionnaire-preview:v1:${payload}`).digest("base64url"),
    // Preserve previews minted by the earlier MCP-only flow until their 10-minute TTL expires.
    createHmac("sha256", secret).update(`kqa-mcp-questionnaire-preview:v1:${payload}`).digest("base64url"),
  ];
  const signatureValid = expectedSignatures.some((expectedSignature) => {
    const expectedBytes = Buffer.from(expectedSignature);
    return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
  });
  if (!signatureValid) {
    return { ok: false, code: "invalid_preview" };
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<QuestionnairePreviewClaims>;
    if (
      claims.v !== 1 || typeof claims.tenantId !== "string" || typeof claims.interviewId !== "string" ||
      typeof claims.expectedVersion !== "number" || !Number.isInteger(claims.expectedVersion) ||
      typeof claims.baseHash !== "string" || typeof claims.candidateHash !== "string" ||
      typeof claims.fileNameHash !== "string" || typeof claims.compatibilityHash !== "string" ||
      typeof claims.exp !== "number" || !Number.isInteger(claims.exp)
    ) return { ok: false, code: "invalid_preview" };
    if (claims.exp <= Math.floor(Date.now() / 1000)) return { ok: false, code: "preview_expired" };
    const parsed = claims as QuestionnairePreviewClaims;
    if (
      parsed.tenantId !== bindings.tenantId || parsed.interviewId !== bindings.interviewId ||
      parsed.expectedVersion !== bindings.expectedVersion || parsed.baseHash !== bindings.baseHash ||
      parsed.candidateHash !== bindings.candidateHash || parsed.fileNameHash !== bindings.fileNameHash
    ) return { ok: false, code: "invalid_preview" };
    return { ok: true, claims: parsed };
  } catch {
    return { ok: false, code: "invalid_preview" };
  }
}
