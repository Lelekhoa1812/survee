import { createHash } from "node:crypto";
import { ObjectId } from "mongodb";
import { col } from "../db";
import { parseEmail } from "../mail/address";
import { progress, validateAnswer } from "../format/answers";
import { ID_RE, LIMITS, noteConfig, type AnswerMap, type Manifest, type Question } from "../format/schema";
import { newToken } from "../tokens";
import { deleteMailForInterview, deleteMailForPerson } from "./mail";
import type { InterviewDoc, InterviewMode, InterviewStatus, InterviewSummary, ParticipantDoc, ParticipantStatus, ParticipantView, SurveyVersionDoc } from "./types";
import { currentPrincipal, currentTenantId, tenantFilter } from "../tenant-context";
import { AXION_TENANT_ID } from "../env";

export type { InterviewSummary, ParticipantView } from "./types";

const iso = (d?: Date) => (d ? d.toISOString() : undefined);

export function toOid(id: string): ObjectId | null {
  return /^[0-9a-f]{24}$/i.test(id) ? new ObjectId(id) : null;
}

function participantView(p: ParticipantDoc): ParticipantView {
  return {
    id: p._id.toHexString(), interviewId: p.interviewId.toHexString(), token: p.token, name: p.name, email: p.email, note: p.note, status: p.status, answers: p.answers ?? {},
    revision: p.revision, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(), lastSeenAt: iso(p.lastSeenAt), lastSavedAt: iso(p.lastSavedAt), submittedAt: iso(p.submittedAt),
  };
}

function logEvent(tenantId: string, interviewId: ObjectId, type: string, participantId?: ObjectId, meta?: Record<string, unknown>) {
  // Fire and forget: the audit trail must never slow down or break an answer being saved.
  void col.events().then((c) => c.insertOne({ _id: new ObjectId(), tenantId, interviewId, participantId, type: type as never, at: new Date(), meta })).catch(() => {});
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
  return docs.map((d) => {
    const mine = agg.filter((a) => a._id.i.equals(d._id));
    const get = (s: ParticipantStatus) => mine.find((a) => a._id.s === s)?.n ?? 0;
    const last = mine.reduce<Date | undefined>((m, a) => (!m || a.last > m ? a.last : m), undefined);
    return {
      id: d._id.toHexString(), name: d.name, description: d.description, mode: d.mode, status: d.status, currentVersion: d.currentVersion,
      createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
      counts: { people: get("invited") + get("in_progress") + get("submitted"), invited: get("invited"), inProgress: get("in_progress"), submitted: get("submitted") },
      lastActivityAt: iso(last),
    };
  });
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
  const doc: InterviewDoc = { _id: new ObjectId(), tenantId, name: input.name, description: input.description, mode: input.mode, status: "open", currentVersion: 1, createdAt: now, updatedAt: now };
  await (await col.interviews()).insertOne(doc);
  await (await col.versions()).insertOne(versionDoc(tenantId, doc._id, 1, input.survey));
  if (input.mode === "single") await addParticipants(doc._id.toHexString(), [{ name: "Respondent" }]);
  logEvent(tenantId, doc._id, "created");
  return doc;
}

export async function updateInterview(id: string, patch: { name?: string; description?: string | null; status?: InterviewStatus }): Promise<InterviewDoc | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const set: Partial<InterviewDoc> = { updatedAt: new Date() };
  const unset: Record<string, ""> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.description !== undefined) {
    if (patch.description === null || patch.description === "") unset.description = "";
    else set.description = patch.description;
  }
  if (patch.status !== undefined) set.status = patch.status;
  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length) update.$unset = unset;
  const res = await (await col.interviews()).findOneAndUpdate(tenantFilter(tenantId, { _id: oid }), update, { returnDocument: "after" });
  if (res && patch.status) logEvent(tenantId, oid, "status", undefined, { status: patch.status });
  return res;
}

export async function addVersion(id: string, survey: NewSurvey): Promise<number | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const interviews = await col.interviews();
  const cur = await interviews.findOne(tenantFilter(tenantId, { _id: oid }));
  if (!cur) return null;
  const next = cur.currentVersion + 1;
  await (await col.versions()).insertOne(versionDoc(tenantId, oid, next, survey));
  await interviews.updateOne(tenantFilter(tenantId, { _id: oid }), { $set: { currentVersion: next, updatedAt: new Date() } });
  logEvent(tenantId, oid, "version", undefined, { version: next });
  return next;
}

