import { createHash } from "node:crypto";
import { BSON, ObjectId, type ClientSession } from "mongodb";
import { col, withMongoTransaction } from "../db";
import { parseEmail } from "../mail/address";
import { evaluateEligibility, exclusiveConflictCount, progress, validateAnswer, validateRepeatFieldValue, type AnswerIssueCode, type RepeatAnswerIssue } from "../format/answers";
import { orderOptions } from "../format/option-order";
import { ID_RE, LIMITS, noteConfig, type AnswerMap, type Manifest, type Question, type RepeatRecordMap, type RepeatRecordOperation } from "../format/schema";
import { newToken } from "../tokens";
import { deleteMailForInterview, deleteMailForPerson } from "./mail";
import { imageAssetPublicIds } from "../image-assets";
import type { AnalyticsRunDoc, InterviewDoc, InterviewMode, InterviewStatus, InterviewSummary, MailResolutionPurpose, ParticipantDoc, ParticipantStatus, ParticipantView, QuestionOrderAssignmentDoc, QuestionOrderAssignmentView, SurveyVersionDoc } from "./types";
import { currentPrincipal, currentTenantId, tenantFilter } from "../tenant-context";
import { AXION_TENANT_ID } from "../env";
import { DEFAULT_PARTICIPANT_PAGE_SIZE, MAX_EXPORT_SOURCE_BYTES, MAX_PARTICIPANT_PAGE_SIZE, MAX_PARTICIPANTS_PER_READ } from "../participant-limits";

export type { InterviewSummary, ParticipantView } from "./types";
export { DEFAULT_PARTICIPANT_PAGE_SIZE, MAX_EXPORT_SOURCE_BYTES, MAX_PARTICIPANT_PAGE_SIZE, MAX_PARTICIPANTS_PER_READ } from "../participant-limits";

const iso = (d?: Date) => (d ? d.toISOString() : undefined);

export function toOid(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

function participantView(p: ParticipantDoc): ParticipantView {
  return {
    id: p._id.toHexString(), interviewId: p.interviewId.toHexString(), token: p.token, name: p.name, email: p.email, note: p.note, status: p.status, answers: p.answers ?? {},
    recordGroups: visibleRecordGroups(p.recordGroups ?? {}),
    revision: p.revision, writeEpoch: p.writeEpoch ?? 0, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(), lastSeenAt: iso(p.lastSeenAt), lastSavedAt: iso(p.lastSavedAt), submittedAt: iso(p.submittedAt),
  };
}

function visibleRecordGroups(groups: RepeatRecordMap): RepeatRecordMap {
  return Object.fromEntries(Object.entries(groups).map(([questionId, rows]) => [questionId, rows.filter((row) => !row.deletedAt)]));
}

async function insertEvent(tenantId: string, interviewId: ObjectId, type: string, participantId: ObjectId | undefined, session: ClientSession, meta?: Record<string, unknown>) {
  await (await col.events()).insertOne({ _id: new ObjectId(), tenantId, interviewId, participantId, type: type as never, at: new Date(), meta }, { session });
}

// ------------------------------------------------------------------------------------------ interviews
export async function listInterviews(): Promise<InterviewSummary[]> {
  const tenantId = await currentTenantId();
  if (!tenantId) return [];
  const [interviews, participants] = await Promise.all([col.interviews(), col.participants()]);
  const docs = await interviews.find(tenantFilter(tenantId)).sort({ updatedAt: -1 }).toArray();
  const agg = await participants
    .aggregate<{ _id: { i: ObjectId; s: ParticipantStatus }; n: number; last: Date }>([
      { $match: tenantFilter(tenantId) },
      { $group: { _id: { i: "$interviewId", s: "$status" }, n: { $sum: 1 }, last: { $max: "$updatedAt" } } },
    ])
    .toArray();
  const statusByInterview = new Map<string, Map<ParticipantStatus, (typeof agg)[number]>>();
  for (const row of agg) {
    const interviewKey = row._id.i.toHexString();
    let statuses = statusByInterview.get(interviewKey);
    if (!statuses) {
      statuses = new Map();
      statusByInterview.set(interviewKey, statuses);
    }
    statuses.set(row._id.s, row);
  }
  return docs.map((d) => {
    const mine = statusByInterview.get(d._id.toHexString());
    const get = (s: ParticipantStatus) => mine?.get(s)?.n ?? 0;
    let last: Date | undefined;
    for (const status of mine?.values() ?? []) {
      if (!last || status.last > last) last = status.last;
    }
    return {
      id: d._id.toHexString(), name: d.name, description: d.description, mode: d.mode, status: d.status, currentVersion: d.currentVersion,
      createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
      counts: { people: get("invited") + get("in_progress") + get("submitted"), invited: get("invited"), inProgress: get("in_progress"), submitted: get("submitted") },
      lastActivityAt: iso(last),
    };
  });
}

export const DEFAULT_INTERVIEW_PAGE_SIZE = 25;
export const MAX_INTERVIEW_PAGE_SIZE = 100;

export class InterviewPageCursorError extends Error {
  constructor() {
    super("cursor must be a valid interview page cursor.");
    this.name = "InterviewPageCursorError";
  }
}

function decodeInterviewCursor(cursor: string): { updatedAt: Date; id: ObjectId } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { updatedAt?: unknown; id?: unknown };
    if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string" || !/^[0-9a-f]{24}$/i.test(parsed.id)) throw new Error();
    const updatedAt = new Date(parsed.updatedAt);
    if (!Number.isFinite(updatedAt.getTime()) || updatedAt.toISOString() !== parsed.updatedAt) throw new Error();
    return { updatedAt, id: new ObjectId(parsed.id) };
  } catch {
    throw new InterviewPageCursorError();
  }
}

export async function listInterviewPage(options: { cursor?: string; limit?: number } = {}): Promise<{ interviews: InterviewSummary[]; nextCursor: string | null; hasMore: boolean }> {
  const limit = options.limit ?? DEFAULT_INTERVIEW_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_INTERVIEW_PAGE_SIZE) throw new RangeError(`limit must be an integer from 1 to ${MAX_INTERVIEW_PAGE_SIZE}.`);
  const tenantId = await currentTenantId();
  if (!tenantId) return { interviews: [], nextCursor: null, hasMore: false };
  const cursor = options.cursor ? decodeInterviewCursor(options.cursor) : null;
  const interviewFilter = cursor
    ? tenantFilter(tenantId, { $or: [{ updatedAt: { $lt: cursor.updatedAt } }, { updatedAt: cursor.updatedAt, _id: { $lt: cursor.id } }] })
    : tenantFilter(tenantId);
  const [interviews, participants] = await Promise.all([col.interviews(), col.participants()]);
  const fetched = await interviews.find(interviewFilter).sort({ updatedAt: -1, _id: -1 }).limit(limit + 1).toArray();
  const hasMore = fetched.length > limit;
  const docs = fetched.slice(0, limit);
  const ids = docs.map((doc) => doc._id);
  const agg = ids.length ? await participants.aggregate<{ _id: { i: ObjectId; s: ParticipantStatus }; n: number; last: Date }>([
    { $match: tenantFilter(tenantId, { interviewId: { $in: ids } }) },
    { $group: { _id: { i: "$interviewId", s: "$status" }, n: { $sum: 1 }, last: { $max: "$updatedAt" } } },
  ]).toArray() : [];
  const statusByInterview = new Map<string, Map<ParticipantStatus, (typeof agg)[number]>>();
  for (const row of agg) {
    const interviewKey = row._id.i.toHexString();
    let statuses = statusByInterview.get(interviewKey);
    if (!statuses) { statuses = new Map(); statusByInterview.set(interviewKey, statuses); }
    statuses.set(row._id.s, row);
  }
  const summaries = docs.map((d) => {
    const mine = statusByInterview.get(d._id.toHexString());
    const get = (s: ParticipantStatus) => mine?.get(s)?.n ?? 0;
    let last: Date | undefined;
    for (const status of mine?.values() ?? []) if (!last || status.last > last) last = status.last;
    return {
      id: d._id.toHexString(), name: d.name, description: d.description, mode: d.mode, status: d.status, currentVersion: d.currentVersion,
      createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
      counts: { people: get("invited") + get("in_progress") + get("submitted"), invited: get("invited"), inProgress: get("in_progress"), submitted: get("submitted") },
      lastActivityAt: iso(last),
    };
  });
  const last = docs.at(-1);
  const nextCursor = hasMore && last ? Buffer.from(JSON.stringify({ updatedAt: last.updatedAt.toISOString(), id: last._id.toHexString() })).toString("base64url") : null;
  return { interviews: summaries, nextCursor, hasMore };
}

/** Aggregate respondent status counts for one interview without loading respondent records. */
export async function getInterviewParticipantCounts(interviewId: string): Promise<{ people: number; invited: number; inProgress: number; submitted: number }> {
  const oid = toOid(interviewId);
  const tenantId = await currentTenantId();
  if (!oid || !tenantId) return { people: 0, invited: 0, inProgress: 0, submitted: 0 };
  const rows = await (await col.participants()).aggregate<{ _id: ParticipantStatus; count: number }>([
    { $match: tenantFilter(tenantId, { interviewId: oid }) },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]).toArray();
  const counts = {
    invited: rows.find((row) => row._id === "invited")?.count ?? 0,
    inProgress: rows.find((row) => row._id === "in_progress")?.count ?? 0,
    submitted: rows.find((row) => row._id === "submitted")?.count ?? 0,
  };
  return { ...counts, people: counts.invited + counts.inProgress + counts.submitted };
}

export async function getInterview(id: string, tenantOverride?: string): Promise<InterviewDoc | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = tenantOverride ?? await currentTenantId();
  if (!tenantId) return null;
  return (await col.interviews()).findOne(tenantFilter(tenantId, { _id: oid }));
}

export async function getVersion(interviewId: ObjectId, version: number, tenantOverride?: string): Promise<SurveyVersionDoc | null> {
  const tenantId = tenantOverride ?? await currentTenantId();
  if (!tenantId) return null;
  return (await col.versions()).findOne(tenantFilter(tenantId, { interviewId, version }));
}

function versionConflict(): { ok: false; status: 409; error: string; code: "questionnaire_version_changed" } {
  return { ok: false, status: 409, error: "This questionnaire was updated while you were answering. Reload the page to continue.", code: "questionnaire_version_changed" };
}

export async function listVersions(interviewId: ObjectId, tenantOverride?: string): Promise<Omit<SurveyVersionDoc, "html">[]> {
  const tenantId = tenantOverride ?? await currentTenantId();
  if (!tenantId) return [];
  return (await col.versions()).find(tenantFilter(tenantId, { interviewId }), { projection: { html: 0 } }).sort({ version: -1 }).toArray();
}

export interface NewSurvey {
  html: string;
  manifest: Manifest;
  fileName?: string;
  check: SurveyVersionDoc["check"];
}

function versionDoc(tenantId: string, interviewId: ObjectId, version: number, s: NewSurvey): SurveyVersionDoc {
  return {
    _id: new ObjectId(), tenantId, interviewId, version, fileName: s.fileName, html: s.html, htmlSha256: createHash("sha256").update(s.html).digest("hex"),
    bytes: Buffer.byteLength(s.html, "utf8"), manifest: s.manifest, check: s.check, createdAt: new Date(),
  };
}

export async function createInterview(input: { name: string; description?: string; mode: InterviewMode; survey: NewSurvey }): Promise<InterviewDoc> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const now = new Date();
  const doc: InterviewDoc = { _id: new ObjectId(), tenantId, name: input.name, description: input.description, mode: input.mode, status: "open", currentVersion: 1, ...(input.mode === "single" ? { respondentWriteRevision: 1 } : {}), createdAt: now, updatedAt: now };
  const initialParticipant: ParticipantDoc | undefined = input.mode === "single" ? {
    _id: new ObjectId(), tenantId, interviewId: doc._id, token: newToken(), name: "Respondent", status: "invited", answers: {}, revision: 0,
    createdAt: now, updatedAt: now,
  } : undefined;
  await withMongoTransaction(async (session) => {
    await (await col.interviews()).insertOne(doc, { session });
    await (await col.versions()).insertOne(versionDoc(tenantId, doc._id, 1, input.survey), { session });
    if (initialParticipant) await (await col.participants()).insertOne(initialParticipant, { session });
    await insertEvent(tenantId, doc._id, "created", undefined, session);
    return true;
  });
  return doc;
}

