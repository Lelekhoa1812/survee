import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fileNameHash, hashCompatibilityFindings, hasCompatibilityImpact, sha256, createQuestionnairePreviewToken, verifyQuestionnairePreviewToken } from "../src/lib/questionnaire-preview";
import { sessionSecret } from "../src/lib/env";

const bindings = {
  tenantId: "tenant-1",
  interviewId: "interview-1",
  expectedVersion: 2,
  baseHash: "a".repeat(64),
  candidateHash: "b".repeat(64),
  fileNameHash: fileNameHash("survey.html"),
  compatibilityHash: hashCompatibilityFindings([]),
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("questionnaire preview tokens", () => {
  it("signs the reviewed candidate and accepts its exact bindings", () => {
    const signed = createQuestionnairePreviewToken(bindings.tenantId, {
      interviewId: bindings.interviewId,
      expectedVersion: bindings.expectedVersion,
      baseHash: bindings.baseHash,
      candidateHash: bindings.candidateHash,
      fileNameHash: bindings.fileNameHash,
      compatibilityHash: bindings.compatibilityHash,
    });

    expect(signed).not.toBeNull();
    expect(verifyQuestionnairePreviewToken(signed?.previewToken, bindings)).toMatchObject({ ok: true, claims: bindings });
    expect(signed?.previewExpiresAt).toBe(new Date(Math.floor(Date.now() / 1000) * 1000 + 10 * 60 * 1000).toISOString());
  });

  it("rejects altered signatures and mismatched tenant, interview, version, base, candidate, or file name", () => {
    const signed = createQuestionnairePreviewToken(bindings.tenantId, {
      interviewId: bindings.interviewId,
      expectedVersion: bindings.expectedVersion,
      baseHash: bindings.baseHash,
      candidateHash: bindings.candidateHash,
      fileNameHash: bindings.fileNameHash,
      compatibilityHash: bindings.compatibilityHash,
    });
    expect(signed).not.toBeNull();
    const token = signed!.previewToken;
    expect(verifyQuestionnairePreviewToken(`${token.split(".")[0]}.invalid`, bindings)).toEqual({ ok: false, code: "invalid_preview" });
    for (const changed of [
      { ...bindings, tenantId: "tenant-2" },
      { ...bindings, interviewId: "interview-2" },
      { ...bindings, expectedVersion: 3 },
      { ...bindings, baseHash: "c".repeat(64) },
      { ...bindings, candidateHash: "d".repeat(64) },
      { ...bindings, fileNameHash: fileNameHash("renamed.html") },
    ]) {
      expect(verifyQuestionnairePreviewToken(token, changed)).toEqual({ ok: false, code: "invalid_preview" });
    }
  });

  it("expires after ten minutes and rejects missing tokens distinctly", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-15T00:00:00.000Z"));
    const signed = createQuestionnairePreviewToken(bindings.tenantId, {
      interviewId: bindings.interviewId,
      expectedVersion: bindings.expectedVersion,
      baseHash: bindings.baseHash,
      candidateHash: bindings.candidateHash,
      fileNameHash: bindings.fileNameHash,
      compatibilityHash: bindings.compatibilityHash,
    });
    expect(verifyQuestionnairePreviewToken(undefined, bindings)).toEqual({ ok: false, code: "preview_required" });
    vi.setSystemTime(new Date("2026-11-15T00:10:00.000Z"));
    expect(verifyQuestionnairePreviewToken(signed?.previewToken, bindings)).toEqual({ ok: false, code: "preview_expired" });
  });

  it("accepts an earlier MCP preview signature while its token remains valid", () => {
    const secret = sessionSecret();
    expect(secret).toBeTruthy();
    const claims = {
      v: 1,
      ...bindings,
      exp: Math.floor(Date.now() / 1000) + 600,
    };
    const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
    const signature = createHmac("sha256", secret!).update(`kqa-mcp-questionnaire-preview:v1:${payload}`).digest("base64url");
    expect(verifyQuestionnairePreviewToken(`${payload}.${signature}`, bindings)).toMatchObject({ ok: true, claims });
  });

  it("hashes only compatibility findings and detects answer-mapping impact", () => {
    const findings: { code: string; message: string }[] = [
      { code: "KQA700", message: "One" },
      { code: "KQA709", message: "Repeat row contract changed" },
      { code: "KQA001", message: "Static checker detail" },
    ];
    const changedFinding: { code: string; message: string }[] = [{ code: "KQA700", message: "Changed" }];
    expect(hasCompatibilityImpact(findings)).toBe(true);
    expect(hasCompatibilityImpact(["KQA707", "KQA708", "KQA709", "KQA710"].map((code) => ({ code })))).toBe(true);
    expect(hasCompatibilityImpact([{ code: "KQA999" }])).toBe(false);
    expect(hashCompatibilityFindings(findings)).toBe(hashCompatibilityFindings([...findings].reverse()));
    expect(hashCompatibilityFindings(findings)).not.toBe(hashCompatibilityFindings(changedFinding));
    expect(sha256("candidate")).toMatch(/^[0-9a-f]{64}$/);
  });
});
