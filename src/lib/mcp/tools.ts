import { displayValue, eligibilityQuestionIds, evaluateEligibility, progress } from "../format/answers";
import { LIMITS } from "../format/schema";
import { analyticsCohortForStatuses } from "../analytics/cohorts";
import { answerCrossTabError, answerSegmentationError, canCrossTabByAnswer, canSegmentByAnswer, summarizeAnswerCrossTab, summarizeAnswerSegments } from "../analytics/segments";
import { createQuestionSummaryAccumulator, summarizeSelectedQuestionCohort, withCurrentEligibility, type QuestionSummary } from "../analytics/summary";
import { getAnalyticsGuidance } from "../analytics/guidance";
import { readDoc } from "../docs";
import { getInterviewPackage, INTERVIEW_PACKAGES } from "../interview-packages";
import { getDesignGuidance, type DesignSurface } from "../design/guidance";
import { extractDesignProfile, type DesignProfileFormat, type DesignProfileSurface } from "../design/profile";
import { EXPORT_FORMATS, exportInterview, ExportOutputSizeLimitError, type ExportFormat } from "../export";
import { MAX_EXPORT_OUTPUT_BYTES, MAX_PEOPLE_PER_BATCH } from "../participant-limits";
import { parseEmail } from "../mail/address";
import { checkInviteDelivery } from "../mail/delivery";
import { sendInvite } from "../mail/invite";
import { inviteLink } from "../mail/policy";
import { currentMail } from "../mail/state";
import {
  addParticipants,
  createAnalyticsRun,
  createInterview,
  deleteInterview,
  deleteParticipant,
  getInterview,
  getInterviewParticipantCounts,
  getAnalyticsRun,
  getParticipant,
  getVersion,
  iterateAnalyticsParticipants,
  listInterviews,
  listParticipantPage,
  listParticipants,
  ParticipantCursorError,
  ParticipantExportSizeLimitError,
  ParticipantReadLimitError,
  listVersions,
  noteMcp,
  publishVersionIfCurrent,
  recentEvents,
  regenerateToken,
  reopenParticipant,
  promoteToMultiUser,
  saveQuestionnaireReviewDraft,
  updateInterview,
  updateParticipant,
} from "../repo";
import { listCurrentMailByParticipants, listMailByPerson, mailRecord } from "../repo/mail";
import { prepareSurvey, withCompat } from "../survey";
import type { Manifest } from "../format/schema";
import type { ParticipantView } from "../repo/types";
import { ObjectId } from "mongodb";
import {
  createQuestionnairePreviewToken,
  fileNameHash,
  hashCompatibilityFindings,
  hasCompatibilityImpact,
  sha256,
  verifyQuestionnairePreviewToken,
  type QuestionnairePreviewBindings,
  type QuestionnairePreviewFailure,
} from "../questionnaire-preview";
import { currentPrincipal } from "../tenant-context";
import { publicBaseUrl } from "../env";
import { summarizeQuestionChanges, summarizeSectionChanges } from "../survey-changes";
import { validateToolArgs } from "./validate";
import { canCallMcpTool, MCP_TOOL_CAPABILITIES, type McpCapability } from "./capabilities";
import { patchQuestionnaireBlocks, type QuestionnaireBlockOperation } from "./questionnaire-block-patch";
import { patchRequiredQuestions, type RequiredQuestionChange } from "./questionnaire-required-patch";
import { addImageAsset, deleteImageAsset, listImageAssets, renameImageAsset, inspectImage, ImageAssetQuotaError, WORKSPACE_IMAGE_QUOTA_BYTES } from "../repo/assets";
import { MAX_IMAGE_BASE64_CHARS } from "../image-assets";

export interface ToolResult {
  content: { type: "text"; text: string }[];
  structuredContent: Record<string, unknown>;
  isError?: boolean;
}

interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** A refusal that should win over the generic unknown-field error. */
  guard?: (args: Record<string, unknown>) => ToolResult | null;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
const str = { type: "string" };
const bool = { type: "boolean" };
const requiredChanges = {
  type: "array",
  minItems: 1,
  maxItems: 500,
  items: obj({ questionId: str, required: bool }, ["questionId", "required"]),
};
const questionnaireQuestion = obj({
  id: str,
  type: { type: "string", enum: ["single", "multi", "select", "rank", "text", "longtext", "number", "scale", "date"] },
  label: str,
  help: str,
  section: str,
  required: bool,
  options: { type: "array", minItems: 2, maxItems: 50, items: obj({ value: str, label: str }, ["value", "label"]) },
  // The custom MCP argument validator defers this union to the canonical question schema in the patcher.
  note: { anyOf: [
    { type: "boolean" },
    { type: "object", properties: { label: str, placeholder: str, maxLength: { type: "integer", minimum: 1, maximum: 5000 } }, additionalProperties: false },
  ] },
  min: { type: "number" },
  max: { type: "number" },
  step: { type: "number" },
  maxLength: { type: "integer", minimum: 1, maximum: 20000 },
  custom: bool,
}, ["id", "type", "label"]);
const questionnaireBlockOperations = {
  type: "array",
  minItems: 1,
  maxItems: LIMITS.maxQuestions,
  items: obj({
    op: { type: "string", enum: ["add", "update", "delete", "move"] },
    questionId: str,
    question: questionnaireQuestion,
    html: str,
    section: { anyOf: [str, { type: "null" }] },
    beforeQuestionId: str,
    afterQuestionId: str,
  }, ["op"]),
};