const MCP_OPERATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type CreateInterviewOperationResult =
  | { kind: "created" | "replayed"; result: CreateInterviewMcpResult }
  | { kind: "conflict" }
  | { kind: "deleted" };
export interface CreateInterviewMcpResult { id: string; interviewId: string; report: Record<string, unknown> }

export type AddPeopleOperationResult = { kind: "created" | "replayed"; people: ParticipantView[] } | { kind: "conflict" } | { kind: "deleted" };

function createInterviewOperationScope(tenantId: string, operation: { operationId: string; credentialId: string }) {
  return {
    tenantId,
    tool: "create_interview",
    credentialIdHash: createHash("sha256").update(operation.credentialId).digest("hex"),
    operationIdHash: createHash("sha256").update(operation.operationId).digest("hex"),
  };
}

function mcpOperationScope(tenantId: string, tool: string, operation: { operationId: string; credentialId: string }) {
  return {
    tenantId,
    tool,
    credentialIdHash: createHash("sha256").update(operation.credentialId).digest("hex"),
    operationIdHash: createHash("sha256").update(operation.operationId).digest("hex"),
  };
}

export async function getAddPeopleOperation(
  operation: { operationId: string; credentialId: string; argumentDigest: string },
): Promise<AddPeopleOperationResult | null> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const existing = await (await col.mcpOperations()).findOne(mcpOperationScope(tenantId, "add_people", operation));
  if (!existing || existing.expiresAt <= new Date()) return null;
  if (existing.deletedAt) return { kind: "deleted" };
  return existing.argumentDigest === operation.argumentDigest
    ? { kind: "replayed", people: existing.result.people as ParticipantView[] }
    : { kind: "conflict" };
}

/** Read a retained successful result before rechecking a caller's retry under newer checker rules. */
export async function getCreateInterviewOperation(
  operation: { operationId: string; credentialId: string; argumentDigest: string },
): Promise<CreateInterviewOperationResult | null> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const existing = await (await col.mcpOperations()).findOne(createInterviewOperationScope(tenantId, operation));
  if (!existing || existing.expiresAt <= new Date()) return null;
  if (existing.deletedAt) return { kind: "deleted" };
  return existing.argumentDigest === operation.argumentDigest
    ? { kind: "replayed", result: existing.result as unknown as CreateInterviewMcpResult }
    : { kind: "conflict" };
}

/** Create an interview and retain its exact MCP response in the same transaction. */
export async function createInterviewWithOperation(
  input: { name: string; description?: string; mode: InterviewMode; survey: NewSurvey },
  operation: { operationId: string; credentialId: string; argumentDigest: string; report: Record<string, unknown> },
): Promise<CreateInterviewOperationResult> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const scope = createInterviewOperationScope(tenantId, operation);
  const now = new Date();
  const doc: InterviewDoc = {
    _id: new ObjectId(), tenantId, name: input.name, description: input.description, mode: input.mode, status: "open", currentVersion: 1,
    ...(input.mode === "single" ? { respondentWriteRevision: 1 } : {}), createdAt: now, updatedAt: now,
  };
  const initialParticipant: ParticipantDoc | undefined = input.mode === "single" ? {
    _id: new ObjectId(), tenantId, interviewId: doc._id, token: newToken(), name: "Respondent", status: "invited", answers: {}, revision: 0,
    createdAt: now, updatedAt: now,
  } : undefined;
  const operations = await col.mcpOperations();
  const run = async () => withMongoTransaction(async (session) => {
    const existing = await operations.findOne(scope, { session });
    if (existing && existing.expiresAt > new Date()) {
      if (existing.deletedAt) return { kind: "deleted" as const };
      return existing.argumentDigest === operation.argumentDigest
        ? { kind: "replayed" as const, result: existing.result as unknown as CreateInterviewMcpResult }
        : { kind: "conflict" as const };
    }
    if (existing) await operations.deleteOne({ _id: existing._id }, { session });

    await (await col.interviews()).insertOne(doc, { session });
    await (await col.versions()).insertOne(versionDoc(tenantId, doc._id, 1, input.survey), { session });
    if (initialParticipant) await (await col.participants()).insertOne(initialParticipant, { session });
    await insertEvent(tenantId, doc._id, "created", undefined, session);
    const interviewId = doc._id.toHexString();
    const result = { id: interviewId, interviewId, report: operation.report };
    const createdAt = new Date();
    await operations.insertOne({
      _id: new ObjectId(), ...scope, interviewId: doc._id, argumentDigest: operation.argumentDigest, result,
      createdAt, expiresAt: new Date(createdAt.getTime() + MCP_OPERATION_TTL_MS),
    }, { session });
    return { kind: "created" as const, result };
  });

  try {
    return await run();
  } catch (error) {
    // A concurrent transaction may win the unique operation-key insert. Resolve
    // that race from the committed record so same-key retries receive its result.
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    const committed = await operations.findOne(scope);
    if (!committed || committed.expiresAt <= new Date()) throw error;
    if (committed.deletedAt) return { kind: "deleted" };
    return committed.argumentDigest === operation.argumentDigest
      ? { kind: "replayed", result: committed.result as unknown as CreateInterviewMcpResult }
      : { kind: "conflict" };
  }
}

export async function updateInterview(id: string, patch: { name?: string; description?: string | null; status?: InterviewStatus }): Promise<InterviewDoc | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  return withMongoTransaction((session) => updateInterviewInSession(tenantId, oid, patch, session));
}

async function updateInterviewInSession(tenantId: string, oid: ObjectId, patch: { name?: string; description?: string | null; status?: InterviewStatus }, session: ClientSession): Promise<InterviewDoc | null> {
  const interviews = await col.interviews();
  const current = await interviews.findOne(tenantFilter(tenantId, { _id: oid }), { session });
  if (!current) return null;
  const set: Partial<InterviewDoc> = { updatedAt: new Date() };
  const unset: Record<string, ""> = {};
  const changed: string[] = [];
  if (patch.name !== undefined && patch.name !== current.name) { set.name = patch.name; changed.push("name"); }
  if (patch.description !== undefined) {
    const nextDescription = patch.description === null || patch.description === "" ? undefined : patch.description;
    if (nextDescription !== current.description) {
      if (nextDescription === undefined) unset.description = "";
      else set.description = nextDescription;
      changed.push("description");
    }
  }
  const statusChanged = patch.status !== undefined && patch.status !== current.status;
  if (statusChanged && patch.status) set.status = patch.status;
  if (!changed.length && !statusChanged) return current;
  const update: Record<string, unknown> = { $set: set, $inc: { respondentWriteRevision: 1 } };
  if (Object.keys(unset).length) update.$unset = unset;
  const res = await interviews.findOneAndUpdate(tenantFilter(tenantId, { _id: oid }), update, { session, returnDocument: "after" });
  if (!res) return null;
  if (statusChanged && patch.status) await insertEvent(tenantId, oid, "status", undefined, session, { status: patch.status });
  if (changed.length) await insertEvent(tenantId, oid, "update", undefined, session, { fields: changed });
  return res;
}

export type UpdateInterviewOperationResult =
  | { kind: "updated"; interviewId: string }
  | { kind: "replayed"; interviewId: string }
  | { kind: "conflict" }
  | { kind: "deleted" }
  | { kind: "not_found" };

export async function getUpdateInterviewOperation(operation: { operationId: string; credentialId: string; argumentDigest: string }): Promise<UpdateInterviewOperationResult | null> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const existing = await (await col.mcpOperations()).findOne(mcpOperationScope(tenantId, "update_interview", operation));
  if (!existing || existing.expiresAt <= new Date()) return null;
  if (existing.deletedAt) return { kind: "deleted" };
  return existing.argumentDigest === operation.argumentDigest
    ? { kind: "replayed", interviewId: String(existing.result.interviewId ?? "") }
    : { kind: "conflict" };
}

/** Update an interview and retain its exact MCP result in the same transaction. */
export async function updateInterviewWithOperation(
  id: string,
  patch: { name?: string; description?: string | null; status?: InterviewStatus },
  operation: { operationId: string; credentialId: string; argumentDigest: string },
): Promise<UpdateInterviewOperationResult> {
  const oid = toOid(id);
  const tenantId = await currentTenantId();
  if (!oid || !tenantId) return { kind: "not_found" };
  const scope = mcpOperationScope(tenantId, "update_interview", operation);
  const operations = await col.mcpOperations();
  const run = async () => withMongoTransaction(async (session) => {
    const existing = await operations.findOne(scope, { session });
    if (existing && existing.expiresAt > new Date()) {
      if (existing.deletedAt) return { kind: "deleted" as const };
      return existing.argumentDigest === operation.argumentDigest
        ? { kind: "replayed" as const, interviewId: String(existing.result.interviewId ?? "") }
        : { kind: "conflict" as const };
    }
    if (existing) await operations.deleteOne({ _id: existing._id }, { session });
    const updated = await updateInterviewInSession(tenantId, oid, patch, session);
    if (!updated) return { kind: "not_found" as const };
    const interviewId = oid.toHexString();
    const createdAt = new Date();
    await operations.insertOne({
      _id: new ObjectId(), ...scope, interviewId: oid, argumentDigest: operation.argumentDigest,
      result: { ok: true, interviewId }, createdAt, expiresAt: new Date(createdAt.getTime() + MCP_OPERATION_TTL_MS),
    }, { session });
    return { kind: "updated" as const, interviewId };
  });
  try {
    return await run();
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    const committed = await operations.findOne(scope);
    if (!committed || committed.expiresAt <= new Date()) throw error;
    if (committed.deletedAt) return { kind: "deleted" };
    return committed.argumentDigest === operation.argumentDigest
      ? { kind: "replayed", interviewId: String(committed.result.interviewId ?? "") }
      : { kind: "conflict" };
  }
}

export async function addVersion(id: string, survey: NewSurvey): Promise<number | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const interview = await getInterview(oid.toHexString(), tenantId);
  if (!interview) return null;
  const current = await getVersion(oid, interview.currentVersion, tenantId);
  if (!current) return null;
  const published = await publishVersionIfCurrent(oid.toHexString(), interview.currentVersion, current.htmlSha256, survey);
  return published && !("conflict" in published) && !("assetUnavailable" in published) ? published.version : null;
}

/** Publish only if the interview still points at the version that was reviewed. */
export async function publishVersionIfCurrent(
  id: string,
  expectedVersion: number,
  expectedBaseHash: string,
  survey: NewSurvey,
  source: "mcp_patch" | "mcp_upload" | "host_patch" = "mcp_patch",
  expectedRespondentRevision?: number,
): Promise<{ version: number } | { conflict: true } | { assetUnavailable: true } | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const version = expectedVersion + 1;
  const publishFilter: Record<string, unknown> = {
    _id: oid,
    currentVersion: expectedVersion,
    ...(expectedRespondentRevision === undefined ? {} : expectedRespondentRevision === 0
      ? { $or: [{ respondentWriteRevision: 0 }, { respondentWriteRevision: { $exists: false } }] }
      : { respondentWriteRevision: expectedRespondentRevision }),
  };
  try {
    const result = await withMongoTransaction(async (session) => {
      const interviews = await col.interviews();
      const versions = await col.versions();
      const interview = await interviews.findOne(tenantFilter(tenantId, publishFilter), { session });
      if (!interview) return { conflict: true as const };
      const current = await versions.findOne(tenantFilter(tenantId, { interviewId: oid, version: expectedVersion }), { session });
      if (!current || current.htmlSha256 !== expectedBaseHash) return { conflict: true as const };

      const changed = await interviews.updateOne(
        tenantFilter(tenantId, publishFilter),
        { $set: { currentVersion: version, updatedAt: new Date() }, $inc: { respondentWriteRevision: 1 } },
        { session },
      );
      if (!changed.modifiedCount) return { conflict: true as const };

      // Touch each referenced asset in the same transaction as the version
      // insert. Deletion checks references and deletes that same row in its
      // transaction, so MongoDB makes concurrent publish/delete operations
      // conflict instead of allowing a dangling published URL.
      const assets = await col.imageAssets();
      for (const publicId of imageAssetPublicIds(survey.html)) {
        const touched = await assets.updateOne(
          tenantFilter(tenantId, { publicId }),
          { $inc: { referenceRevision: 1 } },
          { session },
        );
        if (!touched.matchedCount) throw new MissingImageAssetReferenceError();
      }
      await versions.insertOne(versionDoc(tenantId, oid, version, survey), { session });
      await insertEvent(tenantId, oid, "version", undefined, session, { version, source });
      return { version };
    });
    if ("conflict" in result) return result;
    return result;
  } catch (error) {
    if (error instanceof MissingImageAssetReferenceError) return { assetUnavailable: true };
    // A concurrent publisher may already have claimed this version number.
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return { conflict: true };
    throw error;
  }
}