/** Publish only if the interview still points at the version that was reviewed. */
export async function publishVersionIfCurrent(
  id: string,
  expectedVersion: number,
  expectedBaseHash: string,
  survey: NewSurvey,
  source: "mcp_patch" | "mcp_upload" | "host_patch" = "mcp_patch",
): Promise<{ version: number } | { conflict: true } | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const interviews = await col.interviews();
  const interview = await interviews.findOne(tenantFilter(tenantId, { _id: oid, currentVersion: expectedVersion }));
  if (!interview) return { conflict: true };
  const current = await getVersion(oid, expectedVersion, tenantId);
  if (!current || current.htmlSha256 !== expectedBaseHash) return { conflict: true };

  const version = expectedVersion + 1;
  const versions = await col.versions();
  const doc = versionDoc(tenantId, oid, version, survey);
  try {
    await versions.insertOne(doc);
  } catch (error) {
    // A concurrent publisher may already have claimed this version number.
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return { conflict: true };
    throw error;
  }
  let changed;
  try {
    changed = await interviews.updateOne(
      tenantFilter(tenantId, { _id: oid, currentVersion: expectedVersion }),
      { $set: { currentVersion: version, updatedAt: new Date() } },
    );
  } catch (error) {
    await versions.deleteOne(tenantFilter(tenantId, { _id: doc._id })).catch(() => {});
    throw error;
  }
  if (!changed.modifiedCount) {
    await versions.deleteOne(tenantFilter(tenantId, { _id: doc._id })).catch(() => {});
    return { conflict: true };
  }
  logEvent(tenantId, oid, "version", undefined, { version, source });
  return { version };
}

export async function deleteInterview(id: string): Promise<boolean> {
  const oid = toOid(id);
  if (!oid) return false;
  const tenantId = await currentTenantId();
  if (!tenantId) return false;
  const res = await (await col.interviews()).deleteOne(tenantFilter(tenantId, { _id: oid }));
  if (!res.deletedCount) return false;
  await Promise.all([
    (await col.versions()).deleteMany(tenantFilter(tenantId, { interviewId: oid })),
    (await col.participants()).deleteMany(tenantFilter(tenantId, { interviewId: oid })),
    (await col.events()).deleteMany(tenantFilter(tenantId, { interviewId: oid })),
    deleteMailForInterview(oid),
  ]);
  return true;
}

// ------------------------------------------------------------------------------------------ participants
export async function listParticipants(interviewId: string): Promise<ParticipantView[]> {
  const oid = toOid(interviewId);
  if (!oid) return [];
  const tenantId = await currentTenantId();
  if (!tenantId) return [];
  const docs = await (await col.participants()).find(tenantFilter(tenantId, { interviewId: oid })).sort({ createdAt: 1 }).toArray();
  return docs.map(participantView);
}

export interface AnalyticsParticipant {
  status: ParticipantStatus;
  answers: AnswerMap;
}

export interface AnalyticsParticipantScope {
  statuses?: ParticipantStatus[];
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
      yield { status: participant.status, answers };
    }
  } finally {
    await cursor.close();
  }
}

export async function addParticipants(interviewId: string, people: { name: string; note?: string; email?: string }[]): Promise<ParticipantView[]> {
  const oid = toOid(interviewId);
  if (!oid || people.length === 0) return [];
  const tenantId = await currentTenantId();
  if (!tenantId || !(await (await col.interviews()).findOne(tenantFilter(tenantId, { _id: oid }), { projection: { _id: 1 } }))) return [];
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
  await (await col.participants()).insertMany(docs);
  await (await col.interviews()).updateOne(tenantFilter(tenantId, { _id: oid }), { $set: { updatedAt: now } });
  return docs.map(participantView);
}

export async function getParticipant(id: string): Promise<ParticipantView | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const doc = await (await col.participants()).findOne(tenantFilter(tenantId, { _id: oid }));
  return doc ? participantView(doc) : null;
}

