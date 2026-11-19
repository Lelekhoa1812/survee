"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import type { AnswerMap, AnswerValue, Question, QuestionOrderGroup, RepeatRecordMap, RepeatRecordOperation, RepeatRecordRow, Section } from "@/lib/format/schema";
import { displayValue } from "@/lib/format/answers";
import { RESPONDENT_LOCALE_META, type RespondentLocale, type RespondentMessage, respondentBridgeMessages, respondentMessage, respondentMessageParts, respondentTime } from "@/lib/respondent-locale";
import { api, BrandMark, CopyButton, Icon, Modal, Spinner, useToast } from "./ui";

type Phase = "loading" | "ready" | "invalid" | "error";
type SaveState = "idle" | "saving" | "saved" | "error" | "failed" | "offline";
interface Loaded {
  participant: { name: string; status: "invited" | "in_progress" | "submitted"; submittedAt?: string };
  interview: { name: string; status: "open" | "closed" };
  version: number;
  title: string;
  sections?: Section[];
  questionOrderGroups?: QuestionOrderGroup[];
  questionOrder?: string[];
  questionOrderAssignment?: { algorithmVersion: string; groups: Record<string, string[]>; assignedAt?: string };
  questions: Question[];
  answers: AnswerMap;
  recordGroups?: RepeatRecordMap;
  progress: { eligible?: Record<string, boolean> };
  presentation?: "all" | "guided" | "guided-question";
}
type Patch = Record<string, { value?: unknown; note?: unknown }>;
type PendingRecordOperation = { operationId: string; operation: RepeatRecordOperation };
type RejectedRecordDraft = { operationId: string; operation: RepeatRecordOperation; reason: string };

export function applyRecordOperation(groups: RepeatRecordMap, operation: RepeatRecordOperation): RepeatRecordMap {
  const next = { ...groups };
  const rows = [...(groups[operation.questionId] ?? [])];
  const index = rows.findIndex((row) => row.id === operation.rowId);
  if (operation.op === "add") {
    if (index < 0) rows.push({ id: operation.rowId, values: {}, revision: 0, fieldRevisions: {} });
  } else if (operation.op === "remove") {
    if (index >= 0) rows.splice(index, 1);
  } else if (index >= 0) {
    const row = rows[index];
    const values = { ...row.values };
    if (operation.op === "set") values[operation.fieldId] = operation.value;
    else delete values[operation.fieldId];
    rows[index] = { ...row, values };
  }
  next[operation.questionId] = rows;
  return next;
}

export function retryableScalarPatch(batch: Patch, scalarErrors: { id: string }[]): Patch {
  const rejectedIds = new Set(scalarErrors.map((item) => item.id));
  return Object.fromEntries(Object.entries(batch).filter(([id]) => !rejectedIds.has(id)));
}

export function repeatAttentionReasons(question: Question, sourceRows: RepeatRecordRow[], requiredMessage: string, minimumMessage: (count: number, item: string) => string): string[] {
  if (question.type !== "repeat") return [];
  const rows = sourceRows.filter((row) => !row.deletedAt);
  const issues: string[] = [];
  const minRows = Math.max(question.minRows ?? 0, question.required ? 1 : 0);
  if (rows.length < minRows) issues.push(minimumMessage(minRows, question.itemLabel ?? "record"));
  for (const row of rows) for (const field of question.fields ?? []) {
    if (field.required && !hasValue(row.values?.[field.id])) issues.push(`${field.label}: ${requiredMessage}`);
  }
  return issues;
}

function mergePatches(older: Patch, newer: Patch): Patch {
  const merged = { ...older };
  for (const [id, patch] of Object.entries(newer)) merged[id] = { ...merged[id], ...patch };
  return merged;
}

const hasValue = (v: unknown) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : true);
function defaultRepeatItem(locale: RespondentLocale): string {
  return locale === "vi" ? "bản ghi" : locale === "es" ? "registro" : locale === "ar" ? "سجل" : "record";
}
function repeatRowLabel(question: Question, index: number, locale: RespondentLocale): string {
  const defaultItem = defaultRepeatItem(locale);
  return respondentBridgeMessages(locale).repeatRowLabel.replace("{item}", question.itemLabel ?? defaultItem).replace("{index}", String(index));
}

export function buildQuestionNavigation(questions: Question[], sections: Section[], eligible: Record<string, boolean>, fallbackTitle = "Other questions") {
  const definitions = new Map(sections.map((section) => [section.id, section]));
  const groups: { id: string; title: string; description?: string; questions: Question[] }[] = [];
  const byId = new Map<string, (typeof groups)[number]>();
  for (const question of questions) {
    if (eligible[question.id] === false) continue;
    const id = question.section ?? "__unsectioned";
    let group = byId.get(id);
    if (!group) {
      const definition = definitions.get(id);
      group = { id, title: definition?.title ?? fallbackTitle, description: definition?.description, questions: [] };
      byId.set(id, group);
      groups.push(group);
    }
    group.questions.push(question);
  }
  return groups;
}

function questionsInPresentationOrder(questions: Question[], order?: string[]): Question[] {
  if (!order || order.length !== questions.length) return questions;
  const byId = new Map(questions.map((question) => [question.id, question]));
  if (new Set(order).size !== questions.length || order.some((id) => !byId.has(id))) return questions;
  return order.map((id) => byId.get(id)!);
}

function LocalePicker({ locale, label, onChange }: { locale: RespondentLocale; label: string; onChange: (value: string) => void }) {
  return (
    <label className="rs-language">
      <span className="sr-only">{label}</span>
      <select aria-label={label} value={locale} onChange={(event) => onChange(event.target.value)}>
        {Object.entries(RESPONDENT_LOCALE_META).map(([value, item]) => <option key={value} value={value} lang={item.lang} dir={item.direction}>{item.label}</option>)}
      </select>
    </label>
  );
}

function LocalizedMessage({ locale, message, values, valueLang }: { locale: RespondentLocale; message: RespondentMessage; values: Record<string, string | number>; valueLang?: string }) {
  return <>{respondentMessageParts(locale, message, values).map((part, index) => <Fragment key={index}>{part.kind === "isolate" ? <bdi lang={valueLang} dir="auto">{part.text}</bdi> : part.text}</Fragment>)}</>;
}