class MissingImageAssetReferenceError extends Error {}

export async function deleteInterview(id: string): Promise<boolean | "invite_pending"> {
  const oid = toOid(id);
  if (!oid) return false;
  const tenantId = await currentTenantId();
  if (!tenantId) return false;
  return withMongoTransaction(async (session) => {
    const interviews = await col.interviews();
    const interview = await interviews.findOne(tenantFilter(tenantId, { _id: oid }), { session, projection: { _id: 1 } });
    if (!interview) return false;
    const pendingInvite = await (await col.mail()).findOne(
      tenantFilter(tenantId, { interviewId: oid, status: "pending", delivery: { $nin: ["delivered", "bounced"] } }),
      { session, projection: { _id: 1 } },
    );
    if (pendingInvite) return "invite_pending";
    const res = await interviews.deleteOne(tenantFilter(tenantId, { _id: oid }), { session });
    if (!res.deletedCount) return false;

    // MongoDB does not support parallel operations in one transaction. Keep the cascade
    // sequential so a failed dependent delete rolls the parent removal back as well.
    await (await col.mcpOperations()).updateMany(
      tenantFilter(tenantId, { interviewId: oid }),
      { $set: { result: { deleted: true }, deletedAt: new Date() }, $unset: { participantIds: "", interviewId: "", argumentDigest: "" } },
      { session },
    );
    await (await col.versions()).deleteMany(tenantFilter(tenantId, { interviewId: oid }), { session });
    await (await col.participants()).deleteMany(tenantFilter(tenantId, { interviewId: oid }), { session });
    await (await col.questionOrderAssignments()).deleteMany(tenantFilter(tenantId, { interviewId: oid }), { session });
    await (await col.events()).deleteMany(tenantFilter(tenantId, { interviewId: oid }), { session });
    await (await col.analyticsRuns()).deleteMany({ tenantId, interviewId: oid }, { session });
    await deleteMailForInterview(oid, session);
    await (await col.questionnaireReviewDrafts()).deleteMany(tenantFilter(tenantId, { interviewId: oid }), { session });
    return true;
  });
}

// ------------------------------------------------------------------------------------------ participants
export class ParticipantReadLimitError extends Error {
  readonly limit = MAX_PARTICIPANTS_PER_READ;

  constructor() {
    super(`This interview has more than ${MAX_PARTICIPANTS_PER_READ} people. Full export and interview-wide answer reads currently support at most ${MAX_PARTICIPANTS_PER_READ}; use a single-person read, bounded participant pages, or aggregate analysis where possible.`);
    this.name = "ParticipantReadLimitError";
  }
}

export class ParticipantExportSizeLimitError extends Error {
  readonly limitBytes: number;
  constructor(limitBytes = MAX_EXPORT_SOURCE_BYTES, streamPage = false) {
    super(streamPage
      ? `A streamed CSV page exceeds the ${Math.floor(limitBytes / (1024 * 1024))} MiB participant and presentation-history page limit.`
      : `This interview's answer and presentation-history data is too large for a buffered export. Buffered exports support up to ${Math.floor(limitBytes / (1024 * 1024))} MiB of source data; use streamed CSV where available.`);
    this.limitBytes = limitBytes;
    this.name = "ParticipantExportSizeLimitError";
  }
}

export class ParticipantCursorError extends Error {
  constructor() {
    super("That participant page cursor is invalid or expired. Reload the participant list and try again.");
    this.name = "ParticipantCursorError";
  }
}

function encodeParticipantCursor(participant: ParticipantView): string {
  return Buffer.from(JSON.stringify({ createdAt: participant.createdAt, id: participant.id })).toString("base64url");
}

function decodeParticipantCursor(cursor: string): { createdAt: Date; id: ObjectId } {
  try {
    if (cursor.length > 256) throw new Error("oversized");
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { createdAt?: unknown; id?: unknown };
    const id = typeof value.id === "string" ? toOid(value.id) : null;
    const createdAt = typeof value.createdAt === "string" ? new Date(value.createdAt) : new Date(NaN);
    if (!id || !Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== value.createdAt) throw new Error("invalid");
    return { createdAt, id };
  } catch {
    throw new ParticipantCursorError();
  }
}

async function readQuestionOrderAssignments(
  tenantId: string,
  interviewId: ObjectId,
  participantIds: ObjectId[],
  maxBytes?: number,
  streamPage = false,
): Promise<QuestionOrderAssignmentDoc[]> {
  if (!participantIds.length) return [];
  const cursor = (await col.questionOrderAssignments()).find(tenantFilter(tenantId, {
    interviewId, participantId: { $in: participantIds },
  }), { projection: { participantId: 1, surveyVersion: 1, algorithmVersion: 1, groups: 1, assignedAt: 1 } }).sort({ surveyVersion: 1 });
  const rows: QuestionOrderAssignmentDoc[] = [];
  let bytes = 0;
  try {
    for await (const assignment of cursor) {
      if (maxBytes !== undefined) {
        bytes += BSON.calculateObjectSize(assignment);
        if (bytes > maxBytes) throw new ParticipantExportSizeLimitError(maxBytes, streamPage);
      }
      rows.push(assignment);
    }
  } finally {
    await cursor.close();
  }
  return rows;
}

/** Read one bounded participant page in stable tenant-scoped order. */
export async function listParticipantPage(
  interviewId: string,
  cursor: string | null = null,
  requestedLimit = DEFAULT_PARTICIPANT_PAGE_SIZE,
  submittedOnly = false,
  includeOrderAssignments = true,
  maxSourceBytes?: number,
): Promise<{ people: ParticipantView[]; nextCursor: string | null }> {
  const oid = toOid(interviewId);
  if (!oid) return { people: [], nextCursor: null };
  const tenantId = await currentTenantId();
  if (!tenantId) return { people: [], nextCursor: null };
  const limit = Math.max(1, Math.min(MAX_PARTICIPANT_PAGE_SIZE, Math.floor(requestedLimit) || DEFAULT_PARTICIPANT_PAGE_SIZE));
  const participants = await col.participants();
  const filter: Record<string, unknown> = { interviewId: oid, ...(submittedOnly ? { status: "submitted" } : {}) };
  let participantSourceBytes = 0;
  if (cursor !== null) {
    const anchor = decodeParticipantCursor(cursor);
    filter.$or = [
      { createdAt: { $lt: anchor.createdAt } },
      { createdAt: anchor.createdAt, _id: { $lt: anchor.id } },
    ];
  }
  let docs: ParticipantDoc[];
  if (maxSourceBytes !== undefined) {
    const rows = await participants.aggregate<{ docs: ParticipantDoc[]; summary: { sourceBytes: number }[] }>([
      { $match: tenantFilter(tenantId, filter) },
      { $sort: { createdAt: -1, _id: -1 } },
      { $limit: limit + 1 },
      { $set: { _pageDocBytes: { $bsonSize: "$$ROOT" } } },
      { $setWindowFields: { output: { _pageSourceBytes: { $sum: "$_pageDocBytes", window: { documents: ["unbounded", "unbounded"] } } } } },
      { $facet: {
        docs: [
          { $match: { $expr: { $lte: ["$_pageSourceBytes", maxSourceBytes] } } },
          { $unset: ["_pageSourceBytes", "_pageDocBytes"] },
        ],
        summary: [{ $group: { _id: null, sourceBytes: { $max: "$_pageSourceBytes" } } }],
      } },
    ]).toArray();
    const page = rows[0];
    if ((page?.summary[0]?.sourceBytes ?? 0) > maxSourceBytes) throw new ParticipantExportSizeLimitError(maxSourceBytes, true);
    participantSourceBytes = page?.summary[0]?.sourceBytes ?? 0;
    docs = page?.docs ?? [];
  } else {
    docs = await participants.find(tenantFilter(tenantId, filter)).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
  }
  const hasMore = docs.length > limit;
  const pageDocs = hasMore ? docs.slice(0, limit) : docs;
  if (!pageDocs.length) return { people: [], nextCursor: null };
  const byParticipant = new Map<string, QuestionOrderAssignmentView[]>();
  if (includeOrderAssignments) {
    const assignmentBudget = maxSourceBytes === undefined ? undefined : Math.max(0, maxSourceBytes - participantSourceBytes);
    const assignments = await readQuestionOrderAssignments(tenantId, oid, pageDocs.map((doc) => doc._id), assignmentBudget, true);
    for (const assignment of assignments) {
      const id = assignment.participantId.toHexString();
      const rows = byParticipant.get(id) ?? [];
      rows.push({ surveyVersion: assignment.surveyVersion, algorithmVersion: assignment.algorithmVersion, groups: assignment.groups, assignedAt: assignment.assignedAt.toISOString() });
      byParticipant.set(id, rows);
    }
  }
  const people = pageDocs.map((doc) => ({
    ...participantView(doc),
    ...(byParticipant.has(doc._id.toHexString()) ? { questionOrderAssignments: byParticipant.get(doc._id.toHexString()) } : {}),
  }));
  return { people, nextCursor: hasMore ? encodeParticipantCursor(people[people.length - 1]) : null };
}

export async function listParticipants(interviewId: string): Promise<ParticipantView[]> {
  const oid = toOid(interviewId);
  if (!oid) return [];
  const tenantId = await currentTenantId();
  if (!tenantId) return [];
  const participants = await col.participants();
  const exportData = await participants.aggregate<{ summary: { count: number; bytes: number; cohortCount: number; cohortBytes: number }[]; docs: ParticipantDoc[] }>([
    { $match: tenantFilter(tenantId, { interviewId: oid }) },
    { $set: { __exportDocBytes: { $bsonSize: "$$ROOT" } } },
    {
      $setWindowFields: {
        sortBy: { createdAt: 1, _id: 1 },
        output: {
          __exportCohortCount: { $sum: 1, window: { documents: ["unbounded", "unbounded"] } },
          __exportCohortBytes: { $sum: "$__exportDocBytes", window: { documents: ["unbounded", "unbounded"] } },
        },
      },
    },
    {
      $facet: {
        summary: [{ $group: { _id: null, count: { $sum: 1 }, bytes: { $sum: "$__exportDocBytes" }, cohortCount: { $max: "$__exportCohortCount" }, cohortBytes: { $max: "$__exportCohortBytes" } } }],
        docs: [
          { $match: { $expr: { $and: [{ $lte: ["$__exportCohortCount", MAX_PARTICIPANTS_PER_READ] }, { $lte: ["$__exportCohortBytes", MAX_EXPORT_SOURCE_BYTES] }] } } },
          { $sort: { createdAt: 1, _id: 1 } },
          { $project: { __exportDocBytes: 0, __exportCohortCount: 0, __exportCohortBytes: 0 } },
        ],
      },
    },
  ]).toArray();
  const summary = exportData[0]?.summary[0];
  if ((summary?.cohortCount ?? summary?.count ?? 0) > MAX_PARTICIPANTS_PER_READ) throw new ParticipantReadLimitError();
  if ((summary?.cohortBytes ?? summary?.bytes ?? 0) > MAX_EXPORT_SOURCE_BYTES) throw new ParticipantExportSizeLimitError();
  // The aggregation returns payload documents only when the whole cohort fits both limits.
  const docs = exportData[0]?.docs ?? [];
  if (!docs.length) return [];
  const assignmentBudget = Math.max(0, MAX_EXPORT_SOURCE_BYTES - (summary?.cohortBytes ?? summary?.bytes ?? 0));
  const assignments = await readQuestionOrderAssignments(tenantId, oid, docs.map((doc) => doc._id), assignmentBudget);
  const byParticipant = new Map<string, QuestionOrderAssignmentView[]>();
  for (const assignment of assignments) {
    const id = assignment.participantId.toHexString();
    const rows = byParticipant.get(id) ?? [];
    rows.push({ surveyVersion: assignment.surveyVersion, algorithmVersion: assignment.algorithmVersion, groups: assignment.groups, assignedAt: assignment.assignedAt.toISOString() });
    byParticipant.set(id, rows);
  }
  return docs.map((doc) => ({ ...participantView(doc), ...(byParticipant.has(doc._id.toHexString()) ? { questionOrderAssignments: byParticipant.get(doc._id.toHexString()) } : {}) }));
}

