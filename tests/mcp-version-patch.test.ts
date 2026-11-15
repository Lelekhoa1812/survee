import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  currentVersion: 2,
  baseHash: "a".repeat(64),
  compatibilityImpact: false,
  invalid: false,
  publish: vi.fn(async () => ({ version: 3 })),
}));

const interviewId = new ObjectId().toHexString();

vi.mock("../src/lib/repo", async () => {
  const actual = await vi.importActual<typeof import("../src/lib/repo")>("../src/lib/repo");
  return {
    ...actual,
    getInterview: vi.fn(async () => ({
      _id: new ObjectId(interviewId), name: "Interview", mode: "multi", status: "open",
      currentVersion: state.currentVersion, createdAt: new Date(), updatedAt: new Date(),
    })),
    getVersion: vi.fn(async (_id: ObjectId, version: number) => version === state.currentVersion ? ({
      version, htmlSha256: state.baseHash, html: "old html", manifest: { format: "kqa/1", title: "Old", questions: [{ id: "q1", type: "text", label: "Old" }] },
    }) : null),
    publishVersionIfCurrent: state.publish,
  };
});

vi.mock("../src/lib/survey", () => ({
  prepareSurvey: (html: string) => {
    const manifest = { format: "kqa/1", title: "Candidate", questions: [{ id: "q1", type: "text", label: "New" }] };
    const diagnostics = state.invalid ? [{ code: "KQA001", severity: "error", category: "format", title: "Invalid", message: "Invalid candidate", fix: "Fix it" }] : [];
    const report = { ok: !state.invalid, diagnostics, counts: { error: state.invalid ? 1 : 0, warning: 0, info: 0 }, manifest };
    return { report, markdown: "checker report", survey: state.invalid ? undefined : { html: html.replace(/^\uFEFF/, ""), manifest, check: { errors: 0, warnings: 0, info: 0, checkedAt: "now", checkerVersion: "test" } } };
  },
  withCompat: async (prepared: { report: { diagnostics: { code: string }[] } }) => {
    if (state.compatibilityImpact) prepared.report.diagnostics.push({ code: "KQA700" });
    return prepared;
  },
}));

import { dispatchTool } from "../src/lib/mcp/tools";

const candidate = "<html><body>candidate</body></html>";
const hash = (html: string) => createHash("sha256").update(html).digest("hex");

beforeEach(() => {
  state.currentVersion = 2;
  state.baseHash = "a".repeat(64);
  state.compatibilityImpact = false;
  state.invalid = false;
  state.publish.mockClear();
  state.publish.mockResolvedValue({ version: 3 });
});

