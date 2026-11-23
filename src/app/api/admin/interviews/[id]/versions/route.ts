import { fail, guardAdmin, json, readJson, str, adminSession, withServerErrors } from "@/lib/http";
import { getInterview, getVersion, publishVersionIfCurrent } from "@/lib/repo";
import { prepareSurvey, withCompat } from "@/lib/survey";
import { LIMITS } from "@/lib/format/schema";
import { summarizeQuestionChanges, summarizeSectionChanges } from "@/lib/survey-changes";
import {
  createQuestionnairePreviewToken,
  fileNameHash,
  hashCompatibilityFindings,
  hasCompatibilityImpact,
  sha256,
  verifyQuestionnairePreviewToken,
} from "@/lib/questionnaire-preview";

type Ctx = { params: Promise<{ id: string }> };
type VersionBody = {
  action?: unknown;
  html?: unknown;
  fileName?: unknown;
  expectedVersion?: unknown;
  baseHash?: unknown;
  candidateHash?: unknown;
  compatibilityHash?: unknown;
  previewToken?: unknown;
  acknowledgeCompatibilityImpact?: unknown;
};

function digest(value: unknown): string | null {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value) ? value : null;
}

function tokenError(code: "preview_required" | "preview_expired" | "invalid_preview") {
  if (code === "preview_required") return fail(400, "Preview this exact candidate before publishing it.", { code });
  if (code === "preview_expired") return fail(409, "This preview expired. Preview the candidate again before publishing it.", { code });
  return fail(400, "This preview does not match the current workspace, interview, or candidate. Preview again.", { code });
}