/** Persist the first respondent-facing assignment for an immutable survey version. */
export async function ensureQuestionOrderAssignment(input: {
  tenantId: string;
  interviewId: string;
  participantId: string;
  surveyVersion: number;
  algorithmVersion: string;
  groups: Record<string, string[]>;
}): Promise<QuestionOrderAssignmentView> {
  const interviewId = toOid(input.interviewId);
  const participantId = toOid(input.participantId);
  if (!interviewId || !participantId) throw new Error("Cannot assign question order to an invalid participant or interview.");
  const collection = await col.questionOrderAssignments();
  const filter = { tenantId: input.tenantId, interviewId, participantId, surveyVersion: input.surveyVersion };
  const asView = (doc: QuestionOrderAssignmentDoc) => ({ surveyVersion: doc.surveyVersion, algorithmVersion: doc.algorithmVersion, groups: doc.groups, assignedAt: doc.assignedAt.toISOString() });
  try {
    return await withMongoTransaction(async (session) => {
      const existing = await collection.findOne(filter, { session });
      if (existing) return asView(existing);
      const participant = await (await col.participants()).findOne(tenantFilter(input.tenantId, { _id: participantId, interviewId }), { session, projection: { _id: 1 } });
      if (!participant) throw new Error("Cannot assign question order to a deleted participant.");
      const assignedAt = new Date();
      const doc = {
        _id: new ObjectId(), tenantId: input.tenantId, interviewId, participantId,
        surveyVersion: input.surveyVersion, algorithmVersion: input.algorithmVersion,
        groups: input.groups, assignedAt,
      };
      await collection.insertOne(doc, { session });
      const touched = await (await col.interviews()).updateOne(
        tenantFilter(input.tenantId, { _id: interviewId }),
        { $inc: { respondentWriteRevision: 1 } },
        { session },
      );
      if (!touched.matchedCount) throw new Error("Cannot assign question order to a deleted interview.");
      return asView(doc);
    });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    const existing = await collection.findOne(filter);
    if (existing) return asView(existing);
    throw error;
  }
}

export interface AnalyticsParticipant {
  status: ParticipantStatus;
  answers: AnswerMap;
  recordGroups?: RepeatRecordMap;
}

export interface AnalyticsParticipantScope {
  statuses?: ParticipantStatus[];
}

export type AnalyticsRunCreateResult =
  | { ok: true; id: string; expiresAt: string }
  | { ok: false; reason: "too_large" | "capacity" | "stale" };

const ANALYTICS_RUN_TTL_MS = 60 * 60 * 1000;
const ANALYTICS_RUN_MAX_BYTES = 1024 * 1024;
const ANALYTICS_RUN_SLOTS_PER_TENANT = 10;
const MAX_REPEAT_ROW_HISTORY_PER_PARTICIPANT = 2000;

/** Store an aggregate-only page set with bounded size, lifetime, and per-tenant concurrency. */
export async function createAnalyticsRun(
  interviewId: string,
  surveyVersion: number,
  result: Record<string, unknown>,
  expectedRespondentRevision?: number,
): Promise<AnalyticsRunCreateResult | null> {
  const oid = toOid(interviewId);
  if (!oid || !Number.isInteger(surveyVersion) || surveyVersion < 1) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  let serialized: string;
  try {
    serialized = JSON.stringify(result);
  } catch {
    return { ok: false, reason: "too_large" };
  }
  if (Buffer.byteLength(serialized, "utf8") > ANALYTICS_RUN_MAX_BYTES) return { ok: false, reason: "too_large" };

  const runs = await col.analyticsRuns();
  const interviews = await col.interviews();
  const now = new Date();
  await runs.deleteMany({ tenantId, expiresAt: { $lte: now } });
  for (let slot = 0; slot < ANALYTICS_RUN_SLOTS_PER_TENANT; slot += 1) {
    const doc: AnalyticsRunDoc = {
      _id: new ObjectId(), tenantId, interviewId: oid, slot, surveyVersion,
      createdAt: now, expiresAt: new Date(now.getTime() + ANALYTICS_RUN_TTL_MS), result,
    };
    try {
      const stored = await withMongoTransaction(async (session) => {
        const filter: Record<string, unknown> = { _id: oid, currentVersion: surveyVersion };
        if (expectedRespondentRevision !== undefined) {
          if (!Number.isSafeInteger(expectedRespondentRevision) || expectedRespondentRevision < 0) return "stale" as const;
          filter.respondentWriteRevision = expectedRespondentRevision === 0
            ? { $in: [null, 0] }
            : expectedRespondentRevision;
        }
        const touched = await interviews.updateOne(
          tenantFilter(tenantId, filter),
          { $inc: { analyticsRunRevision: 1 } },
          { session },
        );
        if (!touched.matchedCount) return "stale" as const;
        await runs.insertOne(doc, { session });
        return "stored" as const;
      });
      if (stored === "stale") return { ok: false, reason: "stale" };
      return { ok: true, id: doc._id.toHexString(), expiresAt: doc.expiresAt.toISOString() };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === 11000) continue;
      throw error;
    }
  }
  return { ok: false, reason: "capacity" };
}

/** Runs are strictly tenant-scoped, even while legacy interview records are being migrated. */
export async function getAnalyticsRun(id: string, interviewId: string): Promise<Pick<AnalyticsRunDoc, "result" | "surveyVersion" | "expiresAt"> | null> {
  const runOid = toOid(id);
  const interviewOid = toOid(interviewId);
  const tenantId = await currentTenantId();
  if (!runOid || !interviewOid || !tenantId) return null;
  const run = await (await col.analyticsRuns()).findOne({ _id: runOid, tenantId, interviewId: interviewOid, expiresAt: { $gt: new Date() } });
  return run ? { result: run.result, surveyVersion: run.surveyVersion, expiresAt: run.expiresAt } : null;
}

/**
 * Stream only the selected answer fields and status for analytics. Identity, private links,
 * raw note content, timestamps, and answers to unrelated questions never leave this repository helper.
 */
export async function* iterateAnalyticsParticipants(
  interviewId: string,
  questionIds: string[],
  scope: boolean | AnalyticsParticipantScope = false,
): AsyncGenerator<AnalyticsParticipant> {
  const oid = toOid(interviewId);
  if (!oid) return;
  const projection: Record<string, 0 | 1> = { _id: 0, status: 1 };
  const selectedQuestionIds = [...new Set(questionIds)].filter((questionId) => ID_RE.test(questionId));
  for (const questionId of selectedQuestionIds) {
    projection[`answers.${questionId}.value`] = 1;
    projection[`answers.${questionId}.note`] = 1;
    projection[`recordGroups.${questionId}.deletedAt`] = 1;
  }
  const defaultStatuses: ParticipantStatus[] = ["invited", "in_progress", "submitted"];
  const statuses = typeof scope === "boolean"
    ? scope ? ["submitted" as const] : defaultStatuses
    : scope.statuses ?? defaultStatuses;
  const statusFilter = statuses.length === 1 ? statuses[0] : { $in: statuses };
  const tenantId = await currentTenantId();
  if (!tenantId) return;
  const filter = tenantFilter(tenantId, { interviewId: oid, status: statusFilter });
  const cursor = (await col.participants()).find(filter, { projection }).batchSize(250);
  try {
    for await (const participant of cursor) {
      const answers: AnswerMap = {};
      for (const questionId of selectedQuestionIds) {
        const stored = participant.answers?.[questionId];
        if (!stored) continue;
        answers[questionId] = {
          ...(stored.value === undefined ? {} : { value: stored.value }),
          ...(typeof stored.note === "string" && stored.note.trim() ? { note: "present" } : {}),
          updatedAt: "",
        };
      }
      const recordGroups: RepeatRecordMap = {};
      for (const questionId of selectedQuestionIds) {
        if (participant.recordGroups?.[questionId]?.some((row) => !row.deletedAt)) {
          // Only existence affects routing; do not expose row IDs or field values to analytics.
          recordGroups[questionId] = [{ id: "present", values: {}, revision: 0, fieldRevisions: {} }];
        }
      }
      yield { status: participant.status, answers, ...(Object.keys(recordGroups).length ? { recordGroups } : {}) };
    }
  } finally {
    await cursor.close();
  }
}

export async function addParticipants(interviewId: string, people: { name: string; note?: string; email?: string }[]): Promise<ParticipantView[]> {
  const result = await addParticipantsCore(interviewId, people);
  return Array.isArray(result) ? result : [];
}

export async function addParticipantsWithOperation(
  interviewId: string,
  people: { name: string; note?: string; email?: string }[],
  operation: { operationId: string; credentialId: string; argumentDigest: string },
): Promise<AddPeopleOperationResult> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const scope = mcpOperationScope(tenantId, "add_people", operation);
  const operations = await col.mcpOperations();
  const existing = await operations.findOne(scope);
  if (existing && existing.expiresAt > new Date()) {
    if (existing.deletedAt) return { kind: "deleted" };
    return existing.argumentDigest === operation.argumentDigest
      ? { kind: "replayed", people: existing.result.people as ParticipantView[] }
      : { kind: "conflict" };
  }
  const result = await addParticipantsCore(interviewId, people, { scope, argumentDigest: operation.argumentDigest });
  return Array.isArray(result) ? { kind: "conflict" } : result;
}

