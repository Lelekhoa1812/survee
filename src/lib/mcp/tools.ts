import { displayValue, progress } from "../format/answers";
import { LIMITS } from "../format/schema";
import { createQuestionSummaryAccumulator } from "../analytics/summary";
import { getAnalyticsGuidance } from "../analytics/guidance";
import { DESIGN_REVIEW_CHECKLIST, getDesignGuidance, type DesignSurface } from "../design/guidance";
import { EXPORT_FORMATS, exportInterview, type ExportFormat } from "../export";
import { parseEmail } from "../mail/address";
import { checkInviteDelivery } from "../mail/delivery";
import { sendInvite } from "../mail/invite";
import { inviteLink } from "../mail/policy";
import { currentMail } from "../mail/state";
import {
  addParticipants,
  createInterview,
  deleteInterview,
  deleteParticipant,
  getInterview,
  getParticipant,
  getVersion,
  iterateAnalyticsParticipants,
  listInterviews,
  listParticipants,
  listVersions,
  noteMcp,
  publishVersionIfCurrent,
  recentEvents,
  regenerateToken,
  reopenParticipant,
  updateInterview,
  updateParticipant,
} from "../repo";
import { listMailByInterview, listMailByPerson, mailRecord } from "../repo/mail";
import { prepareSurvey, withCompat } from "../survey";
import type { Manifest } from "../format/schema";
import type { ParticipantView } from "../repo/types";
import { ObjectId } from "mongodb";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { sessionSecret } from "../env";
import { currentPrincipal } from "../tenant-context";
import { validateToolArgs } from "./validate";
import { canCallMcpTool, MCP_TOOL_CAPABILITIES, type McpCapability } from "./capabilities";

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