/** Preview and apply are deliberately separate. There is no one-call publish path. */
export const POST = withServerErrors("admin/interviews/[id]/versions", async function POST(req: Request, { params }: Ctx) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const { id } = await params;
  const body = await readJson<VersionBody>(req);
  if (!body.ok) return body.res;
  if (typeof body.data.html !== "string" || !body.data.html.trim()) return fail(400, "Upload the questionnaire file.");
  if (body.data.html.length > LIMITS.maxFileBytes) return fail(413, "That file is too large.");
  const action = str(body.data.action, 16);
  if (action !== "preview" && action !== "apply") {
    return fail(400, "Choose preview or apply. Publishing requires a reviewed preview.");
  }
  if (action === "apply") {
    const adminDenied = await guardAdmin({ roles: ["owner", "admin"] });
    if (adminDenied) return adminDenied;
  }
  const fileName = str(body.data.fileName, 200);

  try {
    const interview = await getInterview(id);
    if (!interview) return fail(404, "Interview not found.");

    if (action === "preview") {
      const current = await getVersion(interview._id, interview.currentVersion);
      if (!current) return fail(404, "Current survey version not found.");
      const prepared = await withCompat(prepareSurvey(body.data.html, fileName), id);
      if (!prepared.survey || !prepared.report.ok) {
        return json({
          ok: false,
          error: "The candidate did not pass the checker.",
          staticValid: false,
          diagnostics: prepared.report.diagnostics,
          counts: prepared.report.counts,
          report: prepared.markdown,
        }, 422);
      }

      const candidateHash = sha256(prepared.survey.html);
      const questionChanges = summarizeQuestionChanges(current.manifest.questions, prepared.survey.manifest.questions);
      const sectionChanges = summarizeSectionChanges(current.manifest.sections ?? [], prepared.survey.manifest.sections ?? []);
      const compatibilityHash = hashCompatibilityFindings(prepared.report.diagnostics);
      const signed = createQuestionnairePreviewToken(session.tenantId, {
        interviewId: id,
        expectedVersion: interview.currentVersion,
        baseHash: current.htmlSha256,
        candidateHash,
        fileNameHash: fileNameHash(fileName),
        compatibilityHash,
      });
      if (!signed) return fail(503, "Secure questionnaire previews are not available on this server.");

      return json({
        ok: true,
        staticValid: true,
        interviewId: id,
        currentVersion: interview.currentVersion,
        baseHash: current.htmlSha256,
        candidateHash,
        compatibilityHash,
        compatibilityImpact: hasCompatibilityImpact(prepared.report.diagnostics),
        ...signed,
        diagnostics: prepared.report.diagnostics,
        counts: prepared.report.counts,
        report: prepared.markdown,
        changes: {
          questionCountBefore: current.manifest.questions.length,
          questionCountAfter: prepared.survey.manifest.questions.length,
          questionChanges,
          // The candidate preview frame needs the complete definitions to render options and controls.
          questionsAfter: prepared.survey.manifest.questions,
          sectionsBefore: current.manifest.sections ?? [],
          sectionsAfter: prepared.survey.manifest.sections ?? [],
          sectionChanges,
        },
      });
    }

    const expectedVersion = body.data.expectedVersion;
    const baseHash = digest(body.data.baseHash);
    const candidateHash = digest(body.data.candidateHash);
    const compatibilityHash = digest(body.data.compatibilityHash);
    if (!Number.isInteger(expectedVersion) || (expectedVersion as number) < 1 || !baseHash || !candidateHash || !compatibilityHash) {
      return fail(400, "Apply requires the version and hashes returned by the preview.", { code: "preview_required" });
    }
    const preview = verifyQuestionnairePreviewToken(body.data.previewToken, {
      tenantId: session.tenantId,
      interviewId: id,
      expectedVersion: expectedVersion as number,
      baseHash,
      candidateHash,
      fileNameHash: fileNameHash(fileName),
    });
    if (!preview.ok) return tokenError(preview.code);

    const current = await getVersion(interview._id, expectedVersion as number);
    if (interview.currentVersion !== expectedVersion || !current || current.htmlSha256 !== baseHash) {
      return fail(409, "The questionnaire changed since preview. Review a new preview before publishing.", { code: "stale_preview" });
    }
    const prepared = await withCompat(prepareSurvey(body.data.html, fileName), id);
    if (!prepared.survey || !prepared.report.ok) {
      return json({
        ok: false,
        error: "The candidate did not pass the checker.",
        code: "checker",
        diagnostics: prepared.report.diagnostics,
        report: prepared.markdown,
      }, 422);
    }
    if (sha256(prepared.survey.html) !== candidateHash || candidateHash !== preview.claims.candidateHash) {
      return fail(409, "The candidate changed since preview. Preview it again before publishing.", { code: "candidate_changed" });
    }
    const currentCompatibilityHash = hashCompatibilityFindings(prepared.report.diagnostics);
    if (currentCompatibilityHash !== compatibilityHash || currentCompatibilityHash !== preview.claims.compatibilityHash) {
      return fail(409, "Compatibility findings changed since preview. Review a new preview before publishing.", { code: "stale_preview" });
    }
    const compatibilityImpact = hasCompatibilityImpact(prepared.report.diagnostics);
    if (compatibilityImpact && body.data.acknowledgeCompatibilityImpact !== true) {
      return json({
        ok: false,
        error: "Compatibility impact must be acknowledged before publishing.",
        code: "acknowledgement_required",
        compatibilityHash: currentCompatibilityHash,
        diagnostics: prepared.report.diagnostics,
      }, 409);
    }

    const published = await publishVersionIfCurrent(id, expectedVersion as number, baseHash, prepared.survey, "host_patch");
    if (!published) return fail(404, "Interview not found.");
    if ("assetUnavailable" in published) return fail(409, "A referenced workspace image is missing or unavailable. Upload it again or remove its URL, then preview the candidate again.", { code: "asset_unavailable" });
    if ("conflict" in published) return fail(409, "Another change was published first. Preview the candidate again.", { code: "stale_preview" });
    return json({
      ok: true,
      version: published.version,
      previousVersion: expectedVersion,
      interviewId: id,
      candidateHash,
      compatibilityImpact,
      report: { ok: true, counts: prepared.report.counts, diagnostics: prepared.report.diagnostics },
    }, 201);
  } catch {
    return fail(503, action === "preview" ? "The questionnaire preview could not be completed." : "The new questionnaire version could not be published.");
  }
});