function ok(data: Record<string, unknown>, text?: string): ToolResult {
  return { content: [{ type: "text", text: text ?? JSON.stringify(data) }], structuredContent: data, isError: false };
}
function err(error: string, code?: string, details?: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: error }], structuredContent: { ok: false, error, ...(code ? { code } : {}), ...(details ?? {}) }, isError: true };
}
function asString(value: unknown, max = 500): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}
function oid(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

function decodeImageData(value: string): Buffer | null {
  const dataUri = /^data:image\/[a-z0-9.+-]+;base64,([A-Za-z0-9+/_=-]+)$/i.exec(value);
  const encoded = dataUri ? dataUri[1] : value;
  if (encoded.length > MAX_IMAGE_BASE64_CHARS || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(encoded)) return null;
  const normalized = encoded.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const data = Buffer.from(normalized, "base64");
  return data.toString("base64").replace(/=+$/, "") === normalized ? data : null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

type AnalyticsPageRow = { id: string; [key: string]: unknown };
type AnalyticsSegmentPage = {
  questions: AnalyticsPageRow[];
  statusCohorts?: { status: string; participantCount: number; questions: AnalyticsPageRow[] }[];
  [key: string]: unknown;
};
type AnalyticsRunPayload = Record<string, unknown> & {
  questionCount: number;
  questions?: AnalyticsPageRow[];
  outcomes?: AnalyticsPageRow[];
  segments?: AnalyticsSegmentPage[];
};

function pageAnalyticsRunResult(
  result: AnalyticsRunPayload,
  offset: number,
  limit: number,
  runId: string,
  expiresAt: string,
): Record<string, unknown> {
  const questionCount = result.questionCount;
  const end = Math.min(offset + limit, questionCount);
  const paged: Record<string, unknown> = {
    ...result,
    offset,
    limit,
    nextOffset: end < questionCount ? end : null,
    analysisRunId: runId,
    analysisRunExpiresAt: expiresAt,
  };
  if (result.questions) paged.questions = result.questions.slice(offset, end);
  if (result.outcomes) paged.outcomes = result.outcomes.slice(offset, end);
  if (result.segments) {
    paged.segments = result.segments.map((segment) => ({
      ...segment,
      questions: segment.questions.slice(offset, end),
      ...(segment.statusCohorts ? {
        statusCohorts: segment.statusCohorts.map((cohort) => ({
          ...cohort,
          questions: cohort.questions.slice(offset, end),
        })),
      } : {}),
    }));
  }
  return paged;
}

function questionList(manifest: Manifest) {
  return manifest.questions.map((q) => ({ id: q.id, type: q.type, label: q.label, required: !!q.required, section: q.section ?? null }));
}

function createPatchPreviewToken(bindings: Omit<QuestionnairePreviewBindings, "tenantId">) {
  return createQuestionnairePreviewToken(currentPrincipal()?.tenantId, bindings);
}

async function createQuestionnaireReviewLink(input: {
  interviewId: string;
  expectedVersion: number;
  candidateHash: string;
  fileName?: string;
  html: string;
  questions: NonNullable<Manifest["questions"]>;
  previewExpiresAt: string;
}) {
  const tenantId = currentPrincipal()?.tenantId;
  if (!tenantId) return { available: false as const };
  try {
    const stored = await saveQuestionnaireReviewDraft({
      tenantId,
      interviewId: input.interviewId,
      expectedVersion: input.expectedVersion,
      candidateHash: input.candidateHash,
      fileName: input.fileName,
      html: input.html,
      questions: input.questions,
      expiresAt: new Date(input.previewExpiresAt),
    });
    if (!stored.available) return { available: false as const, reason: stored.reason };
    const path = `/admin/previews/${stored.reviewId}`;
    const base = publicBaseUrl();
    return { available: true as const, url: base.ok ? new URL(path, base.origin).toString() : path, expiresAt: stored.expiresAt };
  } catch {
    // Keep the signed MCP preview usable if optional browser-review storage is unavailable.
    return { available: false as const, reason: "storage_unavailable" as const };
  }
}

const verifyPatchPreviewToken = verifyQuestionnairePreviewToken;

function previewTokenError(code: QuestionnairePreviewFailure) {
  if (code === "preview_required") return err("This operation requires the signed previewToken returned by a questionnaire preview.", code);
  if (code === "preview_expired") return err("This questionnaire preview expired. Preview the candidate again before continuing.", code);
  return err("This questionnaire preview is invalid for the current tenant, interview, or candidate. Preview again before continuing.", code);
}

function shapePerson(person: ParticipantView, manifest: Manifest | null, rows: ReturnType<typeof mailRecord>[]) {
  const mail = currentMail(person, rows);
  const link = inviteLink(person.token);
  const pr = manifest ? progress(manifest, person.answers, person.recordGroups) : null;
  return {
    id: person.id,
    interviewId: person.interviewId,
    name: person.name,
    email: person.email ?? null,
    note: person.note ?? null,
    status: person.status,
    link: link.ok ? link.link : null,
    answered: pr?.answered ?? 0,
    total: pr?.total ?? 0,
    requiredMissing: pr?.missingRequired.length ?? 0,
    lastSavedAt: person.lastSavedAt ?? null,
    submittedAt: person.submittedAt ?? null,
    mail: {
      state: mail.state,
      sentAt: mail.sentAt ?? null,
      error: mail.error ?? null,
      delivery: mail.state === "sent" ? mail.delivery : "unknown",
      deliveryCheckedAt: mail.deliveryCheckedAt ?? null,
      detail: mail.deliveryDetail ?? null,
    },
  };
}

async function loadPeoplePage(interviewId: string, cursor: string | null = null, limit = 50) {
  const interview = await getInterview(interviewId);
  if (!interview) return null;
  const version = await getVersion(interview._id, interview.currentVersion);
  const page = await listParticipantPage(interviewId, cursor, limit);
  const mail = await listCurrentMailByParticipants(interview._id, page.people);
  const grouped = new Map<string, ReturnType<typeof mailRecord>[]>();
  for (const row of mail) {
    const id = row.token;
    grouped.set(id, [...(grouped.get(id) ?? []), mailRecord(row)]);
  }
  return { interview, version, people: page.people.map((person) => shapePerson(person, version?.manifest ?? null, grouped.get(person.token) ?? [])), nextCursor: page.nextCursor };
}

async function onePerson(personId: string) {
  const person = await getParticipant(personId);
  if (!person) return null;
  const interview = await getInterview(person.interviewId);
  const version = interview ? await getVersion(interview._id, interview.currentVersion) : null;
  const id = oid(person.id);
  const rows = id ? (await listMailByPerson(id)).map(mailRecord) : [];
  return { person, interview, version, view: shapePerson(person, version?.manifest ?? null, rows) };
}

const TOOLS: ToolDef[] = [
  {
    name: "get_interview_packages",
    description: "Return survee's versioned package catalog, structured fit metadata, and safeguards. Set catalogOnly to true for a compact metadata-only catalog; otherwise omit packageId for the full library or select a stable packageId for focused guidance. Use decision, audience, and risk boundaries to choose; when fit is ambiguous, clarify rather than inventing a score. These are self-completed questionnaire aids, not validated instruments or automated decisions.",
    inputSchema: obj({ packageId: { type: "string", enum: INTERVIEW_PACKAGES.map((item) => item.id) }, catalogOnly: bool }),
    async run(args) {
      if (args.catalogOnly === true && args.packageId !== undefined) return err("catalogOnly cannot be combined with packageId.", "invalid_args");
      const pack = await getInterviewPackage(args.packageId as (typeof INTERVIEW_PACKAGES)[number]["id"] | undefined, { catalogOnly: args.catalogOnly === true });
      return pack ? ok({ source: "docs/INTERVIEW_PACKAGES.md", ...pack }) : err("The interview package guide is unavailable.", "docs_unavailable");
    },
  },
  {
    name: "get_questionnaire_authoring_skill",
    description: "Return an installable survee Agent Skill bundle with SKILL.md, version-matched references, a starter questionnaire, routing and repeat examples, illustrative package-based questionnaire examples, and package-fit, repeat-pattern, interaction-pattern, content-review, and tool-safety evaluation guides with their development cases and schemas. Preserve the supplied relative paths when installing; examples and public development cases are not validated instruments or held-out evidence, and this bundle is workflow guidance rather than human review.",
    inputSchema: obj({}),
    async run() {
      const skill = await readDoc("kqa-questionnaire-author/SKILL.md");
      if (!skill) return err("The questionnaire authoring skill is unavailable.", "docs_unavailable");
      const referenceNames = ["FORMAT.md", "AGENT_PLAYBOOK.md", "DESIGN_SYSTEM.md", "INTERVIEW_PACKAGES.md", "QUESTION_BLUEPRINT.md", "REPEATABLE_RECORDS_DESIGN.md", "MCP.md", "QUESTIONNAIRE_AUTHORING_BENCHMARK.md", "questionnaire-authoring-cases.json", "PACKAGE_SELECTION_BENCHMARK.md", "package-selection-cases.json", "package-selection.schema.json", "REPEATABLE_RECORD_SELECTION_BENCHMARK.md", "repeatable-record-selection-cases.json", "repeatable-record-selection.schema.json", "INTERACTION_PATTERN_SELECTION_BENCHMARK.md", "interaction-pattern-selection-cases.json", "interaction-pattern-selection.schema.json", "eval-interaction-pattern-selection.mjs", "PACKAGE_DRAFT_BENCHMARK.md", "package-draft-cases.json", "package-draft-results.schema.json", "AUTHORING_TRUST_BOUNDARY_EVAL.md", "AUTHORING_TRUST_BOUNDARY_CASES.json", "starter.kqa.html", "conditional-follow-up.kqa.html", "routed-follow-up.kqa.html", "repeated-assets.kqa.html", "service-improvement.kqa.html", "service-improvement.review.md", "industrial-operations.kqa.html", "industrial-operations.review.md", "personal-planning.kqa.html", "personal-planning.review.md", "question-order-variation.kqa.html"];
      const references = await Promise.all(referenceNames.map(async (name) => ({ path: `references/${name}`, content: await readDoc(`kqa-questionnaire-author/references/${name}`) })));
      if (references.some((reference) => reference.content === null)) return err("The questionnaire authoring skill references are incomplete.", "docs_unavailable");
      return ok({ source: "docs/kqa-questionnaire-author/SKILL.md", skill, files: [{ path: "SKILL.md", content: skill }, ...references] });
    },
  },
  {
    name: "get_analytics_guidance",
    description: "Return deterministic, versioned guidance for interpreting survee summaries and generating accessible, traceable charts, with primary sources. survee does not run an LLM.",
    inputSchema: obj({}),
    async run() {
      return ok(getAnalyticsGuidance());
    },
  },
  {
    name: "get_design_guidance",
    description: "Return survee's sourced, versioned design principles, structured design plan, and surface-specific visual profile for questionnaires, the host console, or analytics. No LLM is built into survee.",
    inputSchema: obj({ surface: { type: "string", enum: ["all", "questionnaire", "host", "analytics"] } }),
    async run(args) {
      const surface = (asString(args.surface, 24) || "all") as DesignSurface;
      return ok(getDesignGuidance(surface));
    },
  },
  {
    name: "extract_design_profile",
    description: "Extract user-supplied CSS custom properties, legacy token JSON, or a bounded Design Tokens Format Module 2025.10 subset into survee semantic-role proposals. Reports unsupported $extends inheritance, resolver-file modes, external references, and ambiguous mappings; returns provenance, candidate contrast checks, and a reviewable overlay. Never fetches URLs, executes CSS, stores input, or applies changes.",
    inputSchema: obj({
      source: { type: "string", minLength: 1, maxLength: 32768 },
      format: { type: "string", enum: ["css", "json"] },
      surface: { type: "string", enum: ["host", "questionnaire", "analytics"] },
    }, ["source", "format"]),
    async run(args) {
      if (typeof args.source !== "string") return err("source is required.", "invalid_args");
      const surface = (asString(args.surface, 24) || "questionnaire") as DesignProfileSurface;
      const result = extractDesignProfile({
        source: args.source,
        format: args.format as DesignProfileFormat,
        surface,
      });
      return result.ok ? ok(result.profile) : err(result.error, result.code);
    },
  },
  {
    name: "audit_questionnaire_design",
    description: "Run survee's static questionnaire checker and return a review checklist for content, usability research, and rendered design. Wording and user testing require judgment; this tool does not render, observe users, or certify the page.",
    inputSchema: obj({ html: str, fileName: str, interviewId: str }, ["html"]),
    async run(args) {
      if (typeof args.html !== "string") return err("html is required.", "invalid_args");
      if (args.html.trim() === "") return err("html is empty. Send the questionnaire file contents.", "invalid_args");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.", "invalid_args");
      let prepared = prepareSurvey(args.html, asString(args.fileName, 200));
      const interviewId = asString(args.interviewId, 40);
      if (interviewId) prepared = await withCompat(prepared, interviewId);
      return ok({
        ok: prepared.report.ok,
        counts: prepared.report.counts,
        diagnostics: prepared.report.diagnostics,
        report: prepared.markdown,
        reviewChecklist: getDesignGuidance("questionnaire").reviewChecklist,
        limits: ["Static inspection cannot judge question wording or item pretesting, or determine whether representative users can complete realistic end-to-end tasks; those require research with relevant participants.", "It also cannot verify rendered contrast, responsive layout, keyboard operation, motion behavior, or assistive-technology announcements."],
      });
    },
  },
  {
    name: "list_interviews",
    description: "List the host's interviews with open/closed status and people counts.",
    inputSchema: obj({}),
    async run() {
      const interviews = await listInterviews();
      return ok({ interviews });
    },
  },
  {
    name: "list_image_assets",
    description: "List a page of workspace images available to questionnaires. Paste an asset URL into img src or CSS url(); asset count is not capped.",
    inputSchema: obj({ cursor: str, limit: { type: "integer", minimum: 1, maximum: 100 } }),
    async run(args) {
      if (args.cursor !== undefined && (typeof args.cursor !== "string" || !/^[0-9a-f]{24}$/i.test(args.cursor))) return err("cursor must be a valid image page cursor.");
      const limit = args.limit === undefined ? 30 : args.limit;
      if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 100) return err("limit must be an integer from 1 to 100.");
      return ok(await listImageAssets({ cursor: args.cursor as string | undefined, limit }));
    },
  },
  {
    name: "upload_image_asset",
    description: "Save a PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, or SVG image in the workspace image library. Send raw base64 or a base64 data URI; each image can be up to 2 MB and each workspace has 100 MiB total image storage. The returned URL can be used in questionnaire HTML as <img src> or in CSS url().",
    inputSchema: obj({ name: str, fileName: str, dataBase64: { type: "string", minLength: 1, maxLength: MAX_IMAGE_BASE64_CHARS + 64 } }, ["fileName", "dataBase64"]),
    async run(args) {
      if (typeof args.fileName !== "string" || !args.fileName.trim()) return err("fileName is required.");
      if (typeof args.dataBase64 !== "string") return err("dataBase64 is required.");
      const data = decodeImageData(args.dataBase64);
      if (!data) return err("dataBase64 must be valid base64 image data within the 2 MB size limit.");
      const checked = inspectImage(data);
      if (!checked.ok) return err(checked.error, "invalid_image");
      let asset;
      try {
        asset = await addImageAsset({ name: asString(args.name, 120), fileName: asString(args.fileName, 160) || "image", data });
      } catch (error) {
        if (error instanceof ImageAssetQuotaError) return err(`${error.message} ${error.usedBytes} of ${WORKSPACE_IMAGE_QUOTA_BYTES} bytes are in use.`, "workspace_image_quota_exceeded");
        throw error;
      }
      const alt = escapeHtml(asset.name);
      return ok({ asset, htmlExample: `<img src="${asset.url}" alt="${alt}">` });
    },
  },
  {
    name: "update_image_asset",
    description: "Rename a workspace image. Image bytes stay immutable so saved questionnaire versions keep rendering; upload a new image and publish a URL change to replace its contents.",
    inputSchema: obj({ assetId: str, name: str }, ["assetId", "name"]),
    async run(args) {
      const id = asString(args.assetId, 40);
      const name = asString(args.name, 120);
      if (!id || !name) return err("assetId and name are required.");
      const asset = await renameImageAsset(id, name);
      return asset ? ok({ asset }) : err("Image not found.", "not_found");
    },
  },
  {
    name: "delete_image_asset",
    description: "Permanently delete an unused workspace image. Pass confirmName exactly as returned by the image library. Deletion is blocked while a saved questionnaire or active preview references it.",
    inputSchema: obj({ assetId: str, confirmName: str }, ["assetId", "confirmName"]),
    async run(args) {
      const id = asString(args.assetId, 40);
      const confirmName = asString(args.confirmName, 120);
      if (!id || !confirmName) return err("assetId and confirmName are required.");
      const result = await deleteImageAsset(id, confirmName);
      if (result.ok) return ok({ ok: true, assetId: id });
      if (result.reason === "in_use") return err("This image is used by a saved questionnaire or active preview. Remove it there before deleting the image.", "asset_in_use");
      if (result.reason === "confirmation_mismatch") return err("confirmName must exactly match the image name.", "confirmation_mismatch");
      return err("Image not found.", "not_found");
    },
  },
  {
    name: "get_interview",
    description: "Read one interview and its current question list. HTML is omitted.",
    inputSchema: obj({ interviewId: str }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const version = await getVersion(interview._id, interview.currentVersion);
      return ok({
        id: interview._id.toHexString(),
        name: interview.name,
        description: interview.description ?? null,
        mode: interview.mode,
        status: interview.status,
        currentVersion: interview.currentVersion,
        questions: version ? questionList(version.manifest) : [],
      });
    },
  },
  {
    name: "get_survey_html",
    description: "Read a stored questionnaire file.",
    inputSchema: obj({ interviewId: str, version: { type: "integer", minimum: 1 } }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      let versionNo = interview.currentVersion;
      if (args.version !== undefined) {
        if (typeof args.version !== "number" || !Number.isInteger(args.version) || args.version < 1) return err("version must be an integer of at least 1.");
        versionNo = args.version;
      }
      const version = await getVersion(interview._id, versionNo);
      if (!version) return err("Survey version not found.", "not_found");
      return ok({ version: version.version, fileName: version.fileName ?? null, html: version.html, manifest: version.manifest });
    },
  },
  {
    name: "list_versions",
    description: "List uploaded questionnaire versions without the HTML.",
    inputSchema: obj({ interviewId: str }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const versions = await listVersions(interview._id);
      return ok({
        versions: versions.map((v) => ({ version: v.version, fileName: v.fileName ?? null, bytes: v.bytes, questions: v.manifest.questions.length, check: v.check, createdAt: v.createdAt.toISOString() })),
      });
    },
  },
  {
    name: "check_questionnaire",
    description: "Run the checker. Nothing is stored.",
    inputSchema: obj({ html: str, fileName: str, interviewId: str }, ["html"]),
    async run(args) {
      if (typeof args.html !== "string") return err("html is required.", "invalid_args");
      if (args.html.trim() === "") return err("html is empty. Send the questionnaire file contents.", "invalid_args");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.", "invalid_args");
      let prepared = prepareSurvey(args.html, asString(args.fileName, 200));
      const interviewId = asString(args.interviewId, 40);
      if (interviewId) prepared = await withCompat(prepared, interviewId);
      return ok({ ok: prepared.report.ok, markdown: prepared.markdown, counts: prepared.report.counts, diagnostics: prepared.report.diagnostics });
    },
  },
  {
    name: "list_people",
    description: "List one bounded page of people on an interview, including email, status, progress, mail state, and private link. Pass nextCursor back as cursor to continue; without a cursor this returns the newest page.",
    inputSchema: obj({ interviewId: str, cursor: str, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      if (args.cursor !== undefined && (typeof args.cursor !== "string" || args.cursor.length > 256)) return err("cursor must be a valid nextCursor value returned by list_people.", "invalid_args");
      const cursor = args.cursor === undefined ? null : args.cursor.trim() || null;
      if (args.cursor !== undefined && !cursor) return err("cursor must be the nextCursor value returned by list_people.", "invalid_args");
      if (args.limit !== undefined && (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) return err("limit must be an integer from 1 to 100.", "invalid_args");
      let loaded;
      try {
        loaded = await loadPeoplePage(id, cursor, typeof args.limit === "number" ? args.limit : 50);
      } catch (error) {
        if (error instanceof ParticipantCursorError) return err(error.message, "participant_cursor_invalid");
        throw error;
      }
      if (!loaded) return err("Interview not found.", "not_found");
      const counts = await getInterviewParticipantCounts(id);
      return ok({ people: loaded.people, nextCursor: loaded.nextCursor, counts });
    },
  },
  {
    name: "get_person",
    description: "Read one person, their private link, and their invite state.",
    inputSchema: obj({ personId: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const loaded = await onePerson(id);
      if (!loaded) return err("Person not found.", "not_found");
      return ok({ person: loaded.view });
    },
  },
  {
    name: "get_answers",
    description: "Read answers for review. Interview-wide reads return a bounded page (default 50, maximum 100); pass nextCursor back as cursor until it is null. Each answer's eligible flag is inferred from the current survey rules and saved answers, not historical display; retained inactive values and repeat records are still returned. display is the label a host sees. Repeat records are returned separately as recordGroups keyed by question ID, with ordered {id, values} rows when present; use the matching question's eligible flag. Assigned question-order groups are returned separately by survey version, including unanswered questions. There is no score.",
    inputSchema: obj({ interviewId: str, personId: str, submittedOnly: bool, cursor: str, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      if (args.cursor !== undefined && (typeof args.cursor !== "string" || args.cursor.length > 256)) return err("cursor must be a valid nextCursor value returned by get_answers.", "invalid_args");
      const cursor = args.cursor === undefined ? null : args.cursor.trim() || null;
      if (args.cursor !== undefined && !cursor) return err("cursor must be the nextCursor value returned by get_answers.", "invalid_args");
      if (args.limit !== undefined && (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) return err("limit must be an integer from 1 to 100.", "invalid_args");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const version = await getVersion(interview._id, interview.currentVersion);
      if (!version) return err("Survey version not found.", "not_found");
      const only = asString(args.personId, 40);
      let people;
      let nextCursor: string | null = null;
      if (only) {
        const person = await getParticipant(only);
        people = person?.interviewId === interview._id.toHexString() && (args.submittedOnly !== true || person.status === "submitted") ? [person] : [];
      } else {
        try {
          const page = await listParticipantPage(id, cursor, typeof args.limit === "number" ? args.limit : 50, args.submittedOnly === true);
          people = page.people;
          nextCursor = page.nextCursor;
        } catch (error) {
          if (error instanceof ParticipantCursorError) return err(error.message, "participant_cursor_invalid");
          throw error;
        }
      }
      const rows = people.map((p) => {
        const eligible = evaluateEligibility(version.manifest, p.answers, p.recordGroups);
        const recordGroups = Object.fromEntries(
          Object.entries(p.recordGroups ?? {})
            .filter(([, records]) => records.length > 0)
            .map(([questionId, records]) => [questionId, records.map(({ id: rowId, values }) => ({ id: rowId, values }))]),
        );
        return {
          id: p.id,
          name: p.name,
          status: p.status,
          submittedAt: p.submittedAt ?? null,
          answers: version.manifest.questions.map((q) => {
            const stored = p.answers[q.id];
            return { questionId: q.id, type: q.type, label: q.label, eligible: eligible[q.id], value: stored?.value ?? null, display: displayValue(q, stored?.value), note: stored?.note ?? null, updatedAt: stored?.updatedAt ?? null };
          }),
          ...(Object.keys(recordGroups).length ? { recordGroups } : {}),
          ...(p.questionOrderAssignments?.length ? { questionOrderAssignments: p.questionOrderAssignments } : {}),
        };
      });
      return ok({ interviewStatus: interview.status, people: rows, nextCursor });
    },
  },
  {
    name: "analyze_answers",
    description: "Compute descriptive current-version answer summaries for selected participant statuses, with explicit scope, denominators, missingness, and caveats. Repeat-group field values are excluded; rows are never counted as participants. Set compareStatuses to return per-status summaries from one shared scan. Set segmentBy to compare up to 20 selected outcomes across a closed categorical answer. Set crossTabWith with segmentBy to produce a bounded two-question count matrix with row denominators and checkbox overlap notes. For paginated results, reuse analysisRunId as runId with interviewId and offset/limit; completed aggregate pages remain stable for up to one hour. Initial scans are live rather than MongoDB snapshot reads; repeatable runs check the questionnaire and respondent-write revision before caching, and return `analysis_run_stale` if either changed during the scan. Returns no raw answer text and creates no score.",
    inputSchema: obj({
      interviewId: str,
      runId: str,
      questionId: str,
      questionIds: { type: "array", minItems: 1, maxItems: 20, uniqueItems: true, items: str },
      segmentBy: str,
      crossTabWith: str,
      submittedOnly: bool,
      statuses: { type: "array", items: { type: "string", enum: ["invited", "in_progress", "submitted"] } },
      compareStatuses: bool,
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      for (const key of ["questionId", "segmentBy", "crossTabWith"] as const) {
        const selector = args[key];
        if (selector !== undefined && (typeof selector !== "string" || !selector.trim() || selector.trim().length > 64)) {
          return err(`${key} must be a non-empty question ID of at most 64 characters.`, "invalid_args");
        }
      }
      if (args.runId !== undefined) {
        const runId = asString(args.runId, 40);
        if (!runId || !oid(runId)) return err("runId must be an analysisRunId returned by analyze_answers.");
        if (["questionId", "questionIds", "segmentBy", "crossTabWith", "submittedOnly", "statuses", "compareStatuses"].some((key) => args[key] !== undefined)) {
          return err("When continuing an analysis run, pass only interviewId, runId, offset, and limit.");
        }
        const offset = typeof args.offset === "number" ? args.offset : 0;
        const limit = typeof args.limit === "number" ? args.limit : 25;
        if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
          return err("offset must be a non-negative integer and limit must be an integer from 1 to 100.");
        }
        const interview = await getInterview(id);
        if (!interview) return err("Interview not found.", "not_found");
        const run = await getAnalyticsRun(runId, id);
        if (!run) return err("This analysis run expired or is no longer available. Start a new analysis with analyze_answers.", "analysis_run_expired");
        const payload = run.result as AnalyticsRunPayload;
        if (!payload || !Number.isInteger(payload.questionCount) || payload.questionCount < 0) {
          return err("This analysis run could not be read. Start a new analysis with analyze_answers.", "analysis_run_invalid");
        }
        return ok(pageAnalyticsRunResult(payload, offset, limit, runId, run.expiresAt.toISOString()));
      }
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const version = await getVersion(interview._id, interview.currentVersion);
      if (!version) return err("Survey version not found.", "not_found");
      // Repeated rows stay respondent-linked records and are not scalar outcomes or participants.
      // They remain available from get_answers and the normalized Records export.
      let questions = version.manifest.questions.filter((question) => question.type !== "repeat");
      const questionId = asString(args.questionId, 64);
      const requestedQuestionIds = args.questionIds;
      const segmentById = asString(args.segmentBy, 64);
      const crossTabWithId = asString(args.crossTabWith, 64);
      const segmentQuestion = segmentById ? questions.find((item) => item.id === segmentById) : undefined;
      if (segmentById && !segmentQuestion) return err("Segmentation question not found in the current survey version.", "not_found");
      if (segmentById && !canSegmentByAnswer(segmentQuestion)) return err(answerSegmentationError(segmentQuestion));
      if (args.crossTabWith !== undefined && !crossTabWithId) return err("crossTabWith must be a question ID.");
      if (crossTabWithId && !segmentById) return err("crossTabWith requires segmentBy to select the row question.");
      if (crossTabWithId && (questionId || requestedQuestionIds !== undefined)) return err("Use a two-question cross-tab without questionId or questionIds outcome summaries.");
      const crossTabQuestion = crossTabWithId ? questions.find((item) => item.id === crossTabWithId) : undefined;
      if (crossTabWithId && !crossTabQuestion) return err("Cross-tab column question not found in the current survey version.", "not_found");
      if (crossTabWithId && !canCrossTabByAnswer(segmentQuestion, crossTabQuestion)) return err(answerCrossTabError(segmentQuestion, crossTabQuestion));
      if (requestedQuestionIds !== undefined) {
        if (!segmentById) return err("questionIds can only be used with segmentBy.");
        if (questionId) return err("Use either questionId or questionIds, not both.");
        if (!Array.isArray(requestedQuestionIds) || requestedQuestionIds.length < 1 || requestedQuestionIds.length > 20) return err("questionIds must contain between 1 and 20 outcome question IDs.");
        const selectedIds = requestedQuestionIds.map((value) => typeof value === "string" ? value.trim() : "");
        if (selectedIds.some((value) => !value || value.length > 64)) return err("Each questionIds entry must be a non-empty question ID of at most 64 characters.", "invalid_args");
        if (new Set(selectedIds).size !== selectedIds.length) return err("questionIds must not contain duplicates.");
        if (selectedIds.includes(segmentById)) return err("Choose outcome questions other than the segmentation question.");
        const selectedQuestions = selectedIds.map((selectedId) => questions.find((item) => item.id === selectedId));
        if (selectedQuestions.some((item) => !item)) return err("An outcome question was not found in the current survey version.", "not_found");
        questions = selectedQuestions as typeof questions;
      }
      if (segmentById && questionId === segmentById) return err("Choose an outcome question other than the segmentation question.");
      if (questionId && requestedQuestionIds === undefined) {
        const question = questions.find((item) => item.id === questionId);
        if (!question) return err("Question not found in the current survey version.", "not_found");
        questions = [question];
      } else if (segmentById && requestedQuestionIds === undefined && !crossTabWithId) {
        questions = questions.filter((item) => item.id !== segmentById);
      }
      const allStatuses = ["invited", "in_progress", "submitted"] as const;
      const submittedOnly = args.submittedOnly === true;
      const requestedStatuses = Array.isArray(args.statuses) ? [...new Set(args.statuses)] as typeof allStatuses[number][] : undefined;
      if (requestedStatuses?.length === 0) return err("statuses must contain at least one status.");
      if (submittedOnly && requestedStatuses?.some((status) => status !== "submitted")) {
        return err("submittedOnly cannot be combined with non-submitted statuses.");
      }
      const statuses = requestedStatuses ?? (submittedOnly ? ["submitted"] : [...allStatuses]);
      const offset = typeof args.offset === "number" ? args.offset : 0;
      const limit = typeof args.limit === "number" ? args.limit : 25;
      if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
        return err("offset must be a non-negative integer and limit must be an integer from 1 to 100.");
      }
      if (crossTabWithId && offset !== 0) {
        return err("A cross-tab returns its complete bounded matrix; use offset 0.");
      }
      if (requestedQuestionIds !== undefined && (offset !== 0 || limit < questions.length)) {
        return err("questionIds returns every selected outcome in one scan; use offset 0 and a limit at least as large as the selected list.");
      }
      const page = questions.slice(offset, offset + limit);
      const createRun = offset + limit < questions.length;
      const analysisQuestions = createRun ? questions : page;
      const cohort = analyticsCohortForStatuses(statuses);
      if (!cohort) return err("statuses must contain at least one status.");
      const compareRequested = args.compareStatuses === true;
      if (segmentQuestion && crossTabWithId && crossTabQuestion) {
        const crossTab = await summarizeAnswerCrossTab(
          segmentQuestion,
          crossTabQuestion,
          withCurrentEligibility(version.manifest, iterateAnalyticsParticipants(id, eligibilityQuestionIds(version.manifest, [segmentQuestion.id, crossTabQuestion.id]), { statuses })),
          statuses,
        );
        return ok({
          interviewId: id,
          surveyVersion: version.version,
          asOf: crossTab.asOf,
          rowBy: { id: segmentQuestion.id, type: segmentQuestion.type, label: segmentQuestion.label },
          columnBy: { id: crossTabQuestion.id, type: crossTabQuestion.type, label: crossTabQuestion.label },
          scope: { statuses, participantCount: crossTab.participantCount, statusCounts: crossTab.statusCounts },
          rows: crossTab.rows,
          columns: crossTab.columns,
          cells: crossTab.cells,
          overlapping: crossTab.overlapping,
          methodology: [
            "This bounded cross-tab uses two closed categorical questions in the current survey version and only the participant statuses shown in scope. It is computed from one projected live scan; changes during the scan are not isolated by a database snapshot.",
            "Each cell counts distinct people for that answer pair. Row percentages use the row's participant count as denominator. If either question is a checkbox, people can appear in multiple rows or columns and counts and percentages can overlap or sum above 100%.",
            "No stored answer includes blank and note-only responses; it does not mean the person was eligible to see a routed question. Invalid stored values appear as Unmapped answer.",
            "No minimum group threshold is applied. Every valid answer pair, including zero-count cells, is returned; observed no-answer and unmapped groups are also included. disclosureRisk.singletonSegment flags cells with one person and singletonStatusGroups lists one-person status counts. These signals do not assess attribute combinations or guarantee anonymity.",
          ],
        });
      }
      if (segmentQuestion && canSegmentByAnswer(segmentQuestion)) {
        const segmented = await summarizeAnswerSegments(
          segmentQuestion,
          analysisQuestions,
          withCurrentEligibility(version.manifest, iterateAnalyticsParticipants(id, eligibilityQuestionIds(version.manifest, [segmentQuestion.id, ...analysisQuestions.map((question) => question.id)]), { statuses })),
          statuses,
          compareRequested,
        );
        const participantCount = statuses.reduce((count, status) => count + segmented.statusCounts[status], 0);
        const submittedCount = statuses.includes("submitted") ? segmented.statusCounts.submitted : 0;
        const fullResult: Record<string, unknown> = {
          interviewId: id,
          surveyVersion: version.version,
          asOf: segmented.asOf,
          segmentBy: { id: segmentQuestion.id, type: segmentQuestion.type, label: segmentQuestion.label },
          outcomes: analysisQuestions.map((question) => ({ id: question.id, type: question.type, label: question.label })),
          scope: {
            statuses,
            participantCount,
            respondentCount: participantCount,
            submittedCount,
            submittedOnly: statuses.length === 1 && statuses[0] === "submitted",
          },
          questionCount: questions.length,
          offset: createRun ? 0 : offset,
          limit: createRun ? questions.length : limit,
          nextOffset: createRun ? null : offset + page.length < questions.length ? offset + page.length : null,
          segments: segmented.segments.map((segment) => ({
            key: segment.key,
            kind: segment.kind,
            value: segment.value ?? null,
            label: segment.label,
            participantCount: segment.participantCount,
            disclosureRisk: segment.disclosureRisk,
            statusCounts: segment.statusCounts,
            questions: analysisQuestions.map((question) => ({ id: question.id, type: question.type, label: question.label, ...segment.summaries[question.id] })),
            ...(compareRequested ? {
              statusCohorts: statuses.map((status) => ({
                status,
                participantCount: segment.statusCounts[status],
                questions: analysisQuestions.map((question) => ({ id: question.id, type: question.type, label: question.label, ...segment.statusSummaries?.[status]?.[question.id] })),
              })),
            } : {}),
          })),
          methodology: [
            "Answer segments use the selected current-version question and only the participant statuses shown in scope. Outcome summaries exclude the segmentation question and use the same projected participant scan.",
            "Single-choice, dropdown, and scale answers place each person in one answer segment. Checkbox answers can place one person in several option segments; those segment counts and percentages overlap and must not be added together.",
            "No stored answer includes blank and note-only dimension responses; it does not mean the person was eligible to see a routed question. Invalid stored dimension values appear as Unmapped answer.",
            "No minimum group threshold is applied; every answer option is returned, including groups with one person or zero people. Each segment includes disclosureRisk.singletonSegment and, when status summaries are returned, disclosureRisk.singletonStatusGroups. Every outcome QuestionSummary also carries singleton signals for its cohort, answer, no-answer, note-only, unmapped, valid-answer denominator, distribution values, and numeric summaries. These signals only detect counts of one; they do not assess attribute combinations or guarantee anonymity. Outcome percentages use that segment's valid-answer denominator.",
            "This result is computed from one live participant scan; changes during the scan are not isolated by a database snapshot.",
            ...(compareRequested ? ["Status summaries for all selected answer segments share one participant scan and this asOf time."] : []),
            ...(createRun ? ["This completed aggregate run supports stable pagination for up to one hour. Pages share the same asOf and completed output; participant changes during the initial live scan were not isolated by a database snapshot."] : []),
          ],
        };
        if (createRun) {
          const stored = await createAnalyticsRun(id, version.version, fullResult, interview.respondentWriteRevision ?? 0);
          if (!stored) return err("Could not create an analysis run for this tenant and interview.");
          if (!stored.ok) return err(
            stored.reason === "stale"
              ? "Answers or the questionnaire changed while this analysis was running. Run the analysis again."
              : stored.reason === "too_large"
              ? "The aggregate result is too large to keep as a repeatable analysis run. Select up to 20 outcome questions with questionIds, or analyze fewer outcomes at a time."
              : "This tenant already has the maximum number of active analysis runs. Retry after an existing run expires.",
            stored.reason === "stale" ? "analysis_run_stale" : stored.reason === "too_large" ? "analysis_run_too_large" : "analysis_run_capacity",
          );
          return ok(pageAnalyticsRunResult(fullResult as AnalyticsRunPayload, offset, limit, stored.id, stored.expiresAt));
        }
        return ok(fullResult);
      }
      const statusCounts: Record<typeof allStatuses[number], number> = { invited: 0, in_progress: 0, submitted: 0 };
      const statusSummaries = {} as Record<typeof allStatuses[number], Record<string, QuestionSummary>>;
      let selectedSummaries: Record<string, QuestionSummary>;
      let asOf: string;
      if (compareRequested) {
        const cohortAnalysis = await summarizeSelectedQuestionCohort(
          analysisQuestions,
          withCurrentEligibility(version.manifest, iterateAnalyticsParticipants(id, eligibilityQuestionIds(version.manifest, analysisQuestions.map((question) => question.id)), { statuses })),
          statuses,
        );
        Object.assign(statusCounts, cohortAnalysis.statusCounts);
        selectedSummaries = cohortAnalysis.combined;
        for (const status of statuses) statusSummaries[status] = cohortAnalysis.statusSummaries[status]!;
        asOf = cohortAnalysis.asOf;
      } else {
        const accumulators = new Map(analysisQuestions.map((question) => [question.id, createQuestionSummaryAccumulator(question)]));
        for await (const respondent of withCurrentEligibility(version.manifest, iterateAnalyticsParticipants(id, eligibilityQuestionIds(version.manifest, analysisQuestions.map((question) => question.id)), { statuses }))) {
          statusCounts[respondent.status] += 1;
          for (const accumulator of accumulators.values()) accumulator.add(respondent);
        }
        selectedSummaries = Object.fromEntries([...accumulators].map(([questionId, accumulator]) => [questionId, accumulator.finish()]));
        asOf = new Date().toISOString();
      }
      const participantCount = statuses.reduce((count, status) => count + statusCounts[status], 0);
      const submittedCount = statuses.includes("submitted") ? statusCounts.submitted : 0;
      const fullResult: Record<string, unknown> = {
        interviewId: id,
        surveyVersion: version.version,
        asOf,
        scope: {
          statuses,
          participantCount,
          respondentCount: participantCount,
          submittedCount,
          submittedOnly: statuses.length === 1 && statuses[0] === "submitted",
        },
        questionCount: questions.length,
        offset: createRun ? 0 : offset,
        limit: createRun ? questions.length : limit,
        nextOffset: createRun ? null : offset + page.length < questions.length ? offset + page.length : null,
        questions: analysisQuestions.map((question) => ({
          id: question.id,
          type: question.type,
          label: question.label,
          ...selectedSummaries[question.id],
        })),
        ...(compareRequested ? {
          statusCohorts: statuses.map((status) => ({
            status,
            participantCount: statusCounts[status],
            respondentCount: statusCounts[status],
            questions: analysisQuestions.map((question) => ({
              id: question.id,
              type: question.type,
              label: question.label,
              ...statusSummaries[status][question.id],
            })),
          })),
        } : {}),
        methodology: [
          "Summaries use the current survey version and the participant statuses shown in scope.",
          "participantCount counts everyone in the selected status cohort, including invited people with no answers. respondentCount is a compatibility alias; do not describe people with no answers as respondents.",
          "answeredCount counts non-empty stored values, including values that are incompatible with the current version; unmapped values are excluded from valid numeric summaries and distributions.",
          "cohortCount includes everyone in each selected status cohort. eligibleCount and inactiveCount are inferred from current routing rules and saved answers, not historical display telemetry. noAnswerCount counts eligible people without a non-empty stored value; inactive people are excluded from item summaries and counted separately.",
          "missingCount remains a compatibility alias for noAnswerCount. Distribution percentages use valid answers from currently eligible people that match the current options or scale.",
          "For multi-select questions, each option percentage is a share of valid respondents and percentages can sum above 100%.",
          "All summaries in this result use one live participant scan; changes during the scan are not isolated by a database snapshot.",
          ...(createRun ? ["This completed aggregate run supports stable pagination for up to one hour. Pages share the same asOf and completed output; participant changes during the initial live scan were not isolated by a database snapshot."] : []),
          "Number summaries are descriptive. numeric.quantiles reports exact Hyndman-Fan type-7 quantiles through n=256, or approximate mergeable DDSketch quartiles after that (2% relative-value accuracy setting, 512 bins per sign); it reports whether bins collapsed, values exceeded the mapped range, and the resulting error-guarantee status. Relative-value accuracy is not rank error, and no bound applies after bin collapse or when values exceed the mapped range. Minimum, maximum, and mean use all valid numeric answers. This internal memory limit does not suppress any cohort or numeric result. Scale responses are ordinal: scaleMedian is the lower central category retained for compatibility, and scaleMedianRange gives the one or two central observed categories. Category codes are never averaged and no scale mean is calculated. Text is not interpreted, scored, or returned.",
        ],
      };
      if (createRun) {
        const stored = await createAnalyticsRun(id, version.version, fullResult, interview.respondentWriteRevision ?? 0);
        if (!stored) return err("Could not create an analysis run for this tenant and interview.");
        if (!stored.ok) return err(
          stored.reason === "stale"
            ? "Answers or the questionnaire changed while this analysis was running. Run the analysis again."
            : stored.reason === "too_large"
            ? "The aggregate result is too large to keep as a repeatable analysis run. Select one question with questionId, or use smaller questionIds selections when segmenting."
            : "This tenant already has the maximum number of active analysis runs. Retry after an existing run expires.",
          stored.reason === "stale" ? "analysis_run_stale" : stored.reason === "too_large" ? "analysis_run_too_large" : "analysis_run_capacity",
        );
        return ok(pageAnalyticsRunResult(fullResult as AnalyticsRunPayload, offset, limit, stored.id, stored.expiresAt));
      }
      return ok(fullResult);
    },
  },
  {
    name: "get_status",
    description: "Interview open/closed, aggregate counts, and one bounded page of per-person progress. Pass nextCursor back as cursor to continue.",
    inputSchema: obj({ interviewId: str, cursor: str, limit: { type: "integer", minimum: 1, maximum: 100 } }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      if (args.cursor !== undefined && (typeof args.cursor !== "string" || args.cursor.length > 256)) return err("cursor must be a valid nextCursor value returned by get_status.", "invalid_args");
      const cursor = args.cursor === undefined ? null : args.cursor.trim() || null;
      if (args.cursor !== undefined && !cursor) return err("cursor must be the nextCursor value returned by get_status.", "invalid_args");
      if (args.limit !== undefined && (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) return err("limit must be an integer from 1 to 100.", "invalid_args");
      let loaded;
      try {
        loaded = await loadPeoplePage(id, cursor, typeof args.limit === "number" ? args.limit : 50);
      } catch (error) {
        if (error instanceof ParticipantCursorError) return err(error.message, "participant_cursor_invalid");
        throw error;
      }
      if (!loaded) return err("Interview not found.", "not_found");
      const counts = await getInterviewParticipantCounts(id);
      return ok({
        interviewId: id,
        name: loaded.interview.name,
        status: loaded.interview.status,
        currentVersion: loaded.interview.currentVersion,
        counts,
        people: loaded.people.map((p) => ({ id: p.id, name: p.name, status: p.status, answered: p.answered, total: p.total, requiredMissing: p.requiredMissing, mail: p.mail.state })),
        nextCursor: loaded.nextCursor,
      });
    },
  },
  {
    name: "list_events",
    description: "Recent audit events for an interview.",
    inputSchema: obj({ interviewId: str, limit: { type: "integer", minimum: 1 } }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      if (!(await getInterview(id))) return err("Interview not found.", "not_found");
      let limit = 30;
      if (args.limit !== undefined) {
        if (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1) return err("limit must be an integer of at least 1.");
        limit = Math.min(50, args.limit);
      }
      const events = await recentEvents(id, limit);
      return ok({ events: events.map((event) => {
        const meta = event.meta ? { ...event.meta } : undefined;
        if (meta) delete meta.actor;
        return { ...event, ...(meta ? { meta } : {}) };
      }) });
    },
  },
  {
    name: "export_interview",
    description: "Export answers in a format the host can already download.",
    inputSchema: obj({ interviewId: str, format: { type: "string", enum: [...EXPORT_FORMATS] } }, ["interviewId", "format"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      const format = args.format as ExportFormat;
      if (!id) return err("interviewId is required.");
      if (!EXPORT_FORMATS.includes(format)) return err(`format must be one of ${EXPORT_FORMATS.join(", ")}.`);
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const version = await getVersion(interview._id, interview.currentVersion);
      if (!version) return err("Survey version not found.", "not_found");
      const people = await listParticipants(id);
      const file = await exportInterview(
        {
          interview: { id, name: interview.name, description: interview.description, mode: interview.mode, status: interview.status, createdAt: interview.createdAt.toISOString() },
          manifest: version.manifest,
          surveyVersion: version.version,
          participants: people.map((p) => ({ id: p.id, name: p.name, note: p.note, status: p.status, createdAt: p.createdAt, lastSavedAt: p.lastSavedAt, submittedAt: p.submittedAt, answers: p.answers, recordGroups: p.recordGroups, questionOrderAssignments: p.questionOrderAssignments })),
          generatedAt: new Date().toISOString(),
        },
        format,
      );
      const binary = typeof file.body !== "string";
      const body = typeof file.body === "string" ? file.body : file.body.toString("base64");
      const textBody = !binary && Buffer.byteLength(body, "utf8") <= 64 * 1024
        ? body
        : `Exported ${file.filename}. The complete file is in structuredContent.`;
      const result = ok(
        { ok: true, filename: file.filename, contentType: file.contentType, encoding: binary ? "base64" : "utf8", body },
        textBody,
      );
      // Bound the fully encoded MCP result as well as the file bytes: base64
      // and JSON string escaping can expand the payload substantially.
      if (Buffer.byteLength(JSON.stringify(result), "utf8") > MAX_EXPORT_OUTPUT_BYTES) throw new ExportOutputSizeLimitError();
      return result;
    },
  },
  {
    name: "get_mail_status",
    description: "Read stored invite results, including unconfirmed pending attempts. Does not open the mailbox.",
    inputSchema: obj({ personId: str, interviewId: str, cursor: str, limit: { type: "integer", minimum: 1, maximum: 100 } }),
    async run(args) {
      const personId = asString(args.personId, 40);
      const interviewId = asString(args.interviewId, 40);
      if (!personId && !interviewId) return err("personId or interviewId is required.");
      if (personId) {
        if (args.cursor !== undefined || args.limit !== undefined) return err("cursor and limit apply only to interview-wide mail status reads.", "invalid_args");
        const loaded = await onePerson(personId);
        if (!loaded) return err("Person not found.", "not_found");
        return ok({ people: [{ id: loaded.view.id, email: loaded.view.email, mail: loaded.view.mail }] });
      }
      if (args.cursor !== undefined && (typeof args.cursor !== "string" || args.cursor.length > 256)) return err("cursor must be a valid nextCursor value returned by get_mail_status.", "invalid_args");
      const cursor = args.cursor === undefined ? null : args.cursor.trim() || null;
      if (args.cursor !== undefined && !cursor) return err("cursor must be the nextCursor value returned by get_mail_status.", "invalid_args");
      if (args.limit !== undefined && (typeof args.limit !== "number" || !Number.isInteger(args.limit) || args.limit < 1 || args.limit > 100)) return err("limit must be an integer from 1 to 100.", "invalid_args");
      let loaded;
      try {
        loaded = await loadPeoplePage(interviewId!, cursor, typeof args.limit === "number" ? args.limit : 50);
      } catch (error) {
        if (error instanceof ParticipantCursorError) return err(error.message, "participant_cursor_invalid");
        throw error;
      }
      if (!loaded) return err("Interview not found.", "not_found");
      return ok({ people: loaded.people.map((p) => ({ id: p.id, name: p.name, email: p.email, mail: p.mail })), nextCursor: loaded.nextCursor });
    },
  },
  {
    name: "create_interview",
    description: "Create and immediately open a live version-1 interview from a questionnaire file after a static check. This is a persistent workspace mutation, not a draft or preview; single mode also creates a default Respondent. Use check_questionnaire first and only call after the accountable host has approved fielding.",
    inputSchema: obj({ name: str, description: str, mode: { type: "string", enum: ["single", "multi"] }, html: str, fileName: str }, ["name", "mode", "html"]),
    async run(args) {
      const name = asString(args.name, 120);
      if (!name) return err("Give the interview a name.");
      if (args.mode !== "single" && args.mode !== "multi") return err("mode must be single or multi.");
      if (typeof args.html !== "string") return err("html is required.");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.");
      const prepared = prepareSurvey(args.html, asString(args.fileName, 200));
      if (!prepared.survey || !prepared.report.ok) {
        return { ...err("The file did not pass the checker.", "checker"), structuredContent: { ok: false, error: "The file did not pass the checker.", code: "checker", markdown: prepared.markdown } };
      }
      const doc = await createInterview({ name, description: asString(args.description, 500) || undefined, mode: args.mode, survey: prepared.survey });
      return ok({ id: doc._id.toHexString(), interviewId: doc._id.toHexString(), report: { ok: true, counts: prepared.report.counts } });
    },
  },
  {
    name: "update_interview",
    description: "Rename an interview, edit its notes, or open or close it.",
    inputSchema: obj({ interviewId: str, name: str, description: str, status: { type: "string", enum: ["open", "closed"] } }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const patch: { name?: string; description?: string | null; status?: "open" | "closed" } = {};
      if (args.name !== undefined) {
        const name = asString(args.name, 120);
        if (!name) return err("The name cannot be empty.");
        patch.name = name;
      }
      if (args.description !== undefined) patch.description = asString(args.description, 500) ?? null;
      if (args.status !== undefined) {
        if (args.status !== "open" && args.status !== "closed") return err("Status must be open or closed.");
        patch.status = args.status;
      }
      if (!Object.keys(patch).length) return err("Nothing to update.");
      const updated = await updateInterview(id, patch);
      return updated ? ok({ ok: true, interviewId: id }) : err("Interview not found.", "not_found");
    },
  },
  {
    name: "delete_interview",
    description: "Delete an interview, its versions, people, answers, and invite history. confirmName must match exactly.",
    inputSchema: obj({ interviewId: str, confirmName: str }, ["interviewId", "confirmName"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      if (args.confirmName !== interview.name) return err("Type the interview name exactly to confirm deleting it.", "confirmation_mismatch");
      const deleted = await deleteInterview(id);
      return deleted ? ok({ ok: true }) : err("Interview not found.", "not_found");
    },
  },
  {
    name: "preview_questionnaire_version_patch",
    description: "Preview a complete candidate questionnaire HTML file for a new immutable version. This does not publish anything. The result includes review.available and, when temporary storage is available, a short-lived review.url for an authenticated survee host to inspect the candidate in the sandboxed browser preview. Review storage keeps up to five active candidates per interview; when full, review.available is false and the signed preview remains usable.",
    inputSchema: obj({ interviewId: str, html: str, fileName: str }, ["interviewId", "html"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const principal = currentPrincipal();
      if (!principal?.tenantId) return err("A tenant-bound MCP request is required to preview questionnaire changes.", "tenant_context_required");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const current = await getVersion(interview._id, interview.currentVersion);
      if (!current) return err("Current survey version not found.", "not_found");
      if (typeof args.html !== "string") return err("html is required.");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.");
      const fileName = asString(args.fileName, 200);
      const prepared = await withCompat(prepareSurvey(args.html, fileName), id);
      const candidateHtml = prepared.survey?.html ?? args.html.replace(/^\uFEFF/, "");
      const compatibilityHash = hashCompatibilityFindings(prepared.report.diagnostics);
      const previewToken = prepared.survey && prepared.report.ok
        ? createPatchPreviewToken({
          interviewId: id,
          expectedVersion: interview.currentVersion,
          baseHash: current.htmlSha256,
          candidateHash: sha256(candidateHtml),
          fileNameHash: fileNameHash(fileName),
          compatibilityHash,
        })
        : null;
      if (prepared.survey && prepared.report.ok && !previewToken) {
        return err("Secure preview signing is not configured for this request.", "preview_unavailable");
      }
      const review = prepared.survey && prepared.report.ok && previewToken
        ? await createQuestionnaireReviewLink({
          interviewId: id,
          expectedVersion: interview.currentVersion,
          candidateHash: sha256(candidateHtml),
          fileName,
          html: candidateHtml,
          questions: prepared.report.manifest?.questions ?? [],
          previewExpiresAt: previewToken.previewExpiresAt,
        })
        : null;
      const questionChanges = prepared.report.manifest
        ? summarizeQuestionChanges(current.manifest.questions, prepared.report.manifest.questions)
        : null;
      const sectionChanges = prepared.report.manifest
        ? summarizeSectionChanges(current.manifest.sections ?? [], prepared.report.manifest.sections ?? [])
        : null;
      return ok({
        ok: !!prepared.survey && prepared.report.ok,
        interviewId: id,
        currentVersion: interview.currentVersion,
        baseHash: current.htmlSha256,
        candidateHash: sha256(candidateHtml),
        staticValid: prepared.report.ok,
        diagnostics: prepared.report.diagnostics,
        counts: prepared.report.counts,
        compatibilityImpact: hasCompatibilityImpact(prepared.report.diagnostics),
        compatibilityHash,
        ...(previewToken ?? {}),
        ...(prepared.survey && prepared.report.ok ? { review: review ?? { available: false } } : {}),
        report: prepared.markdown,
        changes: prepared.report.manifest ? {
          questionCountBefore: current.manifest.questions.length,
          questionCountAfter: prepared.report.manifest.questions.length,
          questionsBefore: questionList(current.manifest),
          questionsAfter: questionList(prepared.report.manifest),
          sectionsBefore: current.manifest.sections ?? [],
          sectionsAfter: prepared.report.manifest.sections ?? [],
          questionChanges: questionChanges && {
            counts: {
              added: questionChanges.added.length,
              removed: questionChanges.removed.length,
              updated: questionChanges.updated.length,
              moved: questionChanges.moved.length,
            },
            addedIds: questionChanges.added.map((question) => question.id),
            removedIds: questionChanges.removed.map((question) => question.id),
            updated: questionChanges.updated.map(({ previous, question, fields }) => ({
              id: question.id,
              fields,
              before: Object.fromEntries(fields.map((field) => [field, previous[field] ?? null])),
              after: Object.fromEntries(fields.map((field) => [field, question[field] ?? null])),
            })),
            moved: questionChanges.moved,
          },
          sectionChanges: sectionChanges && {
            counts: {
              added: sectionChanges.added.length,
              removed: sectionChanges.removed.length,
              updated: sectionChanges.updated.length,
              moved: sectionChanges.moved.length,
            },
            addedIds: sectionChanges.added.map((section) => section.id),
            removedIds: sectionChanges.removed.map((section) => section.id),
            updated: sectionChanges.updated.map(({ previous, section, fields }) => ({
              id: section.id,
              fields,
              before: Object.fromEntries(fields.map((field) => [field, previous[field] ?? null])),
              after: Object.fromEntries(fields.map((field) => [field, section[field] ?? null])),
            })),
            moved: sectionChanges.moved,
          },
        } : null,
      });
    },
  },
  {
    name: "preview_questionnaire_required_patch",
    description: "Preview a batch of required/optional changes by stable question ID. The server changes only the manifest booleans and preserves every other HTML byte; it does not publish. The result includes review.available and, when temporary storage is available, a short-lived review.url for an authenticated survee host to inspect the candidate in the sandboxed browser preview. Review storage keeps up to five active candidates per interview; when full, review.available is false and the signed preview remains usable.",
    inputSchema: obj({ interviewId: str, changes: requiredChanges }, ["interviewId", "changes"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const principal = currentPrincipal();
      if (!principal?.tenantId) return err("A tenant-bound MCP request is required to preview questionnaire changes.", "tenant_context_required");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const current = await getVersion(interview._id, interview.currentVersion);
      if (!current) return err("Current survey version not found.", "not_found");
      const patched = patchRequiredQuestions(current.html, args.changes as RequiredQuestionChange[]);
      if (!patched.ok) return err(patched.error, "invalid_patch");
      const prepared = await withCompat(prepareSurvey(patched.html, current.fileName), id);
      const candidateHtml = prepared.survey?.html ?? patched.html.replace(/^\uFEFF/, "");
      const candidateHash = sha256(candidateHtml);
      const compatibilityHash = hashCompatibilityFindings(prepared.report.diagnostics);
      const previewToken = prepared.survey && prepared.report.ok
        ? createPatchPreviewToken({
          interviewId: id,
          expectedVersion: interview.currentVersion,
          baseHash: current.htmlSha256,
          candidateHash,
          fileNameHash: fileNameHash(current.fileName),
          compatibilityHash,
        })
        : null;
      if (prepared.survey && prepared.report.ok && !previewToken) {
        return err("Secure preview signing is not configured for this request.", "preview_unavailable");
      }
      const review = prepared.survey && prepared.report.ok && previewToken
        ? await createQuestionnaireReviewLink({
          interviewId: id,
          expectedVersion: interview.currentVersion,
          candidateHash,
          fileName: current.fileName,
          html: candidateHtml,
          questions: prepared.report.manifest?.questions ?? [],
          previewExpiresAt: previewToken.previewExpiresAt,
        })
        : null;
      const questionsAfter = prepared.report.manifest ? questionList(prepared.report.manifest) : null;
      return ok({
        ok: !!prepared.survey && prepared.report.ok,
        interviewId: id,
        currentVersion: interview.currentVersion,
        baseHash: current.htmlSha256,
        candidateHash,
        staticValid: prepared.report.ok,
        diagnostics: prepared.report.diagnostics,
        counts: prepared.report.counts,
        compatibilityImpact: hasCompatibilityImpact(prepared.report.diagnostics),
        compatibilityHash,
        ...(previewToken ?? {}),
        ...(prepared.survey && prepared.report.ok ? { review: review ?? { available: false } } : {}),
        report: prepared.markdown,
        changes: patched.changes.map((change) => ({
          questionId: change.questionId,
          beforeRequired: change.beforeRequired,
          afterRequired: change.required,
        })),
        questionsBefore: questionList(current.manifest),
        questionsAfter,
      });
    },
  },
  {
    name: "apply_questionnaire_version_patch",
    description: "Publish a new immutable questionnaire version from complete HTML after preview. Requires the signed, short-lived previewToken and matching version/hash fields; acknowledge compatibility impact when preview reports it.",
    inputSchema: obj({
      interviewId: str,
      html: str,
      fileName: str,
      expectedVersion: { type: "integer", minimum: 1 },
      baseHash: str,
      candidateHash: str,
      previewToken: str,
      compatibilityHash: str,
      acknowledgeCompatibilityImpact: bool,
    }, ["interviewId", "html", "expectedVersion", "baseHash", "candidateHash", "previewToken"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const principal = currentPrincipal();
      if (!principal?.tenantId) return err("A tenant-bound MCP request is required to apply questionnaire changes.", "tenant_context_required");
      const fileName = asString(args.fileName, 200);
      const expectedVersion = args.expectedVersion as number;
      const preview = verifyPatchPreviewToken(asString(args.previewToken, 1000), {
        tenantId: principal.tenantId,
        interviewId: id,
        expectedVersion,
        baseHash: args.baseHash as string,
        candidateHash: args.candidateHash as string,
        fileNameHash: fileNameHash(fileName),
      });
      if (!preview.ok) return previewTokenError(preview.code);
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      if (typeof args.html !== "string") return err("html is required.");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.");
      const current = await getVersion(interview._id, interview.currentVersion);
      if (interview.currentVersion !== expectedVersion || !current || current.htmlSha256 !== args.baseHash) {
        return err("The questionnaire changed since preview. Preview again before applying.", "stale_preview");
      }
      const prepared = await withCompat(prepareSurvey(args.html, fileName), id);
      if (!prepared.survey || !prepared.report.ok) {
        return { ...err("The candidate did not pass the static checker.", "checker"), structuredContent: { ok: false, error: "The candidate did not pass the static checker.", code: "checker", diagnostics: prepared.report.diagnostics, report: prepared.markdown } };
      }
      const candidateHash = sha256(prepared.survey.html);
      if (candidateHash !== args.candidateHash || candidateHash !== preview.claims.candidateHash) return err("The candidate HTML changed since preview. Preview again before applying.", "candidate_changed");
      const impact = hasCompatibilityImpact(prepared.report.diagnostics);
      const compatibilityHash = hashCompatibilityFindings(prepared.report.diagnostics);
      if (preview.claims.compatibilityHash !== compatibilityHash || (args.compatibilityHash !== undefined && args.compatibilityHash !== compatibilityHash)) {
        return err("Compatibility findings changed since preview. Preview again before applying.", "stale_preview");
      }
      if (impact && args.acknowledgeCompatibilityImpact !== true) {
        return { ...err("Compatibility impact must be acknowledged before publishing.", "acknowledgement_required"), structuredContent: { ok: false, error: "Compatibility impact must be acknowledged before publishing.", code: "acknowledgement_required", diagnostics: prepared.report.diagnostics, compatibilityHash } };
      }
      if (impact && args.compatibilityHash === undefined) return err("A compatibilityHash from the reviewed preview is required to acknowledge these findings.", "preview_required");
      const published = await publishVersionIfCurrent(id, expectedVersion, current.htmlSha256, prepared.survey);
      if (!published) return err("Interview not found.", "not_found");
      if ("assetUnavailable" in published) return err("A referenced workspace image is missing or unavailable. Upload it again or remove its URL, then preview again.", "asset_unavailable");
      if ("conflict" in published) return err("The questionnaire changed while applying. Preview again before applying.", "stale_preview");
      return ok({ ok: true, interviewId: id, version: published.version, previousVersion: expectedVersion, candidateHash, diagnostics: prepared.report.diagnostics });
    },
  },
  {
    name: "apply_questionnaire_required_patch",
    description: "Publish a previewed batch of required/optional changes by stable question ID. Requires the signed previewToken and matching version/hash fields; acknowledge compatibility impact when preview reports it.",
    inputSchema: obj({
      interviewId: str,
      changes: requiredChanges,
      expectedVersion: { type: "integer", minimum: 1 },
      baseHash: str,
      candidateHash: str,
      previewToken: str,
      compatibilityHash: str,
      acknowledgeCompatibilityImpact: bool,
    }, ["interviewId", "changes", "expectedVersion", "baseHash", "candidateHash", "previewToken"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const principal = currentPrincipal();
      if (!principal?.tenantId) return err("A tenant-bound MCP request is required to apply questionnaire changes.", "tenant_context_required");
      const expectedVersion = args.expectedVersion as number;
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const current = await getVersion(interview._id, interview.currentVersion);
      if (interview.currentVersion !== expectedVersion || !current || current.htmlSha256 !== args.baseHash) {
        return err("The questionnaire changed since preview. Preview again before applying.", "stale_preview");
      }
      const preview = verifyPatchPreviewToken(asString(args.previewToken, 1000), {
        tenantId: principal.tenantId,
        interviewId: id,
        expectedVersion,
        baseHash: args.baseHash as string,
        candidateHash: args.candidateHash as string,
        fileNameHash: fileNameHash(current.fileName),
      });
      if (!preview.ok) return previewTokenError(preview.code);
      const patched = patchRequiredQuestions(current.html, args.changes as RequiredQuestionChange[]);
      if (!patched.ok) return err(patched.error, "invalid_patch");
      const prepared = await withCompat(prepareSurvey(patched.html, current.fileName), id);
      if (!prepared.survey || !prepared.report.ok) {
        return { ...err("The candidate did not pass the static checker.", "checker"), structuredContent: { ok: false, error: "The candidate did not pass the static checker.", code: "checker", diagnostics: prepared.report.diagnostics, report: prepared.markdown } };
      }
      const candidateHash = sha256(prepared.survey.html);
      if (candidateHash !== args.candidateHash || candidateHash !== preview.claims.candidateHash) return err("The questionnaire changed since preview. Preview again before applying.", "candidate_changed");
      const impact = hasCompatibilityImpact(prepared.report.diagnostics);
      const compatibilityHash = hashCompatibilityFindings(prepared.report.diagnostics);
      if (preview.claims.compatibilityHash !== compatibilityHash || (args.compatibilityHash !== undefined && args.compatibilityHash !== compatibilityHash)) {
        return err("Compatibility findings changed since preview. Preview again before applying.", "stale_preview");
      }
      if (impact && args.acknowledgeCompatibilityImpact !== true) {
        return { ...err("Compatibility impact must be acknowledged before publishing.", "acknowledgement_required"), structuredContent: { ok: false, error: "Compatibility impact must be acknowledged before publishing.", code: "acknowledgement_required", diagnostics: prepared.report.diagnostics, compatibilityHash } };
      }
      if (impact && args.compatibilityHash === undefined) return err("A compatibilityHash from the reviewed preview is required to acknowledge these findings.", "preview_required");
      const published = await publishVersionIfCurrent(id, expectedVersion, current.htmlSha256, prepared.survey);
      if (!published) return err("Interview not found.", "not_found");
      if ("assetUnavailable" in published) return err("A referenced workspace image is missing or unavailable. Upload it again or remove its URL, then preview again.", "asset_unavailable");
      if ("conflict" in published) return err("The questionnaire changed while applying. Preview again before applying.", "stale_preview");
      return ok({
        ok: true,
        interviewId: id,
        version: published.version,
        previousVersion: expectedVersion,
        candidateHash,
        changes: patched.changes.map((change) => ({ questionId: change.questionId, beforeRequired: change.beforeRequired, afterRequired: change.required })),
        diagnostics: prepared.report.diagnostics,
      });
    },
  },
  {
    name: "preview_questionnaire_block_patch",
    description: `Preview up to ${LIMITS.maxQuestions} add/update/delete/move operations for ordinary questions with explicit question and list markers. Adds and moves can target a position before or after an unchanged question; moves can also change sections. Only the selected manifest entries and question blocks are edited; arbitrary HTML, custom questions, and scripts are not transformed. The result includes review.available and, when temporary storage is available, a short-lived review.url for an authenticated survee host to inspect the candidate in the sandboxed browser preview. Review storage keeps up to five active candidates per interview; when full, review.available is false and the signed preview remains usable.`,
    inputSchema: obj({ interviewId: str, operations: questionnaireBlockOperations }, ["interviewId", "operations"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const principal = currentPrincipal();
      if (!principal?.tenantId) return err("A tenant-bound MCP request is required to preview questionnaire changes.", "tenant_context_required");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const current = await getVersion(interview._id, interview.currentVersion);
      if (!current) return err("Current survey version not found.", "not_found");
      const patched = patchQuestionnaireBlocks(current.html, args.operations as QuestionnaireBlockOperation[]);
      if (!patched.ok) return err(patched.error, "invalid_patch");
      const prepared = await withCompat(prepareSurvey(patched.html, current.fileName), id);
      const candidateHtml = prepared.survey?.html ?? patched.html.replace(/^\uFEFF/, "");
      const candidateHash = sha256(candidateHtml);
      const compatibilityHash = hashCompatibilityFindings(prepared.report.diagnostics);
      const previewToken = prepared.survey && prepared.report.ok
        ? createPatchPreviewToken({
          interviewId: id,
          expectedVersion: interview.currentVersion,
          baseHash: current.htmlSha256,
          candidateHash,
          fileNameHash: fileNameHash(current.fileName),
          compatibilityHash,
        })
        : null;
      if (prepared.survey && prepared.report.ok && !previewToken) {
        return err("Secure preview signing is not configured for this request.", "preview_unavailable");
      }
      const review = prepared.survey && prepared.report.ok && previewToken
        ? await createQuestionnaireReviewLink({
          interviewId: id,
          expectedVersion: interview.currentVersion,
          candidateHash,
          fileName: current.fileName,
          html: candidateHtml,
          questions: prepared.report.manifest?.questions ?? [],
          previewExpiresAt: previewToken.previewExpiresAt,
        })
        : null;
      const questionsAfter = prepared.report.manifest ? questionList(prepared.report.manifest) : null;
      const questionChanges = prepared.report.manifest
        ? summarizeQuestionChanges(current.manifest.questions, prepared.report.manifest.questions)
        : null;
      return ok({
        ok: !!prepared.survey && prepared.report.ok,
        interviewId: id,
        currentVersion: interview.currentVersion,
        baseHash: current.htmlSha256,
        candidateHash,
        staticValid: prepared.report.ok,
        diagnostics: prepared.report.diagnostics,
        counts: prepared.report.counts,
        compatibilityImpact: hasCompatibilityImpact(prepared.report.diagnostics),
        compatibilityHash,
        ...(previewToken ?? {}),
        ...(prepared.survey && prepared.report.ok ? { review: review ?? { available: false } } : {}),
        report: prepared.markdown,
        operationChanges: patched.changes,
        questionsBefore: questionList(current.manifest),
        questionsAfter,
        questionChanges: questionChanges && {
          counts: {
            added: questionChanges.added.length,
            removed: questionChanges.removed.length,
            updated: questionChanges.updated.length,
            moved: questionChanges.moved.length,
          },
          addedIds: questionChanges.added.map((question) => question.id),
          removedIds: questionChanges.removed.map((question) => question.id),
          addedQuestions: questionChanges.added,
          removedQuestions: questionChanges.removed,
          updated: questionChanges.updated.map(({ previous, question, fields }) => ({
            id: question.id,
            fields,
            before: Object.fromEntries(fields.map((field) => [field, previous[field] ?? null])),
            after: Object.fromEntries(fields.map((field) => [field, question[field] ?? null])),
          })),
          moved: questionChanges.moved,
        },
      });
    },
  },
  {
    name: "apply_questionnaire_block_patch",
    description: "Publish a previewed batch of ordinary question block edits, including question moves and positioned additions. Requires the signed previewToken and matching version/hash fields; acknowledge compatibility impact when preview reports it.",
    inputSchema: obj({
      interviewId: str,
      operations: questionnaireBlockOperations,
      expectedVersion: { type: "integer", minimum: 1 },
      baseHash: str,
      candidateHash: str,
      previewToken: str,
      compatibilityHash: str,
      acknowledgeCompatibilityImpact: bool,
    }, ["interviewId", "operations", "expectedVersion", "baseHash", "candidateHash", "previewToken"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const principal = currentPrincipal();
      if (!principal?.tenantId) return err("A tenant-bound MCP request is required to apply questionnaire changes.", "tenant_context_required");
      const expectedVersion = args.expectedVersion as number;
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const current = await getVersion(interview._id, interview.currentVersion);
      if (interview.currentVersion !== expectedVersion || !current || current.htmlSha256 !== args.baseHash) {
        return err("The questionnaire changed since preview. Preview again before applying.", "stale_preview");
      }
      const preview = verifyPatchPreviewToken(asString(args.previewToken, 1000), {
        tenantId: principal.tenantId,
        interviewId: id,
        expectedVersion,
        baseHash: args.baseHash as string,
        candidateHash: args.candidateHash as string,
        fileNameHash: fileNameHash(current.fileName),
      });
      if (!preview.ok) return previewTokenError(preview.code);
      const patched = patchQuestionnaireBlocks(current.html, args.operations as QuestionnaireBlockOperation[]);
      if (!patched.ok) return err(patched.error, "invalid_patch");
      const prepared = await withCompat(prepareSurvey(patched.html, current.fileName), id);
      if (!prepared.survey || !prepared.report.ok) {
        return { ...err("The candidate did not pass the static checker.", "checker"), structuredContent: { ok: false, error: "The candidate did not pass the static checker.", code: "checker", diagnostics: prepared.report.diagnostics, report: prepared.markdown } };
      }
      const candidateHash = sha256(prepared.survey.html);
      if (candidateHash !== args.candidateHash || candidateHash !== preview.claims.candidateHash) return err("The candidate changed since preview. Preview again before applying.", "candidate_changed");
      const impact = hasCompatibilityImpact(prepared.report.diagnostics);
      const compatibilityHash = hashCompatibilityFindings(prepared.report.diagnostics);
      if (preview.claims.compatibilityHash !== compatibilityHash || (args.compatibilityHash !== undefined && args.compatibilityHash !== compatibilityHash)) {
        return err("Compatibility findings changed since preview. Preview again before applying.", "stale_preview");
      }
      if (impact && args.acknowledgeCompatibilityImpact !== true) {
        return { ...err("Compatibility impact must be acknowledged before publishing.", "acknowledgement_required"), structuredContent: { ok: false, error: "Compatibility impact must be acknowledged before publishing.", code: "acknowledgement_required", diagnostics: prepared.report.diagnostics, compatibilityHash } };
      }
      if (impact && args.compatibilityHash === undefined) return err("A compatibilityHash from the reviewed preview is required to acknowledge these findings.", "preview_required");
      const published = await publishVersionIfCurrent(id, expectedVersion, current.htmlSha256, prepared.survey);
      if (!published) return err("Interview not found.", "not_found");
      if ("assetUnavailable" in published) return err("A referenced workspace image is missing or unavailable. Upload it again or remove its URL, then preview again.", "asset_unavailable");
      if ("conflict" in published) return err("The questionnaire changed while applying. Preview again before applying.", "stale_preview");
      return ok({
        ok: true,
        interviewId: id,
        version: published.version,
        previousVersion: expectedVersion,
        candidateHash,
        operationChanges: patched.changes,
        diagnostics: prepared.report.diagnostics,
      });
    },
  },
  {
    name: "upload_survey_version",
    description: "Upload a compatible questionnaire version. If saved answers may be affected, review the returned findings and retry with its short-lived previewToken, matching hashes, and explicit compatibility acknowledgement; prefer preview/apply for agent-authored changes.",
    inputSchema: obj({
      interviewId: str,
      html: str,
      fileName: str,
      expectedVersion: { type: "integer", minimum: 1 },
      baseHash: str,
      candidateHash: str,
      previewToken: str,
      compatibilityHash: str,
      acknowledgeCompatibilityImpact: bool,
    }, ["interviewId", "html"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const fileName = asString(args.fileName, 200);
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      if (typeof args.html !== "string") return err("html is required.");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.");
      const current = await getVersion(interview._id, interview.currentVersion);
      if (!current) return err("Current survey version not found.", "not_found");
      const prepared = await withCompat(prepareSurvey(args.html, fileName), id);
      if (!prepared.survey || !prepared.report.ok) {
        return { ...err("The file did not pass the checker.", "checker"), structuredContent: { ok: false, error: "The file did not pass the checker.", diagnostics: prepared.report.diagnostics, report: prepared.markdown } };
      }
      const candidateHash = sha256(prepared.survey.html);
      const compatibilityHash = hashCompatibilityFindings(prepared.report.diagnostics);
      const hasPreviewFields = args.expectedVersion !== undefined || args.baseHash !== undefined || args.candidateHash !== undefined || args.previewToken !== undefined || args.compatibilityHash !== undefined;
      const hasAcknowledgement = args.acknowledgeCompatibilityImpact === true;
      const hasPreview = typeof args.expectedVersion === "number" && typeof args.baseHash === "string" && typeof args.candidateHash === "string";
      if ((hasPreviewFields || hasAcknowledgement) && !hasPreview) {
        return err("expectedVersion, baseHash, and candidateHash from a reviewed preview must be provided together.", "preview_required");
      }
      if (hasPreview) {
        if (interview.currentVersion !== args.expectedVersion || current.htmlSha256 !== args.baseHash) {
          return err("The questionnaire changed since preview. Preview again before uploading.", "stale_preview");
        }
        if (candidateHash !== args.candidateHash) {
          return err("The candidate HTML changed since preview. Preview again before uploading.", "candidate_changed");
        }
      }
      if (args.compatibilityHash !== undefined && args.compatibilityHash !== compatibilityHash) {
        return err("Compatibility findings changed since preview. Preview again before uploading.", "stale_preview");
      }
      const compatibilityImpact = hasCompatibilityImpact(prepared.report.diagnostics);
      let previewToken: { previewToken: string; previewExpiresAt: string } | null = null;
      if (compatibilityImpact && args.previewToken === undefined) {
        const principal = currentPrincipal();
        if (!principal?.tenantId) return err("A tenant-bound MCP request is required to review questionnaire changes.", "tenant_context_required");
        previewToken = createPatchPreviewToken({
          interviewId: id,
          expectedVersion: interview.currentVersion,
          baseHash: current.htmlSha256,
          candidateHash,
          fileNameHash: fileNameHash(fileName),
          compatibilityHash,
        });
        if (!previewToken) return err("Secure preview signing is not configured for this request.", "preview_unavailable");
      } else if (args.previewToken !== undefined) {
        const principal = currentPrincipal();
        if (!principal?.tenantId) return err("A tenant-bound MCP request is required to upload questionnaire changes.", "tenant_context_required");
        const preview = verifyPatchPreviewToken(asString(args.previewToken, 1000), {
          tenantId: principal.tenantId,
          interviewId: id,
          expectedVersion: interview.currentVersion,
          baseHash: current.htmlSha256,
          candidateHash,
          fileNameHash: fileNameHash(fileName),
        });
        if (!preview.ok) return previewTokenError(preview.code);
        if (preview.claims.compatibilityHash !== compatibilityHash || (args.compatibilityHash !== undefined && args.compatibilityHash !== compatibilityHash)) {
          return err("Compatibility findings changed since preview. Preview again before uploading.", "stale_preview");
        }
      }
      if (compatibilityImpact && args.previewToken === undefined) {
        const message = "Compatibility impact must be reviewed before publishing. Review these findings, then retry with the returned previewToken, matching version and hashes, and acknowledgeCompatibilityImpact: true.";
        return {
          ...err(message, "acknowledgement_required"),
          structuredContent: {
            ok: false,
            error: message,
            code: "acknowledgement_required",
            interviewId: id,
            currentVersion: interview.currentVersion,
            baseHash: current.htmlSha256,
            candidateHash,
            compatibilityHash,
            compatibilityImpact,
            ...previewToken,
            diagnostics: prepared.report.diagnostics,
            report: prepared.markdown,
          },
        };
      }
      if (compatibilityImpact && args.acknowledgeCompatibilityImpact !== true) {
        return {
          ...err("Compatibility impact must be acknowledged before publishing.", "acknowledgement_required"),
          structuredContent: {
            ok: false,
            error: "Compatibility impact must be acknowledged before publishing.",
            code: "acknowledgement_required",
            interviewId: id,
            currentVersion: interview.currentVersion,
            baseHash: current.htmlSha256,
            candidateHash,
            compatibilityHash,
            compatibilityImpact,
            ...(typeof args.previewToken === "string" ? { previewToken: args.previewToken } : previewToken ?? {}),
            diagnostics: prepared.report.diagnostics,
            report: prepared.markdown,
          },
        };
      }
      const expectedVersion = hasPreview ? args.expectedVersion as number : interview.currentVersion;
      const expectedBaseHash = hasPreview ? args.baseHash as string : current.htmlSha256;
      const published = await publishVersionIfCurrent(id, expectedVersion, expectedBaseHash, prepared.survey, "mcp_upload");
      if (!published) return err("Interview not found.", "not_found");
      if ("assetUnavailable" in published) return err("A referenced workspace image is missing or unavailable. Upload it again or remove its URL, then preview again.", "asset_unavailable");
      if ("conflict" in published) return err("The questionnaire changed while uploading. Preview again before uploading.", "stale_preview");
      return ok({
        ok: true,
        version: published.version,
        previousVersion: expectedVersion,
        interviewId: id,
        candidateHash,
        compatibilityImpact,
        report: { ok: true, counts: prepared.report.counts, diagnostics: prepared.report.diagnostics },
      });
    },
  },
  {
    name: "add_people",
    description: `Add up to ${MAX_PEOPLE_PER_BATCH} people per request. Email is optional. Adding people to a One-person interview switches it to Multi-user.`,
    inputSchema: obj({ interviewId: str, people: { type: "array", maxItems: MAX_PEOPLE_PER_BATCH, items: obj({ name: str, email: str, note: str }, ["name"]) } }, ["interviewId", "people"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      if (!Array.isArray(args.people)) return err("people must be a list.", "invalid_args");
      if (args.people.length > MAX_PEOPLE_PER_BATCH) return err(`Add at most ${MAX_PEOPLE_PER_BATCH} people per request. Split the list into batches.`, "invalid_args");
      const people: { name: string; email?: string; note?: string }[] = [];
      for (const raw of args.people) {
        if (!raw || typeof raw !== "object") return err("Each person needs a name.", "invalid_args");
        const item = raw as Record<string, unknown>;
        const name = asString(item.name, 120);
        if (!name) return err("Each person needs a name.", "invalid_args");
        let email: string | undefined;
        if (item.email !== undefined && item.email !== null && item.email !== "") {
          if (typeof item.email !== "string") return err("That does not look like an email address.", "invalid_args");
          const parsed = parseEmail(item.email);
          if (!parsed.ok || !parsed.email) return err(parsed.ok ? "That does not look like an email address." : parsed.error, "invalid_args");
          email = parsed.email;
        }
        people.push({ name, email, note: asString(item.note, 1000) });
      }
      if (!people.length) return err("Add at least one person with a name.", "invalid_args");
      if (interview.mode !== "multi") await promoteToMultiUser(id);
      const created = await addParticipants(id, people);
      const views = created.map((person) => shapePerson(person, null, []));
      return ok({ people: views });
    },
  },
  {
    name: "update_person",
    description: "Change a person's name, optional email, or private note. An empty email clears it and does not send.",
    inputSchema: obj({ personId: str, name: str, email: str, note: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const patch: { name?: string; email?: string | null; note?: string | null } = {};
      if (args.name !== undefined) {
        const name = asString(args.name, 120);
        if (!name) return err("The name cannot be empty.");
        patch.name = name;
      }
      if (args.email !== undefined) {
        if (args.email === null || args.email === "") patch.email = null;
        else if (typeof args.email !== "string") return err("That does not look like an email address.");
        else {
          const parsed = parseEmail(args.email);
          if (!parsed.ok) return err(parsed.error);
          patch.email = parsed.email;
        }
      }
      if (args.note !== undefined) patch.note = args.note === null ? null : (asString(args.note, 1000) ?? null);
      if (!Object.keys(patch).length) return err("Nothing to update.");
      const updated = await updateParticipant(id, patch);
      if (!updated) return err("Person not found.", "not_found");
      const loaded = await onePerson(id);
      return ok({ person: loaded?.view ?? shapePerson(updated, null, []) });
    },
  },
  {
    name: "remove_person",
    description: "Remove a person, their answers, and their invite history.",
    inputSchema: obj({ personId: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      return (await deleteParticipant(id)) ? ok({ ok: true }) : err("Person not found.", "not_found");
    },
  },
  {
    name: "reopen_person",
    description: "Unlock a submitted person so they can edit again.",
    inputSchema: obj({ personId: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const person = await reopenParticipant(id);
      if (!person) {
        if (!(await onePerson(id))) return err("Person not found.", "not_found");
        return err("That person has not submitted, so there is nothing to reopen.", "not_submitted");
      }
      const loaded = await onePerson(id);
      return ok({ person: loaded?.view ?? shapePerson(person, null, []) });
    },
  },
  {
    name: "regenerate_link",
    description: "Replace a person's private link. The previous link stops working. Nothing is emailed automatically.",
    inputSchema: obj({ personId: str }, ["personId"]),
    async run(args) {
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const token = await regenerateToken(id);
      if (!token) return err("Person not found.", "not_found");
      const link = inviteLink(token);
      return ok({ token, link: link.ok ? link.link : null, interviewId: (await getParticipant(id))?.interviewId });
    },
  },
  {
    name: "send_invite",
    description: "Email one person their private link. Refuses when they have no email, the interview is closed, or the public URL is unset. A pending outcome is not retried automatically; pass resend: true only when you accept that a duplicate may be delivered.",
    inputSchema: obj({ personId: str, resend: bool }, ["personId"]),
    guard(args) {
      if ("personIds" in args || Array.isArray(args.personId)) return err("Send to one person at a time.");
      return null;
    },
    async run(args) {
      if ("personIds" in args || Array.isArray(args.personId)) return err("Send to one person at a time.");
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const result = await sendInvite({ personId: id, triggeredBy: "mcp", resend: args.resend === true });
      if (!result.ok) return err(result.error, result.code);
      return ok({ result: result.result, to: result.to, sentAt: result.sentAt, messageId: result.messageId ?? null, interviewId: result.interviewId, personId: result.personId });
    },
  },
  {
    name: "check_invite_delivery",
    description: "Connect briefly over IMAP and look up only the message id survee stored for this person's current invite, including an unconfirmed pending attempt. Returns delivered, bounced, or unknown.",
    inputSchema: obj({ personId: str }, ["personId"]),
    guard(args) {
      if ("query" in args || "mailbox" in args || "search" in args || "messageId" in args) {
        return err("Delivery checks only stored invite attempts for this person. It does not search a mailbox.");
      }
      return null;
    },
    async run(args) {
      if ("query" in args || "mailbox" in args || "search" in args || "messageId" in args) {
        return err("Delivery checks only stored invite attempts for this person. It does not search a mailbox.");
      }
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const result = await checkInviteDelivery(id);
      if (!result.ok) return err(result.error, result.code);
      const label = result.delivery === "delivered" ? "Delivered" : result.delivery === "bounced" ? "Bounced" : "Not confirmed yet";
      // A missing bounce is not proof of delivery: many mail servers send no receipt, so "unknown" is the normal result for a good send.
      const note = result.delivery === "unknown" ? "No bounce or delivery receipt was found. Many mail servers send no receipt, so this does not mean the invite failed." : null;
      return ok({ delivery: result.delivery, label, detail: result.detail ?? null, note, checkedAt: result.checkedAt, personId: result.personId, interviewId: result.interviewId });
    },
  },
];

export function listToolDefs(capabilities?: readonly McpCapability[]) {
  const readOnlyTools = new Set([
    "get_analytics_guidance", "get_design_guidance", "get_interview_packages", "get_questionnaire_authoring_skill", "extract_design_profile", "audit_questionnaire_design", "list_interviews", "get_interview",
    "get_survey_html", "list_versions", "check_questionnaire", "list_image_assets", "list_people", "get_person", "get_answers",
    "analyze_answers", "get_status", "list_events", "export_interview", "get_mail_status", "preview_questionnaire_version_patch", "preview_questionnaire_block_patch", "preview_questionnaire_required_patch",
  ]);
  return TOOLS.filter(({ name }) => canCallMcpTool(name, capabilities)).map(({ name, description, inputSchema }) => {
    const readOnly = readOnlyTools.has(name);
    const destructive = ["create_interview", "delete_interview", "remove_person", "regenerate_link", "apply_questionnaire_version_patch", "apply_questionnaire_block_patch", "apply_questionnaire_required_patch", "upload_survey_version", "delete_image_asset"].includes(name);
    const external = name === "send_invite" || name === "check_invite_delivery";
    return {
      name,
      title: name.split("_").map((part) => part[0]?.toUpperCase() + part.slice(1)).join(" "),
      description,
      inputSchema,
      annotations: {
        readOnlyHint: readOnly,
        destructiveHint: destructive,
        // Mutations also append an audit event, so repeating one is observably different.
        idempotentHint: readOnly,
        openWorldHint: external,
      },
    };
  });
}

async function finish(tool: string, result: ToolResult, interviewId?: string): Promise<ToolResult> {
  const fromResult = typeof result.structuredContent.interviewId === "string" ? result.structuredContent.interviewId : interviewId;
  // A successful delete is audited at tenant scope so it does not recreate an event
  // attached to the interview that was just removed.
  const auditInterviewId = tool === "delete_interview" && !result.isError ? undefined : fromResult;
  await noteMcp(tool, !result.isError, auditInterviewId).catch(() => {
    console.error("[audit] MCP tool event persistence failed");
  });
  return result;
}

export async function dispatchTool(name: string, args: unknown, capabilities?: readonly McpCapability[]): Promise<ToolResult> {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) return finish("unknown_tool", err("Unknown tool.", "unknown_tool"));
  const record = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : null;
  const interviewId = record && typeof record.interviewId === "string" ? record.interviewId : undefined;
  if (!canCallMcpTool(name, capabilities)) return finish(tool.name, err("This credential is not permitted to call this tool.", "forbidden"), interviewId);
  if (!record) return finish(tool.name, err("arguments must be an object.", "invalid_args"), interviewId);
  const guarded = tool.guard?.(record);
  if (guarded) return finish(tool.name, guarded, interviewId);
  const problem = validateToolArgs(tool.inputSchema, record);
  if (problem) return finish(tool.name, err(problem, "invalid_args"), interviewId);
  try {
    return await finish(tool.name, await tool.run(record), interviewId);
  } catch (error) {
    if (error instanceof ParticipantReadLimitError) {
      return finish(tool.name, err(error.message, "participant_read_limit"), interviewId);
    }
    if (error instanceof ParticipantExportSizeLimitError) {
      return finish(tool.name, err(error.message, "export_payload_limit", { limitBytes: error.limitBytes }), interviewId);
    }
    if (error instanceof ExportOutputSizeLimitError) {
      return finish(tool.name, err(error.message, "export_output_limit", { limitBytes: error.limitBytes }), interviewId);
    }
    console.error(`[mcp:${tool.name}] unexpected error`, error instanceof Error ? error.name : "unknown");
    return finish(tool.name, err("That could not be done. Try again in a moment.", "server_error"), interviewId);
  }
}