function ok(data: Record<string, unknown>, text?: string): ToolResult {
  return { content: [{ type: "text", text: text ?? JSON.stringify(data) }], structuredContent: data, isError: false };
}
function err(error: string, code?: string): ToolResult {
  return { content: [{ type: "text", text: error }], structuredContent: { ok: false, error, ...(code ? { code } : {}) }, isError: true };
}
function asString(value: unknown, max = 500): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, max) : undefined;
}
function oid(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

function questionList(manifest: Manifest) {
  return manifest.questions.map((q) => ({ id: q.id, type: q.type, label: q.label, required: !!q.required, section: q.section ?? null }));
}

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

const PATCH_PREVIEW_TTL_SECONDS = 10 * 60;

interface PatchPreviewClaims {
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

function fileNameHash(fileName?: string) {
  return sha256(fileName ?? "");
}

function createPatchPreviewToken(bindings: Omit<PatchPreviewClaims, "v" | "exp" | "tenantId">) {
  const tenantId = currentPrincipal()?.tenantId;
  const secret = sessionSecret();
  if (!tenantId || !secret) return null;
  const claims: PatchPreviewClaims = {
    v: 1,
    ...bindings,
    tenantId,
    exp: Math.floor(Date.now() / 1000) + PATCH_PREVIEW_TTL_SECONDS,
  };
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(`kqa-mcp-questionnaire-preview:v1:${payload}`).digest("base64url");
  return { previewToken: `${payload}.${signature}`, previewExpiresAt: new Date(claims.exp * 1000).toISOString() };
}

function verifyPatchPreviewToken(
  token: unknown,
  bindings: Pick<PatchPreviewClaims, "tenantId" | "interviewId" | "expectedVersion" | "baseHash" | "candidateHash" | "fileNameHash">,
): { ok: true; claims: PatchPreviewClaims } | { ok: false; code: "preview_required" | "preview_expired" | "invalid_preview" } {
  if (typeof token !== "string" || !token) return { ok: false, code: "preview_required" };
  const [payload, signature, extra] = token.split(".");
  const secret = sessionSecret();
  if (!payload || !signature || extra !== undefined || !secret) return { ok: false, code: "invalid_preview" };
  const expectedSignature = createHmac("sha256", secret).update(`kqa-mcp-questionnaire-preview:v1:${payload}`).digest("base64url");
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expectedSignature);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return { ok: false, code: "invalid_preview" };
  }
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Partial<PatchPreviewClaims>;
    if (
      claims.v !== 1 || typeof claims.tenantId !== "string" || typeof claims.interviewId !== "string" ||
      typeof claims.expectedVersion !== "number" || !Number.isInteger(claims.expectedVersion) ||
      typeof claims.baseHash !== "string" || typeof claims.candidateHash !== "string" ||
      typeof claims.fileNameHash !== "string" || typeof claims.compatibilityHash !== "string" ||
      typeof claims.exp !== "number" || !Number.isInteger(claims.exp)
    ) return { ok: false, code: "invalid_preview" };
    if (claims.exp <= Math.floor(Date.now() / 1000)) return { ok: false, code: "preview_expired" };
    const parsed = claims as PatchPreviewClaims;
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

function previewTokenError(code: "preview_required" | "preview_expired" | "invalid_preview") {
  if (code === "preview_required") return err("This operation requires the signed previewToken returned by a questionnaire preview.", code);
  if (code === "preview_expired") return err("This questionnaire preview expired. Preview the candidate again before continuing.", code);
  return err("This questionnaire preview is invalid for the current tenant, interview, or candidate. Preview again before continuing.", code);
}

function hasCompatibilityImpact(diagnostics: { code: string }[]) {
  return diagnostics.some((diagnostic) => /^KQA70[0-4]$/.test(diagnostic.code));
}

function hashCompatibilityFindings(diagnostics: { code: string }[]) {
  const findings = diagnostics
    .filter((diagnostic) => /^KQA70[0-4]$/.test(diagnostic.code))
    .map((diagnostic) => JSON.stringify(diagnostic))
    .sort();
  return sha256(JSON.stringify(findings));
}

function shapePerson(person: ParticipantView, manifest: Manifest | null, rows: ReturnType<typeof mailRecord>[]) {
  const mail = currentMail(person, rows);
  const link = inviteLink(person.token);
  const pr = manifest ? progress(manifest, person.answers) : null;
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

async function loadPeople(interviewId: string) {
  const interview = await getInterview(interviewId);
  if (!interview) return null;
  const version = await getVersion(interview._id, interview.currentVersion);
  const people = await listParticipants(interviewId);
  const mail = await listMailByInterview(interview._id);
  const grouped = new Map<string, ReturnType<typeof mailRecord>[]>();
  for (const row of mail) {
    const id = row.participantId.toHexString();
    grouped.set(id, [...(grouped.get(id) ?? []), mailRecord(row)]);
  }
  return { interview, version, people: people.map((p) => shapePerson(p, version?.manifest ?? null, grouped.get(p.id) ?? [])) };
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
    name: "get_analytics_guidance",
    description: "Return deterministic, versioned guidance for interpreting KQA summaries and generating accessible, traceable charts, with primary sources. KQA does not run an LLM.",
    inputSchema: obj({}),
    async run() {
      return ok(getAnalyticsGuidance());
    },
  },
  {
    name: "get_design_guidance",
    description: "Return KQA's sourced, versioned design principles for questionnaires, the host console, or analytics. No LLM is built into KQA.",
    inputSchema: obj({ surface: { type: "string", enum: ["all", "questionnaire", "host", "analytics"] } }),
    async run(args) {
      const surface = (asString(args.surface, 24) || "all") as DesignSurface;
      return ok(getDesignGuidance(surface));
    },
  },
  {
    name: "audit_questionnaire_design",
    description: "Run KQA's static questionnaire checker and return a review checklist for content and rendered design. Wording and pretesting require judgment; this tool does not render or certify the page.",
    inputSchema: obj({ html: str, fileName: str, interviewId: str }, ["html"]),
    async run(args) {
      if (typeof args.html !== "string") return err("html is required.");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.");
      let prepared = prepareSurvey(args.html, asString(args.fileName, 200));
      const interviewId = asString(args.interviewId, 40);
      if (interviewId) prepared = await withCompat(prepared, interviewId);
      return ok({
        ok: prepared.report.ok,
        counts: prepared.report.counts,
        diagnostics: prepared.report.diagnostics,
        report: prepared.markdown,
        reviewChecklist: DESIGN_REVIEW_CHECKLIST,
        limits: ["Static inspection cannot judge question wording or pretesting. It also cannot verify rendered contrast, responsive layout, keyboard operation, motion behavior, or assistive-technology announcements."],
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
      if (typeof args.html !== "string") return err("html is required.");
      if (args.html.length > LIMITS.maxFileBytes) return err("That file is too large.");
      let prepared = prepareSurvey(args.html, asString(args.fileName, 200));
      const interviewId = asString(args.interviewId, 40);
      if (interviewId) prepared = await withCompat(prepared, interviewId);
      return ok({ ok: prepared.report.ok, markdown: prepared.markdown, counts: prepared.report.counts, diagnostics: prepared.report.diagnostics });
    },
  },
  {
    name: "list_people",
    description: "List people on an interview, including email, status, progress, mail state, and private link.",
    inputSchema: obj({ interviewId: str }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const loaded = await loadPeople(id);
      if (!loaded) return err("Interview not found.", "not_found");
      return ok({ people: loaded.people });
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
    description: "Read answers for review. display is the label a host sees. There is no score.",
    inputSchema: obj({ interviewId: str, personId: str, submittedOnly: bool }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const version = await getVersion(interview._id, interview.currentVersion);
      if (!version) return err("Survey version not found.", "not_found");
      const only = asString(args.personId, 40);
      let people = await listParticipants(id);
      if (only) people = people.filter((p) => p.id === only);
      if (args.submittedOnly === true) people = people.filter((p) => p.status === "submitted");
      const rows = people.map((p) => ({
        id: p.id,
        name: p.name,
        status: p.status,
        submittedAt: p.submittedAt ?? null,
        answers: version.manifest.questions.map((q) => {
          const stored = p.answers[q.id];
          return { questionId: q.id, type: q.type, label: q.label, value: stored?.value ?? null, display: displayValue(q, stored?.value), note: stored?.note ?? null, updatedAt: stored?.updatedAt ?? null };
        }),
      }));
      return ok({ interviewStatus: interview.status, people: rows });
    },
  },
  {
    name: "analyze_answers",
    description: "Compute descriptive current-version answer summaries for selected respondent statuses, with explicit scope, denominators, missingness, and caveats. Returns no raw answer text and creates no score.",
    inputSchema: obj({
      interviewId: str,
      questionId: str,
      submittedOnly: bool,
      statuses: { type: "array", items: { type: "string", enum: ["invited", "in_progress", "submitted"] } },
      offset: { type: "integer", minimum: 0 },
      limit: { type: "integer", minimum: 1, maximum: 100 },
    }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      const version = await getVersion(interview._id, interview.currentVersion);
      if (!version) return err("Survey version not found.", "not_found");
      let questions = version.manifest.questions;
      const questionId = asString(args.questionId, 64);
      if (questionId) {
        const question = questions.find((item) => item.id === questionId);
        if (!question) return err("Question not found in the current survey version.", "not_found");
        questions = [question];
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
      const page = questions.slice(offset, offset + limit);
      const accumulators = new Map(page.map((question) => [question.id, createQuestionSummaryAccumulator(question)]));
      let respondentCount = 0;
      let submittedCount = 0;
      for await (const respondent of iterateAnalyticsParticipants(id, page.map((question) => question.id), { statuses })) {
        respondentCount += 1;
        if (respondent.status === "submitted") submittedCount += 1;
        for (const question of page) accumulators.get(question.id)!.add(respondent);
      }
      return ok({
        interviewId: id,
        surveyVersion: version.version,
        asOf: new Date().toISOString(),
        scope: {
          statuses,
          respondentCount,
          submittedCount,
          submittedOnly: statuses.length === 1 && statuses[0] === "submitted",
        },
        questionCount: questions.length,
        offset,
        limit,
        nextOffset: offset + page.length < questions.length ? offset + page.length : null,
        questions: page.map((question) => ({
          id: question.id,
          type: question.type,
          label: question.label,
          ...accumulators.get(question.id)!.finish(),
        })),
        methodology: [
          "Summaries use the current survey version and the respondent statuses shown in scope.",
          "answeredCount counts non-empty stored values, including values that are incompatible with the current version; unmapped values are excluded from valid numeric summaries and distributions.",
          "missingCount uses respondents in scope; distribution percentages use valid answers that match the current options or scale.",
          "For multi-select questions, each option percentage is a share of valid respondents and percentages can sum above 100%.",
          "Number summaries are descriptive; scale questions show a distribution and median without a mean. Text is not interpreted, scored, or returned.",
        ],
      });
    },
  },
  {
    name: "get_status",
    description: "Interview open/closed, version, and per-person progress.",
    inputSchema: obj({ interviewId: str }, ["interviewId"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const loaded = await loadPeople(id);
      if (!loaded) return err("Interview not found.", "not_found");
      const counts = { invited: 0, in_progress: 0, submitted: 0 };
      for (const p of loaded.people) counts[p.status] += 1;
      return ok({
        interviewId: id,
        name: loaded.interview.name,
        status: loaded.interview.status,
        currentVersion: loaded.interview.currentVersion,
        counts,
        people: loaded.people.map((p) => ({ id: p.id, name: p.name, status: p.status, answered: p.answered, total: p.total, requiredMissing: p.requiredMissing, mail: p.mail.state })),
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
      return ok({ events: await recentEvents(id, limit) });
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
          participants: people.map((p) => ({ id: p.id, name: p.name, note: p.note, status: p.status, createdAt: p.createdAt, lastSavedAt: p.lastSavedAt, submittedAt: p.submittedAt, answers: p.answers })),
          generatedAt: new Date().toISOString(),
        },
        format,
      );
      const binary = typeof file.body !== "string";
      const body = typeof file.body === "string" ? file.body : file.body.toString("base64");
      return ok(
        { ok: true, filename: file.filename, contentType: file.contentType, encoding: binary ? "base64" : "utf8", body },
        binary ? `Exported ${file.filename}. The file is base64 in structuredContent.` : body,
      );
    },
  },
  {
    name: "get_mail_status",
    description: "Read stored invite results. Does not open the mailbox.",
    inputSchema: obj({ personId: str, interviewId: str }),
    async run(args) {
      const personId = asString(args.personId, 40);
      const interviewId = asString(args.interviewId, 40);
      if (!personId && !interviewId) return err("personId or interviewId is required.");
      if (personId) {
        const loaded = await onePerson(personId);
        if (!loaded) return err("Person not found.", "not_found");
        return ok({ people: [{ id: loaded.view.id, email: loaded.view.email, mail: loaded.view.mail }] });
      }
      const loaded = await loadPeople(interviewId!);
      if (!loaded) return err("Interview not found.", "not_found");
      return ok({ people: loaded.people.map((p) => ({ id: p.id, name: p.name, email: p.email, mail: p.mail })) });
    },
  },
  {
    name: "create_interview",
    description: "Create an interview from a questionnaire file. A failed check stores nothing.",
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
      if (args.confirmName !== interview.name) return err("Type the interview name exactly to confirm deleting it.");
      await deleteInterview(id);
      return ok({ ok: true });
    },
  },
  {
    name: "preview_questionnaire_version_patch",
    description: "Preview a complete candidate questionnaire HTML file for a new immutable version. This does not store or publish anything.",
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
        report: prepared.markdown,
        changes: prepared.report.manifest ? {
          questionCountBefore: current.manifest.questions.length,
          questionCountAfter: prepared.report.manifest.questions.length,
          questionsBefore: questionList(current.manifest),
          questionsAfter: questionList(prepared.report.manifest),
          sectionsBefore: current.manifest.sections ?? [],
          sectionsAfter: prepared.report.manifest.sections ?? [],
        } : null,
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
    }, ["interviewId", "html", "expectedVersion", "baseHash", "candidateHash"]),
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
      if ("conflict" in published) return err("The questionnaire changed while applying. Preview again before applying.", "stale_preview");
      return ok({ ok: true, interviewId: id, version: published.version, previousVersion: expectedVersion, candidateHash, diagnostics: prepared.report.diagnostics });
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
        if (preview.claims.compatibilityHash !== compatibilityHash || args.compatibilityHash !== compatibilityHash) {
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
    description: "Add people to a multi-user interview. Email is optional. One-person interviews cannot add people.",
    inputSchema: obj({ interviewId: str, people: { type: "array", items: obj({ name: str, email: str, note: str }, ["name"]) } }, ["interviewId", "people"]),
    async run(args) {
      const id = asString(args.interviewId, 40);
      if (!id) return err("interviewId is required.");
      const interview = await getInterview(id);
      if (!interview) return err("Interview not found.", "not_found");
      if (interview.mode !== "multi") return err("This interview is in One person mode, so it has a single link.");
      if (!Array.isArray(args.people)) return err("people must be a list.");
      const people: { name: string; email?: string; note?: string }[] = [];
      for (const raw of args.people.slice(0, 100)) {
        if (!raw || typeof raw !== "object") return err("Each person needs a name.");
        const item = raw as Record<string, unknown>;
        const name = asString(item.name, 120);
        if (!name) return err("Each person needs a name.");
        let email: string | undefined;
        if (item.email !== undefined && item.email !== null && item.email !== "") {
          if (typeof item.email !== "string") return err("That does not look like an email address.");
          const parsed = parseEmail(item.email);
          if (!parsed.ok || !parsed.email) return err(parsed.ok ? "That does not look like an email address." : parsed.error);
          email = parsed.email;
        }
        people.push({ name, email, note: asString(item.note, 1000) });
      }
      if (!people.length) return err("Add at least one person with a name.");
      const created = await addParticipants(id, people);
      const loaded = await loadPeople(id);
      const views = loaded ? created.map((p) => loaded.people.find((row) => row.id === p.id) ?? shapePerson(p, null, [])) : created.map((p) => shapePerson(p, null, []));
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
      if (!person) return err("That person has not submitted, so there is nothing to reopen.");
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
    description: "Email one person their private link. Refuses when they have no email, the interview is closed, or the public URL is unset. Does not send a second message unless resend is true.",
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
      return ok({ result: result.result, to: result.to, sentAt: result.sentAt, interviewId: result.interviewId, personId: result.personId });
    },
  },
  {
    name: "check_invite_delivery",
    description: "Connect briefly over IMAP and look up only the message id KQA stored for this person's current invite. Returns delivered, bounced, or unknown.",
    inputSchema: obj({ personId: str }, ["personId"]),
    guard(args) {
      if ("query" in args || "mailbox" in args || "search" in args || "messageId" in args) {
        return err("Delivery checks only the invites KQA has sent for this person. It does not search a mailbox.");
      }
      return null;
    },
    async run(args) {
      if ("query" in args || "mailbox" in args || "search" in args || "messageId" in args) {
        return err("Delivery checks only the invites KQA has sent for this person. It does not search a mailbox.");
      }
      const id = asString(args.personId, 40);
      if (!id) return err("personId is required.");
      const result = await checkInviteDelivery(id);
      if (!result.ok) return err(result.error, result.code);
      const label = result.delivery === "delivered" ? "Delivered" : result.delivery === "bounced" ? "Bounced" : "Not confirmed yet";
      return ok({ delivery: result.delivery, label, detail: result.detail ?? null, checkedAt: result.checkedAt, personId: result.personId, interviewId: result.interviewId });
    },
  },
];

export function listToolDefs(capabilities?: readonly McpCapability[]) {
  const readOnlyTools = new Set([
    "get_analytics_guidance", "get_design_guidance", "audit_questionnaire_design", "list_interviews", "get_interview",
    "get_survey_html", "list_versions", "check_questionnaire", "list_people", "get_person", "get_answers",
    "analyze_answers", "get_status", "list_events", "export_interview", "get_mail_status",
  ]);
  return TOOLS.filter(({ name }) => canCallMcpTool(name, capabilities)).map(({ name, description, inputSchema }) => {
    const readOnly = readOnlyTools.has(name);
    const destructive = ["delete_interview", "remove_person", "regenerate_link", "apply_questionnaire_version_patch", "upload_survey_version"].includes(name);
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
  await noteMcp(tool, !result.isError, fromResult).catch(() => {});
  return result;
}

export async function dispatchTool(name: string, args: unknown, capabilities?: readonly McpCapability[]): Promise<ToolResult> {
  const tool = TOOLS.find((item) => item.name === name);
  if (!tool) return err(`Unknown tool: ${name}`);
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
  } catch {
    return finish(tool.name, err("That could not be done."), interviewId);
  }
}