export function RespondentShell({ token, initialLocale = "en-AU" }: { token: string; initialLocale?: RespondentLocale }) {
  const toast = useToast();
  const [locale, setLocale] = useState<RespondentLocale>(initialLocale);
  const localeRef = useRef<RespondentLocale>(initialLocale);
  localeRef.current = locale;
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<Loaded | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [locked, setLocked] = useState(false);
  const [closed, setClosed] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [staleDraft, setStaleDraft] = useState<{ question: Question; patch: Patch[string] }[]>([]);
  const [conflictDraftOpen, setConflictDraftOpen] = useState(false);
  const [counts, setCounts] = useState({ answered: 0, total: 0, needsAttention: [] as { question: Question; reason: string }[] });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitProblems, setSubmitProblems] = useState<Record<string, string>>({});
  const [recordGroups, setRecordGroups] = useState<RepeatRecordMap>({});
  const [rejectedRecordDrafts, setRejectedRecordDrafts] = useState<RejectedRecordDraft[]>([]);
  const [submitError, setSubmitError] = useState("");
  const [frameReady, setFrameReady] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [questionNavOpen, setQuestionNavOpen] = useState(false);
  const [guidedMode, setGuidedMode] = useState(false);
  const [guidedSectionId, setGuidedSectionId] = useState<string | null>(null);
  const [guidedQuestionId, setGuidedQuestionId] = useState<string | null>(null);
  const [guidedError, setGuidedError] = useState(false);
  const [guidedAnnouncement, setGuidedAnnouncement] = useState("");
  const [guidedQuestionAnnouncement, setGuidedQuestionAnnouncement] = useState<{ index: number; total: number; label: string; message: "questionAnnouncement" | "availableQuestionAnnouncement" } | null>(null);
  const [lengthDrafts, setLengthDrafts] = useState<Record<string, { question: Question; count: number; max: number }>>({});
  const [questionnaireLanguage, setQuestionnaireLanguage] = useState<string | undefined>();

  const frame = useRef<HTMLIFrameElement>(null);
  const questionNavTrigger = useRef<HTMLButtonElement>(null);
  const guidedErrorRef = useRef<HTMLDivElement>(null);
  const answers = useRef<AnswerMap>({});
  const recordGroupsRef = useRef<RepeatRecordMap>({});
  const authoritativeRecordGroupsRef = useRef<RepeatRecordMap>({});
  const version = useRef(0);
  const refreshRequiredRef = useRef(false);
  const staleDraftRef = useRef<{ question: Question; patch: Patch[string] }[]>([]);
  const questions = useRef<Question[]>([]);
  const eligibility = useRef<Record<string, boolean>>({});
  const pending = useRef<Patch>({});
  const pendingRecordOperations = useRef<PendingRecordOperation[]>([]);
  const rejectedRecordDraftsRef = useRef<RejectedRecordDraft[]>([]);
  const focusQuestionAfterClose = useRef<string | null>(null);
  const submittedStatusRef = useRef<HTMLDivElement>(null);
  const submittedFocusPending = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef(false);
  const lockedRef = useRef(false);
  const attempts = useRef(0);
  const localeMeta = RESPONDENT_LOCALE_META[locale];
  const t = (key: RespondentMessage, values: Record<string, string | number> = {}) => respondentMessage(locale, key, values);
  const submitted = data?.participant.status === "submitted";

  useEffect(() => {
    if (!submitted || !submittedFocusPending.current) return;
    submittedFocusPending.current = false;
    submittedStatusRef.current?.focus();
  }, [submitted]);

  const changeLocale = (value: string) => {
    if (!(value in RESPONDENT_LOCALE_META)) return;
    const next = value as RespondentLocale;
    setLocale(next);
    try {
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `kqa-respondent-locale=${encodeURIComponent(next)}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
    } catch { /* The current page still uses the selected locale if cookie storage is unavailable. */ }
  };

  const recount = useCallback(() => {
    const qs = questions.current;
    const active = qs.filter((q) => eligibility.current[q.id] !== false);
    const needsAttention: { question: Question; reason: string }[] = [];
    const addAttention = (question: Question, reason: string) => {
      const existing = needsAttention.find((item) => item.question.id === question.id);
      if (existing) existing.reason += ` ${reason}`;
      else needsAttention.push({ question, reason });
    };
    for (const question of active) {
      const rows = (recordGroupsRef.current[question.id] ?? []).filter((row) => !row.deletedAt);
      if (question.type === "repeat") {
        repeatAttentionReasons(
          question,
          rows,
          respondentMessage(localeRef.current, "requiredError"),
          (count) => respondentMessage(localeRef.current, "repeatMinRows", { count, item: question.itemLabel ?? defaultRepeatItem(localeRef.current) }),
        ).forEach((reason) => addAttention(question, reason));
        continue;
      }
      if (question.required && !hasValue(answers.current[question.id]?.value)) addAttention(question, respondentMessage(localeRef.current, "requiredError"));
      const value = answers.current[question.id]?.value;
      if (question.type === "multi" && question.maxSelections !== undefined && Array.isArray(value) && new Set(value).size > question.maxSelections) {
        addAttention(question, respondentMessage(localeRef.current, "maxSelections", { count: question.maxSelections }));
      }
      if (question.type === "multi" && question.minSelections !== undefined && Array.isArray(value) && new Set(value).size > 0 && new Set(value).size < question.minSelections) {
        addAttention(question, respondentMessage(localeRef.current, "minSelections", { count: question.minSelections }));
      }
      if (question.type === "multi" && Array.isArray(value) && value.some((item) => question.exclusiveOptions?.includes(item)) && new Set(value).size > 1) {
        addAttention(question, respondentMessage(localeRef.current, "exclusiveError"));
      }
    }
    setCounts({ answered: active.filter((q) => q.type === "repeat" ? (recordGroupsRef.current[q.id] ?? []).some((row) => !row.deletedAt) : hasValue(answers.current[q.id]?.value)).length, total: active.length, needsAttention });
  }, []);
  useEffect(() => { recount(); }, [locale, recount]);

  const post = useCallback((msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ kqa: 1, ...msg }, "*"), []);

  const displayedQuestions = questionsInPresentationOrder(questions.current, data?.questionOrder);
  const questionGroups = buildQuestionNavigation(displayedQuestions, data?.sections ?? [], eligibility.current, t("otherQuestions"));
  const questionGuidedMode = data?.presentation === "guided-question";
  const guidedQuestions = displayedQuestions.filter((question) => eligibility.current[question.id] !== false);
  const activeGuidedQuestion = guidedQuestions.find((question) => question.id === guidedQuestionId) ?? null;
  const activeGuidedQuestionIndex = activeGuidedQuestion ? guidedQuestions.findIndex((question) => question.id === activeGuidedQuestion.id) : -1;
  const activeGuidedGroup = questionGroups.find((group) => group.id === guidedSectionId) ?? null;
  const activeGuidedIndex = activeGuidedGroup ? questionGroups.findIndex((group) => group.id === activeGuidedGroup.id) : -1;
  const guidedStepIssues = questionGuidedMode
    ? counts.needsAttention.filter((item) => item.question.id === guidedQuestionId)
    : activeGuidedGroup
    ? counts.needsAttention.filter((item) => activeGuidedGroup.questions.some((question) => question.id === item.question.id))
    : [];

  const goToGuidedGroup = useCallback((id: string, focusId?: string) => {
    const groups = buildQuestionNavigation(questionsInPresentationOrder(questions.current, data?.questionOrder), data?.sections ?? [], eligibility.current, respondentMessage(locale, "otherQuestions"));
    const group = groups.find((item) => item.id === id);
    if (!group) return;
    setGuidedSectionId(group.id);
    setGuidedQuestionId(null);
    setGuidedError(false);
    setGuidedAnnouncement(`${t("section", { index: groups.findIndex((item) => item.id === id) + 1, total: groups.length })}: ${group.title}`);
    post({ type: "guided", enabled: true, section: group.id, questionMode: false });
    const target = focusId ?? group.questions[0]?.id;
    if (target) post({ type: "focus-question", id: target });
  }, [data?.questionOrder, data?.sections, locale, post]);

  const goToGuidedQuestion = useCallback((id: string) => {
    const question = questionsInPresentationOrder(questions.current, data?.questionOrder).find((item) => item.id === id && eligibility.current[item.id] !== false);
    if (!question) return;
    const groups = buildQuestionNavigation(questionsInPresentationOrder(questions.current, data?.questionOrder), data?.sections ?? [], eligibility.current, respondentMessage(locale, "otherQuestions"));
    const orderedEligible = questionsInPresentationOrder(questions.current, data?.questionOrder).filter((item) => eligibility.current[item.id] !== false);
    const index = orderedEligible.findIndex((item) => item.id === id);
    setGuidedSectionId(question.section ?? "__unsectioned");
    setGuidedQuestionId(id);
    setGuidedError(false);
    setGuidedQuestionAnnouncement({ index: index + 1, total: orderedEligible.length, label: question.label, message: "questionAnnouncement" });
    post({ type: "guided", enabled: true, section: question.section ?? "__unsectioned", question: id, questionMode: true });
    post({ type: "focus-question", id });
  }, [data?.questionOrder, data?.sections, locale, post]);

  useEffect(() => {
    if (data?.presentation !== "guided" && data?.presentation !== "guided-question") return;
    if (data.presentation === "guided-question") {
      const first = questionsInPresentationOrder(questions.current, data.questionOrder).find((question) => eligibility.current[question.id] !== false);
      if (first && !guidedQuestionId) {
        setGuidedQuestionId(first.id);
        setGuidedSectionId(first.section ?? "__unsectioned");
        setGuidedQuestionAnnouncement({ index: 1, total: questionsInPresentationOrder(questions.current, data.questionOrder).filter((question) => eligibility.current[question.id] !== false).length, label: first.label, message: "questionAnnouncement" });
      }
      setGuidedMode(true);
      return;
    }
    const first = buildQuestionNavigation(questions.current, data.sections ?? [], eligibility.current, t("otherQuestions"))[0];
    if (first && !guidedSectionId) setGuidedSectionId(first.id);
    setGuidedMode(true);
  }, [data, guidedQuestionId, guidedSectionId]);

  useEffect(() => {
    if (questionGuidedMode && guidedMode && data) {
      const orderedQuestions = questionsInPresentationOrder(questions.current, data.questionOrder);
      const available = orderedQuestions.filter((question) => eligibility.current[question.id] !== false);
      if (!available.length) return;
      if (!available.some((question) => question.id === guidedQuestionId)) {
        const previousIndex = orderedQuestions.findIndex((question) => question.id === guidedQuestionId);
        const next = available.find((question) => orderedQuestions.findIndex((item) => item.id === question.id) > previousIndex) ?? available[available.length - 1];
        setGuidedQuestionId(next.id);
        setGuidedSectionId(next.section ?? "__unsectioned");
        setGuidedError(false);
        const index = available.findIndex((question) => question.id === next.id);
        setGuidedQuestionAnnouncement({ index: index + 1, total: available.length, label: next.label, message: "availableQuestionAnnouncement" });
        if (frameReady) {
          post({ type: "guided", enabled: true, section: next.section ?? "__unsectioned", question: next.id, questionMode: true });
          post({ type: "focus-question", id: next.id });
        }
      }
      return;
    }
    if (!guidedMode || !data) return;
    const groups = buildQuestionNavigation(questions.current, data.sections ?? [], eligibility.current, t("otherQuestions"));
    if (!groups.length) return;
    if (!groups.some((group) => group.id === guidedSectionId)) {
      const next = groups[0];
      setGuidedSectionId(next.id);
      setGuidedError(false);
      setGuidedAnnouncement(`${t("availableChanged")}: ${next.title}.`);
      if (frameReady) post({ type: "guided", enabled: true, section: next.id });
    }
  }, [counts, data, frameReady, guidedMode, guidedSectionId, guidedQuestionId, locale, post, questionGuidedMode]);

  useEffect(() => {
    if (questionGuidedMode && guidedMode && activeGuidedQuestion) {
      post({ type: "guided", enabled: true, section: activeGuidedQuestion.section ?? "__unsectioned", question: activeGuidedQuestion.id, questionMode: true });
      if (frameReady) post({ type: "focus-question", id: activeGuidedQuestion.id });
      return;
    }
    if (!guidedMode || !activeGuidedGroup) return;
    post({ type: "guided", enabled: true, section: activeGuidedGroup.id });
  }, [activeGuidedGroup?.id, activeGuidedQuestion?.id, frameReady, guidedMode, post, questionGuidedMode]);

  useEffect(() => {
    if (confirming || !focusQuestionAfterClose.current) return;
    const id = focusQuestionAfterClose.current;
    focusQuestionAfterClose.current = null;
    const targetQuestion = questions.current.find((question) => question.id === id);
    if (guidedMode && questionGuidedMode) goToGuidedQuestion(id);
    else if (guidedMode && targetQuestion?.section) goToGuidedGroup(targetQuestion.section, id);
    else post({ type: "focus-question", id });
  }, [confirming, goToGuidedGroup, goToGuidedQuestion, guidedMode, post, questionGuidedMode]);

  const applyLock = useCallback((v: boolean) => { lockedRef.current = v; setLocked(v); post({ type: "lock", locked: v }); }, [post]);
  const reloadLatestVersion = useCallback(() => {
    staleDraftRef.current = [];
    window.location.reload();
  }, []);
  const handleVersionConflict = useCallback((failedBatch: Patch = {}, failedRecords: PendingRecordOperation[] = []) => {
    const rejected = mergePatches(failedBatch, pending.current);
    const draft = Object.entries(rejected).flatMap(([id, patch]) => {
      const question = questions.current.find((item) => item.id === id);
      return question ? [{ question, patch }] : [];
    });
    staleDraftRef.current = draft;
    if (failedRecords.length) {
      const records = failedRecords.map(({ operationId, operation }) => ({ operationId, operation, reason: respondentMessage(localeRef.current, "previousDraftWarning") }));
      rejectedRecordDraftsRef.current = [...rejectedRecordDraftsRef.current, ...records];
      setRejectedRecordDrafts(rejectedRecordDraftsRef.current);
      recordGroupsRef.current = authoritativeRecordGroupsRef.current;
      setRecordGroups(recordGroupsRef.current);
      post({ type: "record-rejected", recordGroups: recordGroupsRef.current, rejectedOperationIds: failedRecords.map((item) => item.operationId), recordErrors: [] });
      recount();
    }
    setStaleDraft(draft);
    pending.current = {};
    pendingRecordOperations.current = [];
    clearTimeout(timer.current);
    clearTimeout(retry.current);
    refreshRequiredRef.current = true;
    setRefreshRequired(true);
    setSave("idle");
    applyLock(true);
  }, [applyLock, post, recount]);

  // ---- load
  const load = useCallback(async () => {
    setPhase("loading");
    const res = await api<Loaded & { ok: boolean }>(`/api/p/${token}`, { headers: { "X-KQA-Client": "respondent" } });
    if (res.status === 404) { setPhase("invalid"); return; }
    if (!res.ok || !res.data.questions) { setPhase("error"); return; }
    version.current = res.data.version;
    refreshRequiredRef.current = false;
    staleDraftRef.current = [];
    setStaleDraft([]);
    setConflictDraftOpen(false);
    setRefreshRequired(false);
    answers.current = res.data.answers ?? {};
    recordGroupsRef.current = res.data.recordGroups ?? {};
    authoritativeRecordGroupsRef.current = recordGroupsRef.current;
    setRecordGroups(recordGroupsRef.current);
    pendingRecordOperations.current = [];
    rejectedRecordDraftsRef.current = [];
    setRejectedRecordDrafts([]);
    questions.current = res.data.questions;
    eligibility.current = res.data.progress?.eligible ?? Object.fromEntries(res.data.questions.map((q) => [q.id, true]));
    setData(res.data);
    setClosed(res.data.interview.status === "closed");
    lockedRef.current = res.data.participant.status === "submitted" || res.data.interview.status === "closed";
    setLocked(lockedRef.current);
    recount();
    setPhase("ready");
  }, [token, recount]);
  useEffect(() => { void load(); }, [load]);

  // ---- saving
  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (inflight.current) return;
    const batch = pending.current;
    const recordBatch = pendingRecordOperations.current;
    if (!Object.keys(batch).length && !recordBatch.length) return;
    pending.current = {};
    pendingRecordOperations.current = [];
    inflight.current = true;
    setSave("saving");
    const res = await api<{ savedAt: string; code?: string; details?: { id: string; reason: string }[]; recordGroups?: RepeatRecordMap; recordErrors?: { questionId: string; rowId?: string; fieldId?: string; reason: string }[] }>(`/api/p/${token}/answers`, { method: "PUT", body: { version: version.current, answers: batch, recordOperations: recordBatch.map((item) => item.operation) } });
    inflight.current = false;
    if (res.ok) {
      attempts.current = 0;
      if (res.data.recordGroups) {
        authoritativeRecordGroupsRef.current = { ...authoritativeRecordGroupsRef.current, ...res.data.recordGroups };
        recordGroupsRef.current = pendingRecordOperations.current.reduce((groups, item) => applyRecordOperation(groups, item.operation), authoritativeRecordGroupsRef.current);
        setRecordGroups(recordGroupsRef.current);
        recount();
      }
      post({ type: "record-groups", recordGroups: res.data.recordGroups ?? {}, ackOperationIds: recordBatch.map((item) => item.operationId) });
      setLastSaved(new Date(res.data.savedAt));
      if (Object.keys(pending.current).length || pendingRecordOperations.current.length) { setSave("saving"); timer.current = setTimeout(flush, 350); } else setSave("saved");
      return;
    }
    if (res.status === 0 || res.status >= 500 || res.status === 429) {
      // Network or server trouble: keep the changes and try again, newest edits winning.
      pending.current = mergePatches(batch, pending.current);
      pendingRecordOperations.current = [...recordBatch, ...pendingRecordOperations.current];
      setSave(navigator.onLine ? "error" : "offline");
      attempts.current += 1;
      retry.current = setTimeout(flush, Math.min(30000, 1500 * 2 ** Math.min(attempts.current, 5)));
      return;
    }
    if (res.status === 409 && res.data.code === "questionnaire_version_changed") {
      handleVersionConflict(batch, recordBatch);
      return;
    }
    if (res.status === 403 || res.status === 409) {
      setSave("idle");
      pendingRecordOperations.current = [...recordBatch, ...pendingRecordOperations.current];
      applyLock(true);
      toast(t("lockedError"), "err", localeMeta);
      return;
    }
    // 400/404: the server refused a value. Show why, then put the page back to what is actually saved.
    setSave("error");
    toast(t("couldNotSave"), "err", localeMeta);
    const reasons = res.data.recordErrors ?? [];
    if (reasons.length && Object.keys(batch).length) {
      // Record operations reject atomically. Retry valid scalar edits by themselves, while
      // excluding any scalar ids the same response explicitly rejected to avoid retry loops.
      pending.current = mergePatches(retryableScalarPatch(batch, res.data.details ?? []), pending.current);
    }
    const rejected = recordBatch.map(({ operationId, operation }) => {
      const issue = reasons.find((item) => item.questionId === operation.questionId && (!item.rowId || item.rowId === operation.rowId) && (!item.fieldId || ("fieldId" in operation && item.fieldId === operation.fieldId)));
      return { operationId, operation, reason: issue?.reason ?? res.data.details?.[0]?.reason ?? t("couldNotSave") };
    });
    if (rejected.length) {
      rejectedRecordDraftsRef.current = [...rejectedRecordDraftsRef.current, ...rejected];
      setRejectedRecordDrafts(rejectedRecordDraftsRef.current);
    }
    recordGroupsRef.current = pendingRecordOperations.current.reduce((groups, item) => applyRecordOperation(groups, item.operation), authoritativeRecordGroupsRef.current);
    setRecordGroups(recordGroupsRef.current);
    recount();
    const fresh = await api<Loaded>(`/api/p/${token}`);
    if (fresh.ok && fresh.data.answers) {
      const restoredAnswers: AnswerMap = { ...fresh.data.answers };
      for (const [id, patch] of Object.entries(pending.current)) {
        const answer = { ...(restoredAnswers[id] ?? { updatedAt: new Date().toISOString() }) };
        if ("value" in patch) { if (hasValue(patch.value)) answer.value = patch.value as AnswerValue; else delete answer.value; }
        if ("note" in patch) { if (typeof patch.note === "string" && patch.note !== "") answer.note = patch.note; else delete answer.note; }
        if (answer.value === undefined && answer.note === undefined) delete restoredAnswers[id]; else restoredAnswers[id] = answer;
      }
      answers.current = restoredAnswers;
      authoritativeRecordGroupsRef.current = fresh.data.recordGroups ?? {};
      recordGroupsRef.current = pendingRecordOperations.current.reduce((groups, item) => applyRecordOperation(groups, item.operation), authoritativeRecordGroupsRef.current);
      setRecordGroups(recordGroupsRef.current);
      if (recordBatch.length) post({ type: "record-rejected", recordGroups: recordGroupsRef.current, rejectedOperationIds: recordBatch.map((item) => item.operationId), recordErrors: reasons });
      if (fresh.data.progress?.eligible) eligibility.current = fresh.data.progress.eligible;
      post({ type: "answers", answers: restoredAnswers });
      recount();
      if (Object.keys(pending.current).length || pendingRecordOperations.current.length) {
        setSave("saving");
        timer.current = setTimeout(flush, 350);
      } else setSave("saved");
    } else {
      if (recordBatch.length) post({ type: "record-rejected", recordGroups: recordGroupsRef.current, rejectedOperationIds: recordBatch.map((item) => item.operationId), recordErrors: reasons });
      if (Object.keys(pending.current).length || pendingRecordOperations.current.length) {
        setSave("saving");
        timer.current = setTimeout(flush, 350);
      }
    }
  }, [token, applyLock, handleVersionConflict, post, recount, toast, locale]);

  const queue = useCallback((id: string, part: { value?: unknown; note?: unknown }) => {
    if (lockedRef.current) return;
    setSubmitProblems((current) => {
      if (!(id in current)) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
    setSubmitError("");
    const cur = answers.current[id] ?? { updatedAt: new Date().toISOString() };
    const next = { ...cur };
    if ("value" in part) { if (hasValue(part.value)) next.value = part.value as never; else delete next.value; }
    if ("note" in part) { if (typeof part.note === "string" && part.note !== "") next.note = part.note; else delete next.note; }
    if (next.value === undefined && next.note === undefined) delete answers.current[id]; else answers.current[id] = next;
    pending.current[id] = { ...pending.current[id], ...("value" in part ? { value: hasValue(part.value) ? part.value : null } : {}), ...("note" in part ? { note: part.note ?? null } : {}) };
    recount();
    setSave(navigator.onLine ? "saving" : "offline");
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 600);
  }, [flush, recount]);

  // ---- messages from the questionnaire frame
  useEffect(() => {
    function onMessage(ev: MessageEvent) {
      if (ev.source !== frame.current?.contentWindow || ev.origin !== "null") return; // the sandboxed frame has an opaque origin
      const m = ev.data;
      if (!m || m.kqa !== 1) return;
      if (m.type === "open" && typeof m.url === "string" && /^(https?:|mailto:|tel:)/i.test(m.url)) {
        window.open(m.url, "_blank", "noopener,noreferrer");
      } else if (m.type === "hello") {
        if (typeof m.lang === "string" && m.lang) setQuestionnaireLanguage(m.lang);
        const questionMode = data?.presentation === "guided-question";
        const initialGuidedQuestion = questionMode
          ? guidedQuestionId ?? questionsInPresentationOrder(questions.current, data?.questionOrder).find((question) => eligibility.current[question.id] !== false)?.id ?? null
          : null;
        const initialGuidedQuestionData = initialGuidedQuestion ? questions.current.find((question) => question.id === initialGuidedQuestion) : null;
        if (questionMode && initialGuidedQuestion) {
          setGuidedQuestionId(initialGuidedQuestion);
          setGuidedSectionId(initialGuidedQuestionData?.section ?? "__unsectioned");
          const orderedEligible = questionsInPresentationOrder(questions.current, data?.questionOrder).filter((question) => eligibility.current[question.id] !== false);
          setGuidedQuestionAnnouncement({ index: orderedEligible.findIndex((question) => question.id === initialGuidedQuestion) + 1, total: orderedEligible.length, label: initialGuidedQuestionData?.label ?? "", message: "questionAnnouncement" });
        }
        post({ type: "init", questions: questions.current, questionOrderGroups: data?.questionOrderGroups ?? [], questionOrderAssignment: data?.questionOrderAssignment, answers: answers.current, recordGroups: recordGroupsRef.current, participant: { name: data?.participant.name }, locked: lockedRef.current, probe: false, preview: false, guided: data?.presentation === "guided" || questionMode, guidedSection: initialGuidedQuestionData?.section ?? guidedSectionId, guidedQuestion: initialGuidedQuestion, guidedQuestionMode: questionMode, locale, messages: respondentBridgeMessages(locale) });
        setFrameReady(true);
      } else if (m.type === "set" && typeof m.id === "string") {
        const part: { value?: unknown; note?: unknown } = {};
        if ("value" in m) part.value = m.value;
        if ("note" in m) part.note = m.note;
        queue(m.id, part);
      } else if (m.type === "record-operation" && typeof m.operationId === "string" && m.operation && typeof m.operation === "object" && !lockedRef.current) {
        const operation = m.operation as RepeatRecordOperation;
        if (!["add", "set", "clear", "remove"].includes(operation.op) || typeof operation.questionId !== "string" || typeof operation.rowId !== "string") return;
        if (pendingRecordOperations.current.some((item) => item.operationId === m.operationId) || rejectedRecordDraftsRef.current.some((item) => item.operationId === m.operationId)) return;
        recordGroupsRef.current = applyRecordOperation(recordGroupsRef.current, operation);
        setRecordGroups(recordGroupsRef.current);
        pendingRecordOperations.current = [...pendingRecordOperations.current, { operationId: m.operationId, operation }];
        recount();
        setSave(navigator.onLine ? "saving" : "offline");
        clearTimeout(timer.current);
        timer.current = setTimeout(flush, 600);
      } else if (m.type === "length-draft" && typeof m.id === "string") {
        const question = questions.current.find((item) => item.id === m.id);
        if (m.valid === true) setLengthDrafts((current) => { if (!(m.id in current)) return current; const next = { ...current }; delete next[m.id]; return next; });
        else if (question && Number.isInteger(m.count) && Number.isInteger(m.max)) setLengthDrafts((current) => ({ ...current, [m.id]: { question, count: m.count as number, max: m.max as number } }));
      } else if (m.type === "eligibility" && m.eligible && typeof m.eligible === "object" && !Array.isArray(m.eligible)) {
        const next: Record<string, boolean> = {};
        for (const question of questions.current) next[question.id] = (m.eligible as Record<string, unknown>)[question.id] !== false;
        eligibility.current = next;
        recount();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [data, flush, guidedQuestionId, guidedSectionId, locale, post, queue, recount]);

  useEffect(() => {
    if (frameReady) post({ type: "locale", locale, messages: respondentBridgeMessages(locale) });
  }, [frameReady, locale, post]);

  // ---- connectivity and leaving the page
  useEffect(() => {
    const online = () => { post({ type: "offline", offline: false }); if (Object.keys(pending.current).length || pendingRecordOperations.current.length) { setSave("saving"); void flush(); } };
    const offline = () => { post({ type: "offline", offline: true }); setSave("offline"); };
    const hide = () => {
      if (document.visibilityState === "hidden" && (Object.keys(pending.current).length || pendingRecordOperations.current.length) && !inflight.current) {
        clearTimeout(timer.current);
        const batch = pending.current;
        const recordBatch = pendingRecordOperations.current;
        pending.current = {};
        pendingRecordOperations.current = [];
        inflight.current = true;
        setSave("saving");
        void api<{ savedAt?: string; code?: string; recordGroups?: RepeatRecordMap }>(`/api/p/${token}/answers`, {
          method: "PUT", body: { version: version.current, answers: batch, recordOperations: recordBatch.map((item) => item.operation) }, keepalive: true,
        }).then((res) => {
          inflight.current = false;
          if (res.ok) {
            attempts.current = 0;
            if (res.data.recordGroups) {
              authoritativeRecordGroupsRef.current = { ...authoritativeRecordGroupsRef.current, ...res.data.recordGroups };
              recordGroupsRef.current = pendingRecordOperations.current.reduce((groups, item) => applyRecordOperation(groups, item.operation), authoritativeRecordGroupsRef.current);
              setRecordGroups(recordGroupsRef.current);
              recount();
            }
            post({ type: "record-groups", recordGroups: res.data.recordGroups ?? {}, ackOperationIds: recordBatch.map((item) => item.operationId) });
            if (res.data.savedAt) setLastSaved(new Date(res.data.savedAt));
            if (Object.keys(pending.current).length || pendingRecordOperations.current.length) { setSave("saving"); timer.current = setTimeout(flush, 350); }
            else setSave("saved");
            return;
          }
          if (res.status === 409 && res.data.code === "questionnaire_version_changed") {
            handleVersionConflict(batch, recordBatch);
            return;
          }
          pending.current = mergePatches(batch, pending.current);
          pendingRecordOperations.current = [...recordBatch, ...pendingRecordOperations.current];
          if (res.status === 0 || res.status >= 500 || res.status === 429) {
            setSave(navigator.onLine ? "error" : "offline");
            attempts.current += 1;
            retry.current = setTimeout(flush, Math.min(30000, 1500 * 2 ** Math.min(attempts.current, 5)));
          } else {
            setSave("failed");
            if (res.status === 403 || res.status === 409) applyLock(true);
            if (document.visibilityState === "visible") toast(t("notSavedYet"), "err", localeMeta);
          }
        });
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", hide); clearTimeout(timer.current); clearTimeout(retry.current); };
  }, [applyLock, flush, handleVersionConflict, post, token, toast, locale]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length || pendingRecordOperations.current.length || rejectedRecordDraftsRef.current.length || inflight.current || staleDraftRef.current.length || Object.keys(lengthDrafts).length) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [lengthDrafts]);

  // ---- submit
  async function submit() {
    if (Object.keys(lengthDrafts).length) return;
    setSubmitting(true);
    clearTimeout(timer.current);
    for (let i = 0; i < 20 && inflight.current; i++) await new Promise((r) => setTimeout(r, 150));
    await flush();
    for (let i = 0; i < 20 && inflight.current; i++) await new Promise((r) => setTimeout(r, 150));
    if (refreshRequiredRef.current) { setSubmitting(false); setConfirming(false); return; }
    if (Object.keys(pending.current).length || pendingRecordOperations.current.length) { setSubmitting(false); toast(t("notSavedYet"), "err", localeMeta); return; }
    const res = await api<{ submittedAt: string; code?: string; missing?: { id: string; label: string }[]; invalidSelections?: { id: string; selected: number; maximum: number }[]; invalidMinimumSelections?: { id: string; selected: number; minimum: number }[]; invalidExclusiveSelections?: { id: string }[]; invalidRankSelections?: { id: string }[]; repeatErrors?: { questionId: string; rowId?: string; fieldId?: string; reason: string }[] }>(`/api/p/${token}/submit`, { method: "POST", body: { version: version.current } });
    setSubmitting(false);
    if (res.ok) {
      submittedFocusPending.current = true;
      setConfirming(false);
      setSubmitProblems({});
      setSubmitError("");
      applyLock(true);
      setData((d) => (d ? { ...d, participant: { ...d.participant, status: "submitted", submittedAt: res.data.submittedAt } } : d));
      setSave("idle");
    } else {
      if (res.status === 409 && res.data.code === "questionnaire_version_changed") {
        setConfirming(false);
        handleVersionConflict();
        return;
      }
      if (res.status === 422) {
        const problems: Record<string, string> = {};
        for (const item of res.data.missing ?? []) problems[item.id] = t("requiredError");
        for (const item of res.data.invalidSelections ?? []) problems[item.id] = t("maxSelections", { count: item.maximum });
        for (const item of res.data.invalidMinimumSelections ?? []) problems[item.id] = t("minSelections", { count: item.minimum });
        for (const item of res.data.invalidExclusiveSelections ?? []) problems[item.id] = t("exclusiveError");
        for (const item of res.data.invalidRankSelections ?? []) problems[item.id] = t("rankError");
        for (const item of res.data.repeatErrors ?? []) problems[item.questionId] = item.reason;
        setSubmitProblems(problems);
        setSubmitError(t("submitError"));
        recount();
        return;
      }
      setConfirming(false);
      toast(t("couldNotSubmit"), "err", localeMeta);
    }
  }

  const conflictDraftText = JSON.stringify({
    format: "kqa-unsaved-draft/1",
    questionnaireVersion: version.current,
    warning: t("previousDraftWarning"),
    changes: staleDraft.map(({ question, patch }) => ({
      questionId: question.id,
      question: question.label,
      type: question.type,
      ...(Object.prototype.hasOwnProperty.call(patch, "value") ? {
        value: patch.value,
        displayValue: patch.value === null ? t("answerCleared") : displayValue(question, patch.value as AnswerValue),
      } : {}),
      ...(Object.prototype.hasOwnProperty.call(patch, "note") ? { note: patch.note, displayNote: patch.note === null ? t("noteCleared") : patch.note } : {}),
    })),
  }, null, 2);

  function continueGuided() {
    if (questionGuidedMode) {
      if (!activeGuidedQuestion || Object.keys(lengthDrafts).length) return;
      if (guidedStepIssues.length) {
        setGuidedError(true);
        window.setTimeout(() => guidedErrorRef.current?.focus(), 0);
        return;
      }
      setGuidedError(false);
      if (activeGuidedQuestionIndex >= guidedQuestions.length - 1) setConfirming(true);
      else goToGuidedQuestion(guidedQuestions[activeGuidedQuestionIndex + 1].id);
      return;
    }
    if (!activeGuidedGroup) return;
    if (Object.keys(lengthDrafts).length) return;
    if (guidedStepIssues.length) {
      setGuidedError(true);
      window.setTimeout(() => guidedErrorRef.current?.focus(), 0);
      return;
    }
    setGuidedError(false);
    if (activeGuidedIndex >= questionGroups.length - 1) setConfirming(true);
    else goToGuidedGroup(questionGroups[activeGuidedIndex + 1].id);
  }

  // ---- states other than the questionnaire
  if (phase === "loading") return <main className="center-page" lang={localeMeta.lang} dir={localeMeta.direction}><div className="hero"><LocalePicker locale={locale} label={t("language")} onChange={changeLocale} /><div className="row muted"><Spinner /> {t("loading")}</div></div></main>;
  if (phase === "invalid") {
    return (
      <main className="center-page" lang={localeMeta.lang} dir={localeMeta.direction}><div className="hero"><LocalePicker locale={locale} label={t("language")} onChange={changeLocale} /><BrandMark size={44} wordmark /><h1>{t("invalidTitle")}</h1><p className="muted">{t("invalidDescription")}</p></div></main>
    );
  }
  if (phase === "error" || !data) {
    return (
      <main className="center-page" lang={localeMeta.lang} dir={localeMeta.direction}><div className="hero"><LocalePicker locale={locale} label={t("language")} onChange={changeLocale} /><BrandMark size={44} wordmark /><h1>{t("errorTitle")}</h1><p className="muted">{t("errorDescription")}</p><button className="btn primary" onClick={() => void load()}>{t("retry")}</button></div></main>
    );
  }

  const pct = counts.total ? Math.round((counts.answered / counts.total) * 100) : 0;
  const hasUnsavedChanges = Object.keys(pending.current).length > 0 || pendingRecordOperations.current.length > 0 || rejectedRecordDrafts.length > 0;
  const firstLengthDraft = Object.values(lengthDrafts)[0];
  const lengthDraftHidden = firstLengthDraft ? eligibility.current[firstLengthDraft.question.id] === false : false;
  const lengthDraftSourceId = firstLengthDraft?.question.when?.all?.[0]?.question ?? firstLengthDraft?.question.when?.any?.[0]?.question;
  const lengthDraftFocusId = lengthDraftHidden && lengthDraftSourceId ? lengthDraftSourceId : firstLengthDraft?.question.id;
  const focusLengthDraft = () => {
    if (!firstLengthDraft || !lengthDraftFocusId) return;
    const target = questions.current.find((question) => question.id === lengthDraftFocusId);
    if (guidedMode && questionGuidedMode) goToGuidedQuestion(target?.id ?? "");
    else if (guidedMode && target?.section) goToGuidedGroup(target.section, target.id);
    else post({ type: "focus-question", id: lengthDraftFocusId });
  };
  const SAVE_LABEL: Record<SaveState, string> = { idle: submitted ? t("locked") : t("autosaveOn"), saving: t("saving"), saved: t("saved"), error: t("retrying"), failed: t("notSaved"), offline: hasUnsavedChanges ? t("offlinePending") : t("offline") };
  const reviewQuestions = displayedQuestions.filter((question) => eligibility.current[question.id] !== false);
  const hiddenQuestionCount = questions.current.length - reviewQuestions.length;
  const retainedAnswers = displayedQuestions.filter((question) => eligibility.current[question.id] === false && (
    hasValue(answers.current[question.id]?.value) || Boolean(answers.current[question.id]?.note)
  ));
  const retainedRecordGroups = displayedQuestions.filter((question) => question.type === "repeat" && eligibility.current[question.id] === false && (recordGroups[question.id] ?? []).some((row) => !row.deletedAt));
  const currentQuestionGroups = buildQuestionNavigation(displayedQuestions, data.sections ?? [], eligibility.current, t("otherQuestions"));
  const isQuestionAnswered = (question: Question) => question.type === "repeat"
    ? (recordGroups[question.id] ?? []).some((row) => !row.deletedAt)
    : hasValue(answers.current[question.id]?.value);
  const answeredInNavigation = reviewQuestions.filter(isQuestionAnswered).length;

  return (
    <div className="rs" lang={localeMeta.lang} dir={localeMeta.direction}>
      <div className="rs-bar">
        <div className="rs-bar-in">
          <BrandMark />
          <div className="rs-title"><b><bdi lang={questionnaireLanguage} dir="auto">{data.title}</bdi></b><span>{t("answerAs", { name: "" }).trim()} <bdi dir="auto">{data.participant.name}</bdi></span></div>
          <div className="right rs-bar-actions">
            <LocalePicker locale={locale} label={t("language")} onChange={changeLocale} />
            <div
              className="rs-progress"
              role="progressbar"
              aria-label={t("progressLabel")}
              aria-valuemin={0}
              aria-valuemax={Math.max(counts.total, 1)}
              aria-valuenow={counts.answered}
              aria-valuetext={t("progressValue", { answered: counts.answered, total: counts.total })}
            >
              <div className="bar"><i style={{ width: `${pct}%` }} /></div>
              <small>{t("countAnswered", { answered: counts.answered, total: counts.total })}</small>
            </div>
            <div className="rs-question-nav-wrap">
              <button
                ref={questionNavTrigger}
                className="btn rs-question-nav-trigger"
                type="button"
                aria-expanded={questionNavOpen}
                aria-controls="respondent-question-navigation"
                aria-label={`${t("browseQuestions")}, ${t("browseAnswered", { answered: answeredInNavigation, total: reviewQuestions.length })}`}
                disabled={!frameReady || locked}
                onClick={() => setQuestionNavOpen((open) => !open)}
              >
                {t("questions")}
              </button>
              {questionNavOpen && (
                <nav
                  id="respondent-question-navigation"
                  className="rs-question-nav"
                  aria-label={t("questionNavigation")}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setQuestionNavOpen(false);
                      questionNavTrigger.current?.focus();
                    }
                  }}
                >
                  <p className="rs-question-nav-hint">
                    {hiddenQuestionCount ? t("hiddenHint") : t("navigationHint")}
                  </p>
                  <div className="rs-question-nav-groups">
                    {currentQuestionGroups.map((group) => {
                      const answered = group.questions.filter(isQuestionAnswered).length;
                      return (
                        <section className="rs-question-nav-group" key={group.id} aria-labelledby={`rs-nav-section-${group.id}`}>
                          <div className="rs-question-nav-section-head">
                            <h2 id={`rs-nav-section-${group.id}`}><bdi lang={questionnaireLanguage} dir="auto">{group.title}</bdi></h2>
                            <span>{t("browseAnswered", { answered, total: group.questions.length })}</span>
                          </div>
                          {group.description && <p className="rs-question-nav-description"><bdi lang={questionnaireLanguage} dir="auto">{group.description}</bdi></p>}
                          <ul>
                            {group.questions.map((question) => {
                              const isAnswered = isQuestionAnswered(question);
                              return (
                                <li key={question.id}>
                                  <button
                                    type="button"
                                    className="rs-question-nav-item"
                                    onClick={() => {
                                      setQuestionNavOpen(false);
                                      if (guidedMode && questionGuidedMode) goToGuidedQuestion(question.id);
                                      else if (guidedMode) goToGuidedGroup(group.id, question.id);
                                      else post({ type: "focus-question", id: question.id });
                                    }}
                                  >
                                    <span><bdi lang={questionnaireLanguage} dir="auto">{question.label}</bdi></span>
                                    <small>{isAnswered ? t("answered") : question.required ? t("required") : t("notAnswered")}</small>
                                  </button>
                                </li>
                              );
                            })}
                          </ul>
                        </section>
                      );
                    })}
                  </div>
                </nav>
              )}
            </div>
            <span className={`save-state ${firstLengthDraft ? "failed" : save}`} role="status" aria-live="polite" title={firstLengthDraft ? t("overLimitTitle") : hasUnsavedChanges ? t("unsavedTitle") : lastSaved ? t("lastSaved", { time: respondentTime(locale, lastSaved) }) : SAVE_LABEL[save]}><i /><span className="rs-save-label">{firstLengthDraft ? t("textNotSaved") : SAVE_LABEL[save]}</span></span>
            <button className={`btn accent ${submitted ? "done" : ""}`} disabled={locked || Object.keys(lengthDrafts).length > 0} onClick={() => setConfirming(true)}>{submitted ? <><Icon name="check" size={16} /> {t("submitted")}</> : t("reviewAnswers")}</button>
          </div>
        </div>
      </div>

      <div ref={submittedStatusRef} tabIndex={submitted ? -1 : undefined} className={`rs-banner ${refreshRequired || (!submitted && closed) ? "warn" : submitted ? "ok" : "none"}`} role={refreshRequired ? "alert" : submitted || closed ? "status" : undefined}>
        {refreshRequired && <><Icon name="lock" size={16} /> {staleDraft.length > 0 ? t("changedDraft") : t("changedSaved")} <span className="row">{staleDraft.length > 0 && <button className="btn" onClick={() => setConflictDraftOpen(true)}>{t("reviewUnsaved")}</button>}<button className="btn" onClick={reloadLatestVersion}>{t("reloadQuestionnaire")}</button></span></>}
        {submitted && <><Icon name="check" size={16} /> {t("submittedMessage")}</>}
        {!refreshRequired && !submitted && closed && <><Icon name="lock" size={16} /> {t("closedMessage")}</>}
      </div>
      {firstLengthDraft && <div className="rs-banner warn" role="alert"><Icon name="alert" size={16} /> <LocalizedMessage locale={locale} message={lengthDraftHidden ? "lengthHidden" : "lengthOver"} values={{ question: firstLengthDraft.question.label, count: firstLengthDraft.count, max: firstLengthDraft.max }} valueLang={questionnaireLanguage} /> <button className="btn" type="button" onClick={focusLengthDraft}>{lengthDraftHidden ? t("reviewEarlier") : t("editResponse")}</button></div>}
      {rejectedRecordDrafts.length > 0 && <div className="rs-banner warn" role="alert"><Icon name="alert" size={16} /> {t("repeatRejectedCount", { count: rejectedRecordDrafts.length })} <button className="btn" type="button" onClick={() => setConfirming(true)}>{t("repeatRejectedTitle")}</button></div>}

      {guidedMode && activeGuidedGroup && (
        <section className="rs-guided" aria-label={t("questionnaireSections")}>
          <div className="rs-guided-step">
            <div>
              <p className="rs-guided-count" aria-current="step">{questionGuidedMode
                ? activeGuidedQuestion ? t("questionPosition", { index: activeGuidedQuestionIndex + 1, total: guidedQuestions.length }) : t("questionPosition", { index: 0, total: guidedQuestions.length })
                : t("section", { index: activeGuidedIndex + 1, total: questionGroups.length })}</p>
              {questionGuidedMode
                ? <><h1>{t("question")}</h1><p><bdi lang={questionnaireLanguage} dir="auto">{activeGuidedQuestion?.section ? activeGuidedGroup.title : t("otherQuestions")}</bdi></p></>
                : <><h1><bdi lang={questionnaireLanguage} dir="auto">{activeGuidedGroup.title}</bdi></h1>{activeGuidedGroup.description && <p><bdi lang={questionnaireLanguage} dir="auto">{activeGuidedGroup.description}</bdi></p>}</>}
            </div>
            <div className="rs-guided-actions">
              <button className="btn" type="button" disabled={(questionGuidedMode ? activeGuidedQuestionIndex <= 0 : activeGuidedIndex <= 0) || locked} onClick={() => questionGuidedMode
                ? activeGuidedQuestionIndex > 0 && goToGuidedQuestion(guidedQuestions[activeGuidedQuestionIndex - 1].id)
                : activeGuidedIndex > 0 && goToGuidedGroup(questionGroups[activeGuidedIndex - 1].id)}>{t("back")}</button>
              <button className="btn accent" type="button" disabled={locked || !frameReady || Object.keys(lengthDrafts).length > 0} onClick={continueGuided}>{(questionGuidedMode ? activeGuidedQuestionIndex === guidedQuestions.length - 1 : activeGuidedIndex === questionGroups.length - 1) ? t("reviewAnswers") : t("continue")}</button>
              <button className="btn" type="button" disabled={locked} onClick={() => { setGuidedMode(false); setGuidedError(false); post({ type: "guided", enabled: false }); }}>{t("showAll")}</button>
            </div>
          </div>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{guidedQuestionAnnouncement
            ? <LocalizedMessage locale={locale} message={guidedQuestionAnnouncement.message} values={{ index: guidedQuestionAnnouncement.index, total: guidedQuestionAnnouncement.total, question: guidedQuestionAnnouncement.label }} valueLang={questionnaireLanguage} />
            : guidedAnnouncement}</p>
          {guidedError && guidedStepIssues.length > 0 && (
            <div className="rs-guided-error" ref={guidedErrorRef} role="alert" tabIndex={-1} aria-labelledby="rs-guided-error-title">
              <h2 id="rs-guided-error-title">{t("checkSection")}</h2>
              <p>{t("resolveBeforeContinue")}</p>
              <ul>{guidedStepIssues.map(({ question, reason }) => <li key={question.id}><button type="button" onClick={() => post({ type: "focus-question", id: question.id })}><bdi lang={questionnaireLanguage} dir="auto">{question.label}</bdi>: {reason}</button></li>)}</ul>
            </div>
          )}
        </section>
      )}
      {guidedMode && (questionGuidedMode ? guidedQuestions.length === 0 : questionGroups.length === 0) && (
        <section className="rs-guided rs-guided-empty" aria-labelledby="rs-guided-empty-title">
          <div>
            <h1 id="rs-guided-empty-title">{t("noQuestions")}</h1>
            <p>{questionGuidedMode ? t("noEligibleQuestionsDescription") : t("noQuestionsDescription")}</p>
            <div className="rs-guided-actions">
              <button className="btn accent" type="button" onClick={() => setConfirming(true)}>{t("reviewAnswers")}</button>
            </div>
          </div>
        </section>
      )}

      <div className="rs-frame">
        {!frameReady && <div className="rs-loading"><span className="row"><Spinner /> {t("loadingQuestions")}</span></div>}
        <iframe
          ref={frame}
          src={`/api/frame/${token}`}
          title={data.title}
          sandbox="allow-scripts allow-forms"
          referrerPolicy="no-referrer"
        />
      </div>

      {confirming && (
        <Modal
          title={t("checkAnswers")}
          onClose={() => !submitting && setConfirming(false)}
          className="review-modal"
          actions={
            <>
              <button className="btn" disabled={submitting} onClick={() => setConfirming(false)}>{t("keepEditing")}</button>
              {!counts.needsAttention.length && <button className="btn accent" disabled={submitting || Object.keys(lengthDrafts).length > 0} onClick={submit}>{submitting && <Spinner />} {t("submitAnswers")}</button>}
            </>
          }
        >
          <div className="review-content">
            {firstLengthDraft && <div className="rs-guided-error" role="alert"><LocalizedMessage locale={locale} message="lengthReviewError" values={{ question: firstLengthDraft.question.label, max: firstLengthDraft.max }} valueLang={questionnaireLanguage} /> <button type="button" onClick={focusLengthDraft}>{t("editResponse")}</button></div>}
            <p className="muted">{t("reviewInstruction")}</p>
            {rejectedRecordDrafts.length > 0 && (
              <section className="rs-guided-error" role="alert" aria-labelledby="rs-record-rejected-title">
                <h2 id="rs-record-rejected-title">{t("repeatRejectedTitle")}</h2>
                <p>{t("repeatRejectedDescription")}</p>
                <div className="review-list">
                  {rejectedRecordDrafts.map((draft) => {
                    const question = questions.current.find((item) => item.id === draft.operation.questionId);
                    const field = question?.fields?.find((item) => "fieldId" in draft.operation && item.id === draft.operation.fieldId);
                    const value = draft.operation.op === "set" ? String(draft.operation.value) : draft.operation.op;
                    return <section className="review-entry" key={draft.operationId}>
                      <div className="review-entry-copy">
                        <h3>{question?.label ?? draft.operation.questionId}{field ? ` · ${field.label}` : ""}</h3>
                        <p className="review-value" style={{ whiteSpace: "pre-wrap" }}>{draft.operation.op === "clear" ? t("answerCleared") : value}</p>
                        <p className="review-problem">{draft.reason}</p>
                      </div>
                      <div className="review-entry-actions"><button className="btn" type="button" onClick={() => {
                        rejectedRecordDraftsRef.current = rejectedRecordDraftsRef.current.filter((item) => item.operationId !== draft.operationId);
                        setRejectedRecordDrafts(rejectedRecordDraftsRef.current);
                      }}>{t("repeatDiscardDraft")}</button></div>
                    </section>;
                  })}
                </div>
              </section>
            )}
            {counts.needsAttention.length || submitError ? (
              <p className="review-problems" role="alert">{submitError || t("resolveMarked")} {t("returnToQuestion")}</p>
            ) : null}
            <div className="review-list">
              {reviewQuestions.map((question) => {
                const answer = answers.current[question.id];
                const attention = counts.needsAttention.find((item) => item.question.id === question.id);
                const problem = attention?.reason ?? submitProblems[question.id];
                const answered = isQuestionAnswered(question);
                const rows = question.type === "repeat" ? (recordGroups[question.id] ?? []).filter((row) => !row.deletedAt) : [];
                return (
                  <section className="review-entry" key={question.id}>
                    <div className="review-entry-copy">
                    <h3><bdi lang={questionnaireLanguage} dir="auto">{question.label}</bdi></h3>
                    {question.type === "repeat" ? (
                      rows.length ? <div className="review-list">
                        {rows.map((row, rowIndex) => <section className="review-entry" key={row.id}>
                          <div className="review-entry-copy">
                            <h4>{repeatRowLabel(question, rowIndex + 1, locale)}</h4>
                            {(question.fields ?? []).map((field) => {
                              const value = row.values?.[field.id];
                              const fieldAnswer = value === undefined ? t("notAnsweredReview") : displayValue({ ...field, type: field.type } as Question, value as AnswerValue);
                              const requiredMissing = Boolean(field.required && !hasValue(value));
                              return <p className={requiredMissing ? "review-problem" : "review-value"} key={field.id}><strong>{field.label}</strong>: <bdi lang={questionnaireLanguage} dir="auto">{fieldAnswer}</bdi></p>;
                            })}
                          </div>
                        </section>)}
                      </div> : <p className="review-value">{t("notAnsweredReview")}</p>
                    ) : <p className="review-value" style={{ whiteSpace: "pre-wrap" }}>{answered ? <bdi lang={questionnaireLanguage} dir="auto">{displayValue(question, answer?.value)}</bdi> : t("notAnsweredReview")}</p>}
                    {answer?.note && <p className="review-note"><strong>{t("note")}</strong> <bdi lang={questionnaireLanguage} dir="auto">{answer.note}</bdi></p>}
                      {problem && <p className="review-problem">{problem}</p>}
                    </div>
                    <div className="review-entry-actions">
                      <button className="btn" disabled={submitting} onClick={() => { focusQuestionAfterClose.current = question.id; setConfirming(false); }}>{answered ? t("edit") : t("answer")}</button>
                      {answered && question.type !== "repeat" && <button className="btn" disabled={!frameReady || submitting || locked} aria-label={t("clearQuestionAnswer", { question: question.label })} onClick={() => post({ type: "clear-answer", id: question.id })}>{t("clear")}</button>}
                    </div>
                  </section>
                );
              })}
            </div>
            {hiddenQuestionCount > 0 && (
              <details className="review-retained">
                <summary>{t("hiddenQuestions", { count: retainedAnswers.length + retainedRecordGroups.length })}</summary>
                <p className="muted review-retention">{t("hiddenQuestionsDescription")}</p>
                {retainedAnswers.length ? (
                  <div className="review-list review-retained-list">
                    {retainedAnswers.map((question) => {
                      const answer = answers.current[question.id];
                      const answered = hasValue(answer?.value);
                      return (
                        <section className="review-entry" key={question.id}>
                          <div className="review-entry-copy">
                            <h3><bdi lang={questionnaireLanguage} dir="auto">{question.label}</bdi></h3>
                            {answered && <p className="review-value" style={{ whiteSpace: "pre-wrap" }}><bdi lang={questionnaireLanguage} dir="auto">{displayValue(question, answer?.value)}</bdi></p>}
                            {answer?.note && <p className="review-note"><strong>{t("note")}</strong> <bdi lang={questionnaireLanguage} dir="auto">{answer.note}</bdi></p>}
                          </div>
                          <div className="review-entry-actions">
                            {answered && <button className="btn" disabled={!frameReady || submitting || locked} aria-label={t("clearSavedAnswer", { question: question.label })} onClick={() => post({ type: "clear-answer", id: question.id })}>{t("clearAnswer")}</button>}
                            {answer?.note && <button className="btn" disabled={!frameReady || submitting || locked} aria-label={t("clearSavedNote", { question: question.label })} onClick={() => post({ type: "clear-note", id: question.id })}>{t("clearNote")}</button>}
                          </div>
                        </section>
                      );
                    })}
                  </div>
                ) : <p className="muted">{t("hiddenEmpty")}</p>}
                {retainedRecordGroups.map((question) => {
                  const rows = (recordGroups[question.id] ?? []).filter((row) => !row.deletedAt);
                  return <section className="review-entry" key={question.id}>
                    <div className="review-entry-copy">
                      <h3><bdi lang={questionnaireLanguage} dir="auto">{question.label}</bdi></h3>
                      {rows.map((row, rowIndex) => <div key={row.id}>
                        <h4>{repeatRowLabel(question, rowIndex + 1, locale)}</h4>
                        {(question.fields ?? []).map((field) => <p className="review-value" key={field.id}><strong>{field.label}</strong>: <bdi lang={questionnaireLanguage} dir="auto">{row.values?.[field.id] === undefined ? t("notAnsweredReview") : displayValue({ ...field, type: field.type } as Question, row.values[field.id] as AnswerValue)}</bdi></p>)}
                      </div>)}
                    </div>
                  </section>;
                })}
              </details>
            )}
          </div>
        </Modal>
      )}

      {conflictDraftOpen && staleDraft.length > 0 && (
        <Modal
          title={t("conflictTitle")}
          onClose={() => setConflictDraftOpen(false)}
          className="review-modal"
          actions={
            <>
              <button className="btn" onClick={() => setConflictDraftOpen(false)}>{t("keepReviewing")}</button>
              <button className="btn accent" onClick={reloadLatestVersion}>{t("reloadLatest")}</button>
            </>
          }
        >
          <div className="review-content">
            <p className="muted">{t("conflictDescription")}</p>
            <div className="review-list">
              {staleDraft.map(({ question, patch }) => (
                <section className="review-entry" key={question.id}>
                  <div className="review-entry-copy">
                    <h3><bdi lang={questionnaireLanguage} dir="auto">{question.label}</bdi></h3>
                    {Object.prototype.hasOwnProperty.call(patch, "value") && <p className="review-value" style={{ whiteSpace: "pre-wrap" }}>{patch.value === null ? t("answerCleared") : <bdi lang={questionnaireLanguage} dir="auto">{displayValue(question, patch.value as AnswerValue)}</bdi>}</p>}
                    {Object.prototype.hasOwnProperty.call(patch, "note") && <p className="review-note"><strong>{t("note")}</strong> {patch.note === null ? t("noteCleared") : <bdi lang={questionnaireLanguage} dir="auto">{String(patch.note)}</bdi>}</p>}
                  </div>
                </section>
              ))}
            </div>
            <div className="row between"><label htmlFor="conflict-draft-copy">{t("copyableDraft")}</label><CopyButton text={conflictDraftText} label={t("copyDraft")} done={t("copied")} failure={t("copyBlocked")} toastMetadata={localeMeta} /></div>
            <textarea id="conflict-draft-copy" className="conflict-draft-copy" readOnly rows={8} value={conflictDraftText} />
          </div>
        </Modal>
      )}
    </div>
  );
}