async function addParticipantsCore(
  interviewId: string,
  people: { name: string; note?: string; email?: string }[],
  operation?: { scope: ReturnType<typeof mcpOperationScope>; argumentDigest: string },
): Promise<ParticipantView[] | AddPeopleOperationResult> {
  const oid = toOid(interviewId);
  if (!oid || people.length === 0) return operation ? { kind: "conflict" } : [];
  const tenantId = await currentTenantId();
  if (!tenantId) return operation ? { kind: "conflict" } : [];
  const now = new Date();
  const docs: ParticipantDoc[] = people.map((p, i) => {
    const parsed = p.email ? parseEmail(p.email) : { ok: true as const, email: null };
    if (!parsed.ok) throw new Error("Invalid email");
    return {
      _id: new ObjectId(), tenantId, interviewId: oid, token: newToken(), name: p.name.trim().slice(0, 120) || "Respondent", note: p.note?.trim().slice(0, 1000) || undefined,
      email: parsed.email ?? undefined,
      status: "invited" as const, answers: {}, revision: 0, createdAt: new Date(now.getTime() + i), updatedAt: now,
    };
  });
  const run = async () => withMongoTransaction(async (session) => {
    if (operation) {
      const operations = await col.mcpOperations();
      const existing = await operations.findOne(operation.scope, { session });
      if (existing && existing.expiresAt > new Date()) {
        if (existing.deletedAt) return { kind: "deleted" as const };
        return existing.argumentDigest === operation.argumentDigest
          ? { kind: "replayed" as const, people: existing.result.people as ParticipantView[] }
          : { kind: "conflict" as const };
      }
      if (existing) await operations.deleteOne({ _id: existing._id }, { session });
    }
    const interviews = await col.interviews();
    const promoted = await interviews.updateOne(
      tenantFilter(tenantId, { _id: oid, mode: "single" }),
      { $set: { mode: "multi" } },
      { session },
    );
    const touched = await interviews.updateOne(
      tenantFilter(tenantId, { _id: oid }),
      { $set: { updatedAt: now }, $inc: { respondentWriteRevision: 1 } },
      { session },
    );
    if (!touched.matchedCount) return operation ? { kind: "conflict" as const } : false;
    await (await col.participants()).insertMany(docs, { session });
    if (promoted.modifiedCount) await insertEvent(tenantId, oid, "update", undefined, session, { fields: ["mode"] });
    const views = docs.map(participantView);
    if (operation) {
      const createdAt = new Date();
      await (await col.mcpOperations()).insertOne({
        _id: new ObjectId(), ...operation.scope, interviewId: oid, participantIds: docs.map((doc) => doc._id), argumentDigest: operation.argumentDigest,
        result: { people: views }, createdAt, expiresAt: new Date(createdAt.getTime() + MCP_OPERATION_TTL_MS),
      }, { session });
      return { kind: "created" as const, people: views };
    }
    return true;
  });
  let added: Awaited<ReturnType<typeof run>>;
  try {
    added = await run();
  } catch (error) {
    if (!operation || !(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    const committed = await (await col.mcpOperations()).findOne(operation.scope);
    if (!committed || committed.expiresAt <= new Date()) throw error;
    if (committed.deletedAt) return { kind: "deleted" };
    return committed.argumentDigest === operation.argumentDigest
      ? { kind: "replayed", people: committed.result.people as ParticipantView[] }
      : { kind: "conflict" };
  }
  if (operation) {
    return added && typeof added === "object" && !Array.isArray(added) ? added as AddPeopleOperationResult : { kind: "conflict" };
  }
  return added === true ? docs.map(participantView) : [];
}

export async function getParticipant(id: string): Promise<ParticipantView | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const doc = await (await col.participants()).findOne(tenantFilter(tenantId, { _id: oid }));
  return doc ? participantView(doc) : null;
}

export async function updateParticipant(id: string, patch: { name?: string; note?: string | null; email?: string | null }): Promise<ParticipantView | null | "invite_pending"> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const set: Partial<ParticipantDoc> = { updatedAt: new Date() };
  const unset: Record<string, ""> = {};
  let nextEmail: string | null | undefined;
  if (patch.name !== undefined) set.name = patch.name.trim().slice(0, 120) || "Respondent";
  if (patch.note !== undefined) {
    if (patch.note === null || patch.note.trim() === "") unset.note = "";
    else set.note = patch.note.trim().slice(0, 1000);
  }
  if (patch.email !== undefined) {
    if (patch.email === null || patch.email.trim() === "") {
      nextEmail = null;
      unset.email = "";
    }
    else {
      const parsed = parseEmail(patch.email);
      if (!parsed.ok || !parsed.email) throw new Error("Invalid email");
      nextEmail = parsed.email;
      set.email = parsed.email;
    }
  }
  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length) update.$unset = unset;
  return withMongoTransaction(async (session) => {
    const participants = await col.participants();
    const current = await participants.findOne(tenantFilter(tenantId, { _id: oid }), { session, projection: { email: 1, interviewId: 1 } });
    if (!current) return null;
    const currentEmail = typeof current.email === "string" ? current.email.trim().toLowerCase() : null;
    if (nextEmail !== undefined && currentEmail !== nextEmail) {
      const pendingInvite = await (await col.mail()).findOne(
        tenantFilter(tenantId, { participantId: oid, status: "pending", delivery: { $nin: ["delivered", "bounced"] }, resolution: { $exists: false } }),
        { session, projection: { _id: 1 } },
      );
      if (pendingInvite) return "invite_pending";
    }
    const res = await participants.findOneAndUpdate(tenantFilter(tenantId, { _id: oid }), update, { session, returnDocument: "after" });
    if (!res) return null;
    const touched = await (await col.interviews()).updateOne(
      tenantFilter(tenantId, { _id: res.interviewId }),
      { $inc: { respondentWriteRevision: 1 } },
      { session },
    );
    if (!touched.matchedCount) throw new Error("Could not update respondent revision for interview.");
    await insertEvent(tenantId, res.interviewId, "update", res._id, session, { fields: Object.keys(patch).sort() });
    return participantView(res);
  });
}

export async function deleteParticipant(id: string): Promise<boolean | "invite_pending"> {
  const oid = toOid(id);
  if (!oid) return false;
  const tenantId = await currentTenantId();
  if (!tenantId) return false;
  const deleted = await withMongoTransaction(async (session) => {
    const participants = await col.participants();
    const participant = await participants.findOne(tenantFilter(tenantId, { _id: oid }), { session, projection: { interviewId: 1 } });
    if (!participant) return false;
    const pendingInvite = await (await col.mail()).findOne(
      { participantId: oid, status: "pending", delivery: { $nin: ["delivered", "bounced"] } },
      { session, projection: { _id: 1 } },
    );
    if (pendingInvite) return "invite_pending";
    const res = await participants.deleteOne(tenantFilter(tenantId, { _id: oid }), { session });
    if (!res.deletedCount) return false;
    await (await col.mcpOperations()).updateMany(
      tenantFilter(tenantId, { participantIds: oid }),
      { $set: { result: { deleted: true }, deletedAt: new Date() }, $unset: { participantIds: "", interviewId: "", argumentDigest: "" } },
      { session },
    );
    // Cache creation writes this same interview row and checks its pre-scan
    // respondent revision. This makes concurrent analysis creation retry or
    // fail stale instead of recreating an aggregate containing the erased person.
    await (await col.interviews()).updateOne(
      tenantFilter(tenantId, { _id: participant.interviewId }),
      { $inc: { respondentWriteRevision: 1 } },
      { session },
    );
    await (await col.questionOrderAssignments()).deleteMany(tenantFilter(tenantId, { participantId: oid }), { session });
    // Mongo _id values are globally unique, so this exact relationship also
    // removes legacy event rows that predate tenantId without crossing tenants.
    await (await col.events()).deleteMany({ participantId: oid }, { session });
    await deleteMailForPerson(oid, session);
    await (await col.analyticsRuns()).deleteMany(tenantFilter(tenantId, { interviewId: participant.interviewId }), { session });
    return true;
  });
  return deleted;
}

export async function regenerateToken(id: string): Promise<string | null | "invite_pending"> {
  const result = await regenerateTokenCore(id);
  return result === null || result === "invite_pending" ? result : result === "conflict" || result.kind === "deleted" ? null : result.token;
}

export type RegenerateLinkOperationResult =
  | { kind: "rotated" | "replayed"; token: string; interviewId: string }
  | { kind: "conflict" }
  | { kind: "not_found" }
  | { kind: "invite_pending" }
  | { kind: "deleted" };

export async function getRegenerateLinkOperation(operation: { operationId: string; credentialId: string; argumentDigest: string }): Promise<RegenerateLinkOperationResult | null> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const existing = await (await col.mcpOperations()).findOne(mcpOperationScope(tenantId, "regenerate_link", operation));
  if (!existing || existing.expiresAt <= new Date()) return null;
  if (existing.deletedAt) return { kind: "deleted" };
  return existing.argumentDigest === operation.argumentDigest
    ? { ...(existing.result as { token: string; interviewId: string }), kind: "replayed" }
    : { kind: "conflict" };
}

export async function regenerateTokenWithOperation(id: string, operation: { operationId: string; credentialId: string; argumentDigest: string }): Promise<RegenerateLinkOperationResult> {
  const tenantId = await currentTenantId();
  if (!tenantId) throw new Error("An authenticated tenant is required.");
  const scope = mcpOperationScope(tenantId, "regenerate_link", operation);
  const existing = await (await col.mcpOperations()).findOne(scope);
  if (existing && existing.expiresAt > new Date()) {
    if (existing.deletedAt) return { kind: "deleted" };
    return existing.argumentDigest === operation.argumentDigest
      ? { ...(existing.result as { token: string; interviewId: string }), kind: "replayed" }
      : { kind: "conflict" };
  }
  const rotated = await regenerateTokenCore(id, { scope, argumentDigest: operation.argumentDigest });
  if (!rotated) return { kind: "not_found" };
  if (rotated === "invite_pending") return { kind: "invite_pending" };
  if (rotated === "conflict") return { kind: "conflict" };
  if (typeof rotated === "object" && rotated.kind === "deleted") return { kind: "deleted" };
  return rotated;
}

async function regenerateTokenCore(
  id: string,
  operation?: { scope: ReturnType<typeof mcpOperationScope>; argumentDigest: string },
): Promise<{ token: string; interviewId: string; kind: "rotated" | "replayed" } | null | "invite_pending" | "conflict" | { kind: "deleted" }> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const token = newToken();
  const run = async () => withMongoTransaction(async (session) => {
    if (operation) {
      const operations = await col.mcpOperations();
      const existing = await operations.findOne(operation.scope, { session });
      if (existing && existing.expiresAt > new Date()) {
        if (existing.deletedAt) return { kind: "deleted" as const };
        return existing.argumentDigest === operation.argumentDigest
          ? { ...(existing.result as { token: string; interviewId: string }), kind: "replayed" as const }
          : "conflict" as const;
      }
      if (existing) await operations.deleteOne({ _id: existing._id }, { session });
    }
    const participants = await col.participants();
    const current = await participants.findOne(tenantFilter(tenantId, { _id: oid }), { session, projection: { _id: 1, interviewId: 1 } });
    if (!current) return null;
    const pendingInvite = await (await col.mail()).findOne(
      tenantFilter(tenantId, { participantId: oid, status: "pending", delivery: { $nin: ["delivered", "bounced"] }, resolution: { $exists: false } }),
      { session, projection: { _id: 1 } },
    );
    if (pendingInvite) return "invite_pending" as const;
    const res = await participants.updateOne(
      tenantFilter(tenantId, { _id: oid }),
      { $set: { token, updatedAt: new Date() }, $inc: { inviteAttemptRevision: 1 } },
      { session },
    );
    if (!res.matchedCount) return null;
    if (!operation) return { token, interviewId: current.interviewId.toHexString(), kind: "rotated" as const };
    const result = { token, interviewId: current.interviewId.toHexString() };
    const createdAt = new Date();
    await (await col.mcpOperations()).insertOne({
      _id: new ObjectId(), ...operation.scope, interviewId: current.interviewId, participantIds: [oid], argumentDigest: operation.argumentDigest, result,
      createdAt, expiresAt: new Date(createdAt.getTime() + MCP_OPERATION_TTL_MS),
    }, { session });
    return { ...result, kind: "rotated" as const };
  });
  try { return await run(); }
  catch (error) {
    if (!operation || !(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    const committed = await (await col.mcpOperations()).findOne(operation.scope);
    if (!committed || committed.expiresAt <= new Date()) throw error;
    if (committed.deletedAt) return { kind: "deleted" };
    return committed.argumentDigest === operation.argumentDigest
      ? { ...(committed.result as { token: string; interviewId: string }), kind: "replayed" }
      : "conflict";
  }
}

export type InviteResolutionResult = "resolved" | "not_found" | "stale" | "already_resolved";

/** Record a host's bounded acknowledgement for one exact ambiguous attempt without changing delivery truth. */
export async function resolveInviteAttempt(input: {
  participantId: string;
  attemptId: string;
  purpose: MailResolutionPurpose;
  reason: string;
  actorId: string;
}): Promise<InviteResolutionResult> {
  const participantOid = toOid(input.participantId);
  const attemptOid = toOid(input.attemptId);
  const tenantId = await currentTenantId();
  const reason = input.reason.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!participantOid || !attemptOid || !tenantId || !reason || !input.actorId) return "not_found";
  return withMongoTransaction(async (session) => {
    const participants = await col.participants();
    const participant = await participants.findOne(tenantFilter(tenantId, { _id: participantOid }), {
      session, projection: { interviewId: 1 },
    });
    if (!participant) return "not_found";
    // This write serializes acknowledgement with invite reservation and the participant mutations it can unblock.
    const touched = await participants.updateOne(
      tenantFilter(tenantId, { _id: participantOid, interviewId: participant.interviewId }),
      { $inc: { inviteAttemptRevision: 1 } }, { session },
    );
    if (touched.matchedCount !== 1) return "not_found";
    const mail = await col.mail();
    const baseFilter = tenantFilter(tenantId, {
      _id: attemptOid, participantId: participantOid, interviewId: participant.interviewId,
    });
    const attempt = await mail.findOne(baseFilter, { session, projection: { status: 1, delivery: 1, resolution: 1, to: 1, token: 1 } });
    if (!attempt) return "not_found";
    if (attempt.resolution) return "already_resolved";
    if (attempt.status !== "pending" || attempt.delivery === "delivered" || attempt.delivery === "bounced") return "stale";
    const acknowledgedAt = new Date();
    const update = await mail.updateOne(
      tenantFilter(tenantId, {
        _id: attemptOid, participantId: participantOid, interviewId: participant.interviewId,
        status: "pending", delivery: { $nin: ["delivered", "bounced"] }, resolution: { $exists: false },
      }),
      { $set: { resolution: { purpose: input.purpose, acknowledgedAt, acknowledgedBy: input.actorId, reason } } },
      { session },
    );
    if (update.matchedCount !== 1) {
      const latest = await mail.findOne(baseFilter, { session, projection: { status: 1, delivery: 1, resolution: 1 } });
      if (!latest) return "not_found";
      if (latest.resolution) return "already_resolved";
      return "stale";
    }
    await insertEvent(tenantId, participant.interviewId, "invite", participantOid, session, {
      action: "ambiguous_outcome_acknowledged", attemptId: attemptOid.toHexString(), purpose: input.purpose,
      delivery: "unknown", acknowledgedBy: input.actorId, reason,
    });
    return "resolved";
  });
}