export async function updateParticipant(id: string, patch: { name?: string; note?: string | null; email?: string | null }): Promise<ParticipantView | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const set: Partial<ParticipantDoc> = { updatedAt: new Date() };
  const unset: Record<string, ""> = {};
  if (patch.name !== undefined) set.name = patch.name.trim().slice(0, 120) || "Respondent";
  if (patch.note !== undefined) {
    if (patch.note === null || patch.note.trim() === "") unset.note = "";
    else set.note = patch.note.trim().slice(0, 1000);
  }
  if (patch.email !== undefined) {
    if (patch.email === null || patch.email.trim() === "") unset.email = "";
    else {
      const parsed = parseEmail(patch.email);
      if (!parsed.ok || !parsed.email) throw new Error("Invalid email");
      set.email = parsed.email;
    }
  }
  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length) update.$unset = unset;
  const res = await (await col.participants()).findOneAndUpdate(tenantFilter(tenantId, { _id: oid }), update, { returnDocument: "after" });
  return res ? participantView(res) : null;
}

export async function deleteParticipant(id: string): Promise<boolean> {
  const oid = toOid(id);
  if (!oid) return false;
  const tenantId = await currentTenantId();
  if (!tenantId) return false;
  const res = await (await col.participants()).deleteOne(tenantFilter(tenantId, { _id: oid }));
  if (!res.deletedCount) return false;
  await deleteMailForPerson(oid);
  return true;
}

export async function regenerateToken(id: string): Promise<string | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const token = newToken();
  const res = await (await col.participants()).updateOne(tenantFilter(tenantId, { _id: oid }), { $set: { token, updatedAt: new Date() } });
  return res.matchedCount ? token : null;
}

export async function reopenParticipant(id: string): Promise<ParticipantView | null> {
  const oid = toOid(id);
  if (!oid) return null;
  const tenantId = await currentTenantId();
  if (!tenantId) return null;
  const res = await (await col.participants()).findOneAndUpdate(tenantFilter(tenantId, { _id: oid, status: "submitted" }), { $set: { status: "in_progress", updatedAt: new Date() }, $unset: { submittedAt: "" } }, { returnDocument: "after" });
  if (res) logEvent(tenantId, res.interviewId, "reopen", res._id);
  return res ? participantView(res) : null;
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
    void participants.updateOne(tenantFilter(tenantId, { _id: p._id }), { $set: { lastSeenAt: now } }).catch(() => {});
    if (!p.lastSeenAt || now.getTime() - p.lastSeenAt.getTime() > 10 * 60 * 1000) logEvent(tenantId, p.interviewId, "open", p._id);
  }
  return {
    tenantId,
    participant: participantView(p),
    interview: { id: interview._id.toHexString(), name: interview.name, description: interview.description, mode: interview.mode, status: interview.status },
    version,
  };
}

export type SaveResult =
  | { ok: true; revision: number; savedAt: string; status: ParticipantStatus }
  | { ok: false; status: 400 | 403 | 404 | 409 | 413; error: string; details?: { id: string; reason: string }[] };

export interface AnswerPatch {
  [questionId: string]: { value?: unknown; note?: unknown };
}