describe("MCP questionnaire version patch", () => {
  it("previews without publishing and returns hashes and diagnostics", async () => {
    const result = await dispatchTool("preview_questionnaire_version_patch", { interviewId, html: candidate });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ currentVersion: 2, baseHash: state.baseHash, candidateHash: hash(candidate), staticValid: true });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("requires explicit acknowledgement for compatibility findings", async () => {
    state.compatibilityImpact = true;
    const preview = await dispatchTool("preview_questionnaire_version_patch", { interviewId, html: candidate });
    const result = await dispatchTool("apply_questionnaire_version_patch", {
      interviewId, html: candidate, expectedVersion: 2, baseHash: state.baseHash,
      candidateHash: hash(candidate), compatibilityHash: preview.structuredContent.compatibilityHash as string,
    });
    expect(result.isError).toBe(true);
    expect(result.structuredContent.code).toBe("acknowledgement_required");
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("rejects stale previews, altered candidates, and static errors", async () => {
    const stale = await dispatchTool("apply_questionnaire_version_patch", {
      interviewId, html: candidate, expectedVersion: 1, baseHash: state.baseHash, candidateHash: hash(candidate),
    });
    expect(stale.structuredContent.code).toBe("stale_preview");
    const altered = await dispatchTool("apply_questionnaire_version_patch", {
      interviewId, html: candidate, expectedVersion: 2, baseHash: state.baseHash, candidateHash: "b".repeat(64),
    });
    expect(altered.structuredContent.code).toBe("candidate_changed");
    state.invalid = true;
    const invalid = await dispatchTool("apply_questionnaire_version_patch", {
      interviewId, html: candidate, expectedVersion: 2, baseHash: state.baseHash, candidateHash: hash(candidate),
    });
    expect(invalid.structuredContent.code).toBe("checker");
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("publishes only the server-checked candidate using optimistic version and base-hash checks", async () => {
    state.compatibilityImpact = true;
    const preview = await dispatchTool("preview_questionnaire_version_patch", { interviewId, html: candidate });
    const result = await dispatchTool("apply_questionnaire_version_patch", {
      interviewId, html: candidate, expectedVersion: 2, baseHash: state.baseHash,
      candidateHash: hash(candidate), compatibilityHash: preview.structuredContent.compatibilityHash as string,
      acknowledgeCompatibilityImpact: true,
    });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ ok: true, version: 3, previousVersion: 2 });
    expect(state.publish).toHaveBeenCalledWith(interviewId, 2, state.baseHash, expect.objectContaining({ html: candidate }));
  });

  it("requires the compatibility findings to match the reviewed preview", async () => {
    state.compatibilityImpact = true;
    const preview = await dispatchTool("preview_questionnaire_version_patch", { interviewId, html: candidate });
    state.compatibilityImpact = false;
    const result = await dispatchTool("apply_questionnaire_version_patch", {
      interviewId, html: candidate, expectedVersion: 2, baseHash: state.baseHash,
      candidateHash: hash(candidate), compatibilityHash: preview.structuredContent.compatibilityHash as string,
      acknowledgeCompatibilityImpact: true,
    });
    expect(result.structuredContent.code).toBe("stale_preview");
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("keeps legacy uploads one-call for compatible changes while using optimistic checks", async () => {
    const result = await dispatchTool("upload_survey_version", { interviewId, html: candidate });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ ok: true, version: 3, previousVersion: 2, compatibilityImpact: false });
    expect(state.publish).toHaveBeenCalledWith(interviewId, 2, state.baseHash, expect.objectContaining({ html: candidate }), "mcp_upload");
  });

  it("returns a non-mutating preview when legacy upload finds answer compatibility impact", async () => {
    state.compatibilityImpact = true;
    const result = await dispatchTool("upload_survey_version", { interviewId, html: candidate });
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      code: "acknowledgement_required",
      currentVersion: 2,
      baseHash: state.baseHash,
      candidateHash: hash(candidate),
      compatibilityHash: expect.any(String),
      compatibilityImpact: true,
    });
    expect(state.publish).not.toHaveBeenCalled();
  });

  it("requires the reviewed hashes and acknowledgement before legacy upload publishes an impacted candidate", async () => {
    state.compatibilityImpact = true;
    const incomplete = await dispatchTool("upload_survey_version", {
      interviewId, html: candidate, acknowledgeCompatibilityImpact: true,
    });
    expect(incomplete.structuredContent.code).toBe("preview_required");
    expect(state.publish).not.toHaveBeenCalled();

    const preview = await dispatchTool("upload_survey_version", { interviewId, html: candidate, acknowledgeCompatibilityImpact: false });
    expect(preview.structuredContent.code).toBe("acknowledgement_required");
    const compatibilityHash = preview.structuredContent.compatibilityHash as string;

    const published = await dispatchTool("upload_survey_version", {
      interviewId, html: candidate, expectedVersion: 2, baseHash: state.baseHash,
      candidateHash: hash(candidate), compatibilityHash, acknowledgeCompatibilityImpact: true,
    });
    expect(published.isError).toBeFalsy();
    expect(published.structuredContent).toMatchObject({ ok: true, version: 3, previousVersion: 2, compatibilityImpact: true });
    expect(state.publish).toHaveBeenCalledWith(interviewId, 2, state.baseHash, expect.objectContaining({ html: candidate }), "mcp_upload");
  });

  it("rejects stale or altered legacy-upload previews", async () => {
    const stale = await dispatchTool("upload_survey_version", {
      interviewId, html: candidate, expectedVersion: 1, baseHash: state.baseHash,
      candidateHash: hash(candidate),
    });
    expect(stale.structuredContent.code).toBe("stale_preview");

    const altered = await dispatchTool("upload_survey_version", {
      interviewId, html: candidate, expectedVersion: 2, baseHash: state.baseHash,
      candidateHash: "b".repeat(64),
    });
    expect(altered.structuredContent.code).toBe("candidate_changed");
    expect(state.publish).not.toHaveBeenCalled();
  });
});