export async function reopenParticipant(id: string): Promise<ParticipantView | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const reopened = await withMongoTransaction(async (session) => {
    const res = await (await col.participants()).findOneAndUpdate(
      tenantFilter(tenantId, { _id: oid, status: "submitted" }),
      { $set: { status: "in_progress", updatedAt: new Date() }, $unset: { submittedAt: "" }, $inc: { writeEpoch: 1 } },
      { returnDocument: "after", session },
    );
    if (!res) return null;
    const touched = await (await col.interviews()).updateOne(
      tenantFilter(tenantId, { _id: res.interviewId }),
      { $inc: { respondentWriteRevision: 1 } },
      { session },
    );
    if (!touched.matchedCount) throw new Error("Could not update respondent revision for interview.");
    res.writeEpoch ??= 1;
    await insertEvent(tenantId, res.interviewId, "reopen", res._id, session);
    return res;
  });
  return reopened ? participantView(reopened) : null;
}

// ------------------------------------------------------------------------------------------ respondent side
export interface RespondentContext {
  tenantId: string;
  participant: ParticipantView;
  interview: { id: string; name: string; description?: string; mode: InterviewMode; status: InterviewStatus };
  version: SurveyVersionDoc;
}

/**
 * `touch` records that the respondent app itself loaded the link. It must not change `status`.
 * "Not started" stays until the first successful save. Callers skip touch for mail-gateway prefetches.
 */
export async function loadByToken(token: string, opts: { touch?: boolean } = {}): Promise<RespondentContext | null> {
  const participants = await col.participants();
  const p = await participants.findOne({ token });
  if (!p) return null;
  const tenantId = p.tenantId ?? AXION_TENANT_ID;
  const interview = await (await col.interviews()).findOne(tenantFilter(tenantId, { _id: p.interviewId }));
  if (!interview) return null;
  const version = await getVersion(p.interviewId, interview.currentVersion, tenantId);
  if (!version) return null;
  if (opts.touch) {
    const now = new Date();
    if (!p.lastSeenAt || now.getTime() - p.lastSeenAt.getTime() > 10 * 60 * 1000) {
      await withMongoTransaction(async (session) => {
        const touched = await participants.updateOne(
          tenantFilter(tenantId, { _id: p._id, ...(p.lastSeenAt ? { lastSeenAt: p.lastSeenAt } : { lastSeenAt: { $exists: false } }) }),
          { $set: { lastSeenAt: now } }, { session },
        );
        if (touched.matchedCount) await insertEvent(tenantId, p.interviewId, "open", p._id, session);
        return true;
      }).catch(() => console.error("[audit] interview event persistence failed"));
    } else {
      void participants.updateOne(tenantFilter(tenantId, { _id: p._id }), { $set: { lastSeenAt: now } }).catch(() => {});
    }
  }
  return {
    tenantId,
    participant: participantView(p),
    interview: { id: interview._id.toHexString(), name: interview.name, description: interview.description, mode: interview.mode, status: interview.status },
    version,
  };
}

export interface AnswerProblem { id: string; reason: string; code: string; params?: { minimum?: number; maximum?: number } }

export type SaveResult =
  | { ok: true; revision: number; savedAt: string; status: ParticipantStatus; answerRevisions?: Record<string, { value: number; note: number }>; recordGroups?: RepeatRecordMap }
  | { ok: false; status: 400 | 403 | 404 | 409 | 413; error: string; code?: string; details?: AnswerProblem[]; recordErrors?: RepeatRecordIssue[] };

export interface AnswerPatch {
  [questionId: string]: { value?: unknown; note?: unknown };
}

function sameAnswerValue(left: unknown, right: unknown): boolean {
  return Array.isArray(left) && Array.isArray(right)
    ? left.length === right.length && left.every((value, index) => value === right[index])
    : Object.is(left, right);
}

export type RepeatRecordIssue = RepeatAnswerIssue;

type FenceFailure = { ok: false; status: 403 | 404 | 409; error: string; code?: string };

/** Carry a normal domain result out of a transaction that must not commit. */
class RespondentTransactionAbort<T> extends Error {
  constructor(readonly result: T) { super("Respondent transaction rejected."); }
}

/** Atomically touch the interview row used by publishers before changing respondent data. */
async function fenceRespondentWrite(
  session: ClientSession,
  tenantId: string,
  interviewId: ObjectId,
  expectedVersion: number,
): Promise<{ ok: true } | FenceFailure> {
  const interviews = await col.interviews();
  const changed = await interviews.updateOne(
    tenantFilter(tenantId, { _id: interviewId, currentVersion: expectedVersion, status: "open" }),
    { $inc: { respondentWriteRevision: 1 } },
    { session },
  );
  if (changed.matchedCount) return { ok: true };
  const current = await interviews.findOne(tenantFilter(tenantId, { _id: interviewId }), { session });
  if (!current) return { ok: false, status: 404, error: "This link is not valid.", code: "not_found" };
  if (current.currentVersion !== expectedVersion) return versionConflict();
  if (current.status !== "open") return { ok: false, status: 403, error: "This interview is closed.", code: "invalid_state" };
  return versionConflict();
}