/** Validate a patch against the manifest and apply it. Unknown ids and invalid values are rejected, never stored. */
export async function saveAnswers(token: string, patch: AnswerPatch): Promise<SaveResult> {
  const ids = Object.keys(patch);
  if (ids.length === 0) return { ok: false, status: 400, error: "Nothing to save." };
  if (ids.length > 200) return { ok: false, status: 413, error: "Too many answers in one request." };
  const ctx = await loadByToken(token);
  if (!ctx) return { ok: false, status: 404, error: "This link is not valid." };
  if (ctx.interview.status !== "open") return { ok: false, status: 403, error: "This interview is closed." };
  if (ctx.participant.status === "submitted") return { ok: false, status: 403, error: "Your answers were submitted, so they are locked. Ask your host to reopen them." };

  const byId = new Map<string, Question>(ctx.version.manifest.questions.map((q) => [q.id, q]));
  const problems: { id: string; reason: string }[] = [];
  const now = new Date();
  const nowIso = now.toISOString();
  const next: AnswerMap = { ...ctx.participant.answers };
  for (const id of ids) {
    const q = byId.get(id);
    if (!q) {
      problems.push({ id, reason: "not a question in this interview" });
      continue;
    }
    const entry = patch[id] ?? {};
    const cur = next[id] ?? { updatedAt: nowIso };
    const merged = { ...cur, updatedAt: nowIso };
    if ("value" in entry) {
      const v = validateAnswer(q, entry.value);
      if (!v.ok) {
        problems.push({ id, reason: v.reason });
        continue;
      }
      if (v.value === null) delete merged.value;
      else merged.value = v.value;
    }
    if ("note" in entry) {
      const cfg = noteConfig(q);
      if (!cfg.enabled) {
        problems.push({ id, reason: "this question does not take a note" });
        continue;
      }
      const note = entry.note;
      if (note === null || note === undefined || note === "") delete merged.note;
      else if (typeof note !== "string") {
        problems.push({ id, reason: "the note must be text" });
        continue;
      } else if (note.length > cfg.maxLength) {
        problems.push({ id, reason: `the note is ${note.length} characters, the limit is ${cfg.maxLength}` });
        continue;
      } else merged.note = note;
    }
    if (merged.value === undefined && merged.note === undefined) delete next[id];
    else next[id] = merged;
  }
  if (problems.length) return { ok: false, status: 400, error: "Some answers could not be saved.", details: problems };
  if (JSON.stringify(next).length > LIMITS.maxFileBytes / 3) return { ok: false, status: 413, error: "Answers are too large." };

  // Update only the answers that were sent, by path, so two saves in flight at once cannot overwrite each other's questions.
  const $set: Record<string, unknown> = { status: "in_progress", updatedAt: now, lastSavedAt: now, lastSeenAt: now };
  const $unset: Record<string, ""> = {};
  for (const id of ids) {
    if (next[id]) $set[`answers.${id}`] = next[id];
    else $unset[`answers.${id}`] = "";
  }
  const participants = await col.participants();
  const res = await participants.findOneAndUpdate(
    tenantFilter(ctx.tenantId, { _id: new ObjectId(ctx.participant.id), status: { $ne: "submitted" } }),
    { $set, ...(Object.keys($unset).length ? { $unset } : {}), $inc: { revision: 1 } },
    { returnDocument: "after" },
  );
  if (!res) return { ok: false, status: 409, error: "Your answers were submitted in another window, so they are locked." };
  logEvent(ctx.tenantId, res.interviewId, "save", res._id, { ids: ids.slice(0, 20) });
  return { ok: true, revision: res.revision, savedAt: nowIso, status: res.status };
}

export type SubmitResult = { ok: true; submittedAt: string } | { ok: false; status: 403 | 404 | 422; error: string; missing?: { id: string; label: string }[] };

export async function submitAnswers(token: string): Promise<SubmitResult> {
  const ctx = await loadByToken(token);
  if (!ctx) return { ok: false, status: 404, error: "This link is not valid." };
  if (ctx.interview.status !== "open") return { ok: false, status: 403, error: "This interview is closed." };
  if (ctx.participant.status === "submitted") return { ok: true, submittedAt: ctx.participant.submittedAt ?? new Date().toISOString() };
  const pr = progress(ctx.version.manifest, ctx.participant.answers);
  if (pr.missingRequired.length) {
    const label = new Map(ctx.version.manifest.questions.map((q) => [q.id, q.label]));
    return { ok: false, status: 422, error: `${pr.missingRequired.length} required ${pr.missingRequired.length === 1 ? "question is" : "questions are"} not answered yet.`, missing: pr.missingRequired.map((id) => ({ id, label: label.get(id) ?? id })) };
  }
  const now = new Date();
  const res = await (await col.participants()).findOneAndUpdate(tenantFilter(ctx.tenantId, { _id: new ObjectId(ctx.participant.id) }), { $set: { status: "submitted", submittedAt: now, updatedAt: now } }, { returnDocument: "after" });
  if (res) logEvent(ctx.tenantId, res.interviewId, "submit", res._id);
  return { ok: true, submittedAt: now.toISOString() };
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

export async function revokeSession(sid: string, exp: number): Promise<void> {
  await (await col.revoked()).updateOne({ sid }, { $setOnInsert: { _id: new ObjectId(), sid, expireAt: new Date(exp * 1000) } }, { upsert: true });
}
export async function isSessionRevoked(sid: string): Promise<boolean> {
  return !!(await (await col.revoked()).findOne({ sid }, { projection: { _id: 1 } }));
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