/** Validate respondent operations against the manifest and apply them without replacing stale group snapshots. */
export async function saveAnswers(token: string, expectedVersion: number, patch: AnswerPatch, operations: RepeatRecordOperation[] = [], expectedWriteEpoch?: number, expectedAnswerRevisions?: Record<string, { value: number; note: number }>): Promise<SaveResult> {
  const ids = Object.keys(patch);
  if (ids.length === 0 && operations.length === 0) return { ok: false, status: 400, error: "Nothing to save.", code: "invalid_args" };
  if (ids.length + operations.length > 200) return { ok: false, status: 413, error: "Too many answer operations in one request.", code: "payload_too_large" };
  // Each entry must be an object ({ value } and/or { note }) or null. A bare string would make the `in` checks below throw.
  if (ids.some((id) => patch[id] !== null && (typeof patch[id] !== "object" || Array.isArray(patch[id])))) {
    return { ok: false, status: 400, error: "Send each answer as an object with a value or note.", code: "invalid_args" };
  }
  const ctx = await loadByToken(token);
  if (!ctx) return { ok: false, status: 404, error: "This link is not valid.", code: "not_found" };
  if (ctx.version.version !== expectedVersion) return versionConflict();
  if (ctx.interview.status !== "open") return { ok: false, status: 403, error: "This interview is closed.", code: "invalid_state" };
  if (ctx.participant.status === "submitted") return { ok: false, status: 403, error: "Your answers were submitted, so they are locked. Ask your host to reopen them.", code: "invalid_state" };
  const writeEpoch = expectedWriteEpoch ?? ctx.participant.writeEpoch ?? 0;

  const now = new Date();
  const nowIso = now.toISOString();
  const participants = await col.participants();
  let result: SaveResult;
  try {
    result = await withMongoTransaction(async (session): Promise<SaveResult> => {
    const fence = await fenceRespondentWrite(session, ctx.tenantId, new ObjectId(ctx.interview.id), expectedVersion);
    if (!fence.ok) return fence;
    const outcome = await (async (): Promise<SaveResult> => {
    // Always use the current participant inside the transaction callback. Mongo retries this
    // callback after transient write conflicts, so sibling field operations merge on retry.
    const current = await participants.findOne(tenantFilter(ctx.tenantId, { _id: new ObjectId(ctx.participant.id), token }), { session });
    if (!current) return { ok: false, status: 404, error: "This link is not valid.", code: "not_found" };
    if ((current.writeEpoch ?? 0) !== writeEpoch) return { ok: false, status: 409, error: "This response was reopened in another window. Reload the page before continuing.", code: "respondent_state_changed" };
    if (current.status === "submitted") return { ok: false, status: 403, error: "Your answers were submitted, so they are locked. Ask your host to reopen them.", code: "invalid_state" };
    const byId = new Map<string, Question>(ctx.version.manifest.questions.map((q) => [q.id, q]));
    const problems: AnswerProblem[] = [];
    const recordErrors: RepeatRecordIssue[] = [];
    const next: AnswerMap = { ...(current.answers ?? {}) };
    for (const id of ids) {
      const q = byId.get(id);
      if (!q) { problems.push({ id, reason: "not a question in this interview", code: "unknown_question" }); continue; }
      const entry = patch[id] ?? {};
      const cur = next[id] ?? { updatedAt: nowIso };
      const fieldRevisions = { value: cur.fieldRevisions?.value ?? 0, note: cur.fieldRevisions?.note ?? 0 };
      const expected = expectedAnswerRevisions?.[id];
      const replayedValue = expected && "value" in entry && expected.value + 1 === fieldRevisions.value
        && ((entry.value === null || entry.value === undefined) ? cur.value === undefined : sameAnswerValue(entry.value, cur.value));
      const replayedNote = expected && "note" in entry && expected.note + 1 === fieldRevisions.note
        && ((entry.note === null || entry.note === undefined || entry.note === "") ? cur.note === undefined : entry.note === cur.note);
      if (expected && (("value" in entry && expected.value !== fieldRevisions.value && !replayedValue) || ("note" in entry && expected.note !== fieldRevisions.note && !replayedNote))) {
        return { ok: false, status: 409, error: "This answer changed in another window. Your edits are still available on this page; copy them before reloading.", code: "answer_conflict", details: [{ id, reason: "the expected answer revision is stale", code: "stale_revision" }] };
      }
      const merged = { ...cur, fieldRevisions, updatedAt: nowIso };
      if ("value" in entry) {
        const v = validateAnswer(q, entry.value, { allowOverLimit: q.type === "multi", allowExclusiveConflict: q.type === "multi", allowUnderMinSelections: q.type === "multi" });
        if (!v.ok) { problems.push({ id, reason: v.reason, code: v.code, params: v.params }); continue; }
        if (q.type === "multi" && q.maxSelections !== undefined && Array.isArray(v.value) && v.value.length > q.maxSelections) {
          const previous = current.answers?.[id]?.value;
          const previousCount = Array.isArray(previous) ? new Set(previous).size : 0;
          if (previousCount <= q.maxSelections || v.value.length >= previousCount) { problems.push({ id, reason: `choose no more than ${q.maxSelections} options; remove choices from your saved answer before adding any`, code: "above_maximum_selections", params: { maximum: q.maxSelections } }); continue; }
        }
        if (q.type === "multi" && exclusiveConflictCount(q, v.value) > 0) {
          const previous = current.answers?.[id]?.value;
          if (exclusiveConflictCount(q, v.value) >= exclusiveConflictCount(q, previous)) { problems.push({ id, reason: "choose an exclusive option by itself; remove conflicting choices before saving", code: "exclusive_conflict" }); continue; }
        }
        if (v.value === null) delete merged.value;
        else merged.value = v.value;
        merged.fieldRevisions = { ...merged.fieldRevisions, value: replayedValue ? fieldRevisions.value : fieldRevisions.value + 1 };
        if (q.randomizeOptions && v.value !== null) {
          merged.presentedOptionOrder = orderOptions({ options: q.options ?? [], randomizeOptions: true, fixedOptionValues: q.fixedOptionValues, participantId: ctx.participant.id, questionnaireVersion: String(ctx.version.version), questionId: q.id }).map((option) => option.value);
          merged.optionOrderVersion = ctx.version.version;
        } else { delete merged.presentedOptionOrder; delete merged.optionOrderVersion; }
      }
      if ("note" in entry) {
        const cfg = noteConfig(q);
        if (!cfg.enabled) { problems.push({ id, reason: "this question does not take a note", code: "note_not_enabled" }); continue; }
        const note = entry.note;
        if (note === null || note === undefined || note === "") delete merged.note;
        else if (typeof note !== "string") { problems.push({ id, reason: "the note must be text", code: "expected_text" }); continue; }
        else if (note.length > cfg.maxLength) { problems.push({ id, reason: `the note is ${note.length} characters, the limit is ${cfg.maxLength}`, code: "max_length", params: { maximum: cfg.maxLength } }); continue; }
        else merged.note = note;
        merged.fieldRevisions = { ...merged.fieldRevisions, note: replayedNote ? fieldRevisions.note : fieldRevisions.note + 1 };
      }
      // Keep the small revision tombstone when both user-facing fields are cleared, so a
      // stale tab cannot recreate an answer from revision zero.
      next[id] = merged;
    }
    const groups: RepeatRecordMap = { ...(current.recordGroups ?? {}) };
    const touched = new Set<string>();
    const conflict = (questionId: string, rowId: string, fieldId?: string): SaveResult => ({
      ok: false, status: 409, code: fieldId ? "record_field_conflict" : "record_row_conflict",
      error: fieldId ? "This record field changed in another window. Reload the record before editing it again." : "This record changed in another window. Reload the record before editing it again.",
      recordErrors: [{ questionId, rowId, fieldId, reason: "the expected revision is stale", code: "stale_revision" }],
    });
    for (const operation of operations) {
      const q = byId.get(operation.questionId);
      if (!q || q.type !== "repeat") { recordErrors.push({ questionId: operation.questionId, reason: "not a repeat question in this interview", code: "invalid_question" }); continue; }
      if (!ID_RE.test(operation.rowId)) { recordErrors.push({ questionId: q.id, rowId: operation.rowId, reason: "row id is invalid", code: "invalid_row_id" }); continue; }
      const rows = [...(groups[q.id] ?? [])];
      let rowIndex = rows.findIndex((row) => row.id === operation.rowId && !row.deletedAt);
      if (operation.op === "add") {
        const existing = rows.find((row) => row.id === operation.rowId);
        if (existing && !existing.deletedAt) {
          // A retry after a committed add whose response was lost is idempotent.
          touched.add(q.id);
          continue;
        }
        if (existing?.deletedAt) return conflict(q.id, operation.rowId);
        const participantRowHistory = Object.values(groups).reduce((count, groupRows) => count + groupRows.length, 0);
        if (participantRowHistory >= MAX_REPEAT_ROW_HISTORY_PER_PARTICIPANT) {
          recordErrors.push({ questionId: q.id, rowId: operation.rowId, reason: "the record history limit has been reached", code: "history_limit" });
          continue;
        }
        if (rows.filter((row) => !row.deletedAt).length >= (q.maxRows ?? LIMITS.maxRepeatRows)) {
          recordErrors.push({ questionId: q.id, rowId: operation.rowId, reason: `no more than ${q.maxRows ?? LIMITS.maxRepeatRows} records may be added`, code: "max_rows", params: { maximum: q.maxRows ?? LIMITS.maxRepeatRows } });
          continue;
        }
        rows.push({ id: operation.rowId, values: {}, revision: 0, fieldRevisions: {} });
      } else {
        if (rowIndex < 0) {
          const removed = rows.find((row) => row.id === operation.rowId && row.deletedAt);
          if (operation.op === "remove" && removed && operation.expectedRowRevision + 1 === removed.revision) {
            // A retry after a committed remove whose response was lost is idempotent.
            touched.add(q.id);
            continue;
          }
          return conflict(q.id, operation.rowId, operation.op === "set" || operation.op === "clear" ? operation.fieldId : undefined);
        }
        const row = { ...rows[rowIndex], values: { ...rows[rowIndex].values }, fieldRevisions: { ...rows[rowIndex].fieldRevisions } };
        if (operation.op === "remove") {
          if (!Number.isSafeInteger(operation.expectedRowRevision) || operation.expectedRowRevision !== row.revision) return conflict(q.id, operation.rowId);
          row.deletedAt = nowIso;
          row.values = {};
          row.revision += 1;
          rows[rowIndex] = row;
        } else {
          const field = (q.fields ?? []).find((item) => item.id === operation.fieldId);
          if (!field) { recordErrors.push({ questionId: q.id, rowId: row.id, fieldId: operation.fieldId, reason: "not a field in this record", code: "invalid_field" }); continue; }
          const fieldRevision = row.fieldRevisions[field.id] ?? 0;
          if (fieldRevision === operation.expectedFieldRevision + 1) {
            if (operation.op === "clear" && !Object.hasOwn(row.values, field.id)) {
              touched.add(q.id);
              continue;
            }
            if (operation.op === "set") {
              const replayValidation = validateRepeatFieldValue(field, operation.value);
              if (replayValidation.ok && Object.is(row.values[field.id], replayValidation.value)) {
                touched.add(q.id);
                continue;
              }
            }
          }
          if (!Number.isSafeInteger(operation.expectedFieldRevision) || operation.expectedFieldRevision !== fieldRevision) return conflict(q.id, row.id, field.id);
          if (operation.op === "set") {
            const validation = validateRepeatFieldValue(field, operation.value);
            if (!validation.ok) { recordErrors.push({ questionId: q.id, rowId: row.id, fieldId: field.id, reason: validation.reason, code: validation.code, ...(validation.params ? { params: validation.params } : {}) }); continue; }
            row.values[field.id] = validation.value;
          } else delete row.values[field.id];
          row.fieldRevisions[field.id] = fieldRevision + 1;
          row.revision += 1;
          rows[rowIndex] = row;
        }
      }
      groups[q.id] = rows;
      touched.add(q.id);
    }
    // Evaluate the final candidate, including repeat operations in this batch. A repeat
    // answer can make later scalar or repeat questions eligible (or ineligible).
    const eligible = evaluateEligibility(ctx.version.manifest, next, groups);
    for (const id of ids) {
      if (eligible[id] !== false) continue;
      const entry = patch[id] ?? {};
      const q = byId.get(id);
      if (!q) continue;
      const submittedValue = "value" in entry ? validateAnswer(q, entry.value, { allowOverLimit: q.type === "multi", allowExclusiveConflict: q.type === "multi", allowUnderMinSelections: q.type === "multi" }) : null;
      const setsValue = submittedValue && submittedValue.ok && submittedValue.value !== null;
      const setsNote = typeof entry.note === "string" && entry.note.trim() !== "";
      if (setsValue || setsNote) problems.push({ id, reason: "this question is not available for the answers currently selected", code: "inactive_question" });
    }
    for (const id of new Set(operations.map((operation) => operation.questionId))) {
      if (eligible[id] === false && byId.get(id)?.type === "repeat") recordErrors.push({ questionId: id, reason: "this question is not available for the answers currently selected", code: "inactive_question" });
    }
    if (problems.length || recordErrors.length) return { ok: false, status: 400, error: "Some answers could not be saved.", code: "invalid_args", details: problems, recordErrors };
    if (JSON.stringify({ answers: next, recordGroups: groups }).length > LIMITS.maxFileBytes / 3) return { ok: false, status: 413, error: "Answers are too large.", code: "payload_too_large" };
    const $set: Record<string, unknown> = { status: "in_progress", updatedAt: now, lastSavedAt: now, lastSeenAt: now };
    const $unset: Record<string, ""> = {};
    for (const id of ids) {
      if (next[id]) $set[`answers.${id}`] = next[id];
      else $unset[`answers.${id}`] = "";
    }
    for (const id of touched) $set[`recordGroups.${id}`] = groups[id];
    const res = await participants.findOneAndUpdate(
      tenantFilter(ctx.tenantId, { _id: current._id, revision: current.revision, status: { $ne: "submitted" } }),
      { $set, ...(Object.keys($unset).length ? { $unset } : {}), $inc: { revision: 1 } },
      { returnDocument: "after", session },
    );
    if (!res) return { ok: false, status: 409, error: "Your answers were submitted in another window, so they are locked.", code: "invalid_state" };
    await insertEvent(ctx.tenantId, new ObjectId(ctx.interview.id), "save", new ObjectId(ctx.participant.id), session, { ids: ids.slice(0, 20) });
    const returnedGroups: RepeatRecordMap = {};
    for (const id of touched) returnedGroups[id] = (res.recordGroups?.[id] ?? []).filter((row) => !row.deletedAt);
    const answerRevisions = Object.fromEntries(ids.map((id) => [id, { value: next[id]?.fieldRevisions?.value ?? 0, note: next[id]?.fieldRevisions?.note ?? 0 }]));
    return { ok: true, revision: res.revision, savedAt: nowIso, status: res.status, answerRevisions, ...(touched.size ? { recordGroups: returnedGroups } : {}) };
    })();
    if (!outcome.ok) throw new RespondentTransactionAbort(outcome);
    return outcome;
    });
  } catch (error) {
    if (error instanceof RespondentTransactionAbort) return error.result as SaveResult;
    throw error;
  }
  return result;
}

export type SubmitResult = { ok: true; submittedAt: string } | { ok: false; status: 403 | 404 | 409 | 422; error: string; code?: string; missing?: { id: string; label: string }[]; invalidSelections?: { id: string; selected: number; maximum: number }[]; invalidMinimumSelections?: { id: string; selected: number; minimum: number }[]; invalidExclusiveSelections?: { id: string }[]; invalidRankSelections?: { id: string }[]; invalidAnswers?: { id: string; code: AnswerIssueCode }[]; repeatErrors?: RepeatRecordIssue[] };

export async function submitAnswers(token: string, expectedVersion: number, expectedWriteEpoch?: number): Promise<SubmitResult> {
  const ctx = await loadByToken(token);
  if (!ctx) return { ok: false, status: 404, error: "This link is not valid.", code: "not_found" };
  if (ctx.version.version !== expectedVersion) return versionConflict();
  if (ctx.interview.status !== "open") return { ok: false, status: 403, error: "This interview is closed.", code: "invalid_state" };
  const participants = await col.participants();
  const interviewId = new ObjectId(ctx.interview.id);
  const participantId = new ObjectId(ctx.participant.id);
  const writeEpoch = expectedWriteEpoch ?? ctx.participant.writeEpoch ?? 0;
  let result: SubmitResult & { newlySubmitted?: boolean };
  try {
    result = await withMongoTransaction(async (session): Promise<SubmitResult & { newlySubmitted?: boolean }> => {
    const fence = await fenceRespondentWrite(session, ctx.tenantId, interviewId, expectedVersion);
    if (!fence.ok) return fence;
    const outcome = await (async (): Promise<SubmitResult & { newlySubmitted?: boolean }> => {
    // Read after the shared write fence, on every transaction retry. A save that
    // wins the fence must be reflected in the answers used for validation.
    const current = await participants.findOne(tenantFilter(ctx.tenantId, { _id: participantId, token }), { session });
    if (!current) return { ok: false, status: 404, error: "This link is not valid.", code: "not_found" };
    if ((current.writeEpoch ?? 0) !== writeEpoch) return { ok: false, status: 409, error: "This response changed in another window. Reload the page before continuing.", code: "respondent_state_changed" };
    if (current.status === "submitted") return { ok: true, submittedAt: (current.submittedAt ?? new Date()).toISOString() };
    const pr = progress(ctx.version.manifest, current.answers, current.recordGroups ?? {});
    if (pr.missingRequired.length || pr.invalidSelections.length || pr.invalidMinimumSelections.length || pr.invalidExclusiveSelections.length || pr.invalidRankSelections.length || pr.invalidAnswers.length || pr.repeatErrors.length) {
      const label = new Map(ctx.version.manifest.questions.map((q) => [q.id, q.label]));
      const issues = pr.missingRequired.length + pr.invalidSelections.length + pr.invalidMinimumSelections.length + pr.invalidExclusiveSelections.length + pr.invalidRankSelections.length + pr.invalidAnswers.length + pr.repeatErrors.length;
      return {
        ok: false,
        status: 422,
        code: "incomplete_answers",
        error: `${issues} ${issues === 1 ? "answer needs" : "answers need"} attention before submission.`,
        missing: pr.missingRequired.map((id) => ({ id, label: label.get(id) ?? id })),
        invalidSelections: pr.invalidSelections,
        invalidMinimumSelections: pr.invalidMinimumSelections,
        invalidExclusiveSelections: pr.invalidExclusiveSelections,
        invalidRankSelections: pr.invalidRankSelections,
        invalidAnswers: pr.invalidAnswers,
        repeatErrors: pr.repeatErrors,
      };
    }
    const now = new Date();
    const res = await participants.findOneAndUpdate(
      tenantFilter(ctx.tenantId, { _id: participantId, token, revision: current.revision, status: { $ne: "submitted" } }),
      { $set: { status: "submitted", submittedAt: now, updatedAt: now }, $inc: { writeEpoch: 1 } },
      { returnDocument: "after", session },
    );
    if (!res) return { ok: false, status: 409, error: "Your answers changed in another window. Please try submitting again.", code: "concurrent_change" };
    await insertEvent(ctx.tenantId, interviewId, "submit", participantId, session);
    return { ok: true, submittedAt: (res.submittedAt ?? now).toISOString(), newlySubmitted: true };
    })();
    // A repeat submit is successful but makes no participant change, so its fence
    // update must also be rolled back.
    if (!outcome.ok || !outcome.newlySubmitted) throw new RespondentTransactionAbort(outcome);
    return outcome;
    });
  } catch (error) {
    if (error instanceof RespondentTransactionAbort) return error.result as SubmitResult & { newlySubmitted?: boolean };
    throw error;
  }
  if (result.ok) return { ok: true, submittedAt: result.submittedAt };
  return result;
}

// ------------------------------------------------------------------------------------------ login throttling
const LOGIN_WINDOW_MIN = 15;

/** True when this key has used up its failed attempts in the window. The caller decides what to do if the check itself fails. */
export async function loginBlocked(key: string, maxFails = 8): Promise<boolean> {
  const since = new Date(Date.now() - LOGIN_WINDOW_MIN * 60 * 1000);
  return (await (await col.logins()).countDocuments({ key, at: { $gte: since } })) >= maxFails;
}

/** Atomically consume one attempt in a fixed window. Keys are hashed before storage so IPs and addresses stay out of the rate-limit collection. */
export async function consumeRateLimit(key: string, maxAttempts: number, windowMinutes = LOGIN_WINDOW_MIN): Promise<boolean> {
  if (!key || !Number.isSafeInteger(maxAttempts) || maxAttempts < 1 || !Number.isSafeInteger(windowMinutes) || windowMinutes < 1) {
    throw new Error("Invalid rate limit configuration.");
  }
  const now = new Date();
  const nextWindowEnd = new Date(now.getTime() + windowMinutes * 60 * 1000);
  const activeWindow = { $gt: ["$windowEndsAt", now] };
  const pipeline = [{ $set: {
    count: { $cond: [activeWindow, { $add: [{ $ifNull: ["$count", 0] }, 1] }, 1] },
    windowEndsAt: { $cond: [activeWindow, "$windowEndsAt", nextWindowEnd] },
    expireAt: { $cond: [activeWindow, "$windowEndsAt", nextWindowEnd] },
  } }];
  const buckets = await col.rateLimits();
  const _id = createHash("sha256").update(key).digest("hex");
  let bucket;
  try {
    bucket = await buckets.findOneAndUpdate({ _id }, pipeline, { upsert: true, returnDocument: "after" });
  } catch (error) {
    // Concurrent first requests may race to upsert the same unique _id. The loser retries as an update.
    if ((error as { code?: number }).code !== 11000) throw error;
    bucket = await buckets.findOneAndUpdate({ _id }, pipeline, { returnDocument: "after" });
  }
  return !!bucket && bucket.count <= maxAttempts;
}

export async function clearRateLimit(key: string): Promise<void> {
  const _id = createHash("sha256").update(key).digest("hex");
  await (await col.rateLimits()).deleteOne({ _id });
}

export async function revokeSession(sid: string, exp: number): Promise<void> {
  await (await col.revoked()).updateOne({ sid }, { $setOnInsert: { _id: new ObjectId(), sid, expireAt: new Date(exp * 1000) } }, { upsert: true });
}
export async function isSessionRevoked(sid: string): Promise<boolean> {
  return !!(await (await col.revoked()).findOne({ sid }, { projection: { _id: 1 } }));
}

export async function registerUserSession(input: { sid: string; userId: string; tenantId: string; authVersion: number; exp: number }): Promise<void> {
  const userId = toOid(input.userId);
  if (!userId || !input.sid || !input.tenantId || !Number.isInteger(input.authVersion) || !Number.isSafeInteger(input.exp)) throw new Error("Invalid user session.");
  const now = new Date();
  await (await col.userSessions()).updateOne(
    { sid: input.sid },
    { $setOnInsert: { _id: new ObjectId(), sid: input.sid, userId, tenantId: input.tenantId, authVersion: input.authVersion, createdAt: now, expiresAt: new Date(input.exp * 1000) } },
    { upsert: true },
  );
}

export async function listUserSessions(input: { userId: string; authVersion: number; currentSid: string }): Promise<Array<{ current: boolean; createdAt: string; expiresAt: string }>> {
  const userId = toOid(input.userId);
  if (!userId) return [];
  const now = new Date();
  const records = await (await col.userSessions()).find(
    { userId, authVersion: input.authVersion, expiresAt: { $gt: now } },
    { projection: { sid: 1, createdAt: 1, expiresAt: 1 } },
  ).sort({ createdAt: -1 }).limit(50).toArray();
  const current = await (await col.userSessions()).findOne(
    { sid: input.currentSid, userId, authVersion: input.authVersion, expiresAt: { $gt: now } },
    { projection: { sid: 1, createdAt: 1, expiresAt: 1 } },
  );
  const candidates = current ? [current, ...records.filter((record) => record.sid !== current.sid).slice(0, 49)] : records;
  if (!candidates.length) return [];
  const revoked = await (await col.revoked()).find({ sid: { $in: candidates.map((record) => record.sid) } }, { projection: { sid: 1 } }).toArray();
  const revokedIds = new Set(revoked.map((record) => record.sid));
  return candidates.filter((record) => !revokedIds.has(record.sid)).map((record) => ({
    current: record.sid === input.currentSid,
    createdAt: record.createdAt.toISOString(),
    expiresAt: record.expiresAt.toISOString(),
  }));
}

export async function recordLoginFailure(key: string): Promise<void> {
  await (await col.logins()).insertOne({ _id: new ObjectId(), key, at: new Date() });
}
export async function clearLoginFailures(key: string): Promise<void> {
  await (await col.logins()).deleteMany({ key });
}

/** Audit an MCP tool call. Meta contains the tool, outcome, and safe credential identity only. */
export async function noteMcp(tool: string, ok: boolean, interviewId?: string): Promise<void> {
  const tenantId = await currentTenantId();
  if (!tenantId) return;
  const oid = interviewId ? toOid(interviewId) : null;
  const safe = /^[a-z0-9_]{1,64}$/.test(tool) ? tool : "unknown";
  const auditActor = currentPrincipal()?.auditActor;
  const actorName = typeof auditActor?.name === "string" ? auditActor.name : "Unnamed credential";
  const safeActor = auditActor && /^[a-z0-9_-]{1,32}$/.test(auditActor.kind)
    && /^[a-zA-Z0-9._:-]{1,120}$/.test(auditActor.id)
    ? { kind: auditActor.kind, id: auditActor.id, name: actorName.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "Unnamed credential" }
    : undefined;
  await (await col.events()).insertOne({ _id: new ObjectId(), tenantId, ...(oid ? { interviewId: oid } : {}), type: "mcp", at: new Date(), meta: { tool: safe, ok, ...(safeActor ? { actor: safeActor } : {}) } });
}

// ------------------------------------------------------------------------------------------ export input
export async function recentEvents(interviewId: string, limit = 30) {
  const oid = toOid(interviewId);
  if (!oid) return [];
  const tenantId = await currentTenantId();
  if (!tenantId) return [];
  const docs = await (await col.events()).find(tenantFilter(tenantId, { interviewId: oid })).sort({ at: -1 }).limit(limit).toArray();
  return docs.map((e) => ({ id: e._id.toHexString(), type: e.type, at: e.at.toISOString(), participantId: e.participantId?.toHexString(), meta: e.meta }));
}

export interface EventPage {
  events: { id: string; type: string; at: string; participantId?: string; meta?: Record<string, unknown> }[];
  nextCursor: string | null;
}

function decodeEventCursor(cursor: string): { at: Date; id: ObjectId } {
  try {
    if (cursor.length > 512) throw new Error();
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { at?: unknown; id?: unknown };
    if (typeof parsed.at !== "string" || typeof parsed.id !== "string" || !/^[0-9a-f]{24}$/i.test(parsed.id)) throw new Error();
    const at = new Date(parsed.at);
    if (!Number.isFinite(at.getTime()) || at.toISOString() !== parsed.at) throw new Error();
    return { at, id: new ObjectId(parsed.id) };
  } catch { throw new Error("Invalid event cursor."); }
}

/** Read an audit-history page in stable newest-first order, including ties at the same timestamp. */
export async function listEventPage(interviewId: string, cursor: string | null, limit = 25): Promise<EventPage> {
  const oid = toOid(interviewId);
  if (!oid) return { events: [], nextCursor: null };
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("Invalid event page limit.");
  const tenantId = await currentTenantId();
  if (!tenantId) return { events: [], nextCursor: null };
  const anchor = cursor ? decodeEventCursor(cursor) : null;
  const filter = tenantFilter(tenantId, {
    interviewId: oid,
    ...(anchor ? { $or: [{ at: { $lt: anchor.at } }, { at: anchor.at, _id: { $lt: anchor.id } }] } : {}),
  });
  const docs = await (await col.events()).find(filter).sort({ at: -1, _id: -1 }).limit(limit + 1).toArray();
  const hasMore = docs.length > limit;
  const page = docs.slice(0, limit);
  const last = page.at(-1);
  return {
    events: page.map((event) => ({ id: event._id.toHexString(), type: event.type, at: event.at.toISOString(), participantId: event.participantId?.toHexString(), meta: event.meta })),
    nextCursor: hasMore && last ? Buffer.from(JSON.stringify({ at: last.at.toISOString(), id: last._id.toHexString() })).toString("base64url") : null,
  };
}

/** Record an interview export without storing participant data or the export payload. */
export async function recordExportEvent(interviewId: string, format: string): Promise<boolean> {
  const oid = toOid(interviewId);
  if (!oid) return false;
  const tenantId = await currentTenantId();
  if (!tenantId) return false;
  return withMongoTransaction(async (session) => {
    const interview = await (await col.interviews()).findOne(tenantFilter(tenantId, { _id: oid }), { session, projection: { _id: 1 } });
    if (!interview) return false;
    await insertEvent(tenantId, oid, "export", undefined, session, { format });
    return true;
  });
}

export { getQuestionnaireReviewDraft, saveQuestionnaireReviewDraft } from "./questionnaire-reviews";
