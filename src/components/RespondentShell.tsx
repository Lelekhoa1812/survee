"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerMap, Question, Section } from "@/lib/format/schema";
import { displayValue } from "@/lib/format/answers";
import { api, BrandMark, Icon, Modal, Spinner, useToast } from "./ui";

type Phase = "loading" | "ready" | "invalid" | "error";
type SaveState = "idle" | "saving" | "saved" | "error" | "offline";
interface Loaded {
  participant: { name: string; status: "invited" | "in_progress" | "submitted"; submittedAt?: string };
  interview: { name: string; status: "open" | "closed" };
  version: number;
  title: string;
  sections?: Section[];
  questions: Question[];
  answers: AnswerMap;
  progress: { eligible?: Record<string, boolean> };
  presentation?: "all" | "guided";
}
type Patch = Record<string, { value?: unknown; note?: unknown }>;

const hasValue = (v: unknown) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : true);

export function buildQuestionNavigation(questions: Question[], sections: Section[], eligible: Record<string, boolean>) {
  const definitions = new Map(sections.map((section) => [section.id, section]));
  const groups: { id: string; title: string; description?: string; questions: Question[] }[] = [];
  const byId = new Map<string, (typeof groups)[number]>();
  for (const question of questions) {
    if (eligible[question.id] === false) continue;
    const id = question.section ?? "__unsectioned";
    let group = byId.get(id);
    if (!group) {
      const definition = definitions.get(id);
      group = { id, title: definition?.title ?? "Other questions", description: definition?.description, questions: [] };
      byId.set(id, group);
      groups.push(group);
    }
    group.questions.push(question);
  }
  return groups;
}

export function RespondentShell({ token }: { token: string }) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<Loaded | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [locked, setLocked] = useState(false);
  const [closed, setClosed] = useState(false);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [counts, setCounts] = useState({ answered: 0, total: 0, needsAttention: [] as { question: Question; reason: string }[] });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitProblems, setSubmitProblems] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState("");
  const [frameReady, setFrameReady] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [questionNavOpen, setQuestionNavOpen] = useState(false);
  const [guidedMode, setGuidedMode] = useState(false);
  const [guidedSectionId, setGuidedSectionId] = useState<string | null>(null);
  const [guidedError, setGuidedError] = useState(false);
  const [guidedAnnouncement, setGuidedAnnouncement] = useState("");

  const frame = useRef<HTMLIFrameElement>(null);
  const questionNavTrigger = useRef<HTMLButtonElement>(null);
  const guidedErrorRef = useRef<HTMLDivElement>(null);
  const answers = useRef<AnswerMap>({});
  const version = useRef(0);
  const refreshRequiredRef = useRef(false);
  const questions = useRef<Question[]>([]);
  const eligibility = useRef<Record<string, boolean>>({});
  const pending = useRef<Patch>({});
  const focusQuestionAfterClose = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef(false);
  const lockedRef = useRef(false);
  const attempts = useRef(0);

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
      if (question.required && !hasValue(answers.current[question.id]?.value)) addAttention(question, "Answer this required question.");
      const value = answers.current[question.id]?.value;
      if (question.type === "multi" && question.maxSelections !== undefined && Array.isArray(value) && new Set(value).size > question.maxSelections) {
        addAttention(question, `Choose no more than ${question.maxSelections} ${question.maxSelections === 1 ? "option" : "options"}.`);
      }
    }
    setCounts({ answered: active.filter((q) => hasValue(answers.current[q.id]?.value)).length, total: active.length, needsAttention });
  }, []);

  const post = useCallback((msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ kqa: 1, ...msg }, "*"), []);

  const questionGroups = buildQuestionNavigation(questions.current, data?.sections ?? [], eligibility.current);
  const activeGuidedGroup = questionGroups.find((group) => group.id === guidedSectionId) ?? null;
  const activeGuidedIndex = activeGuidedGroup ? questionGroups.findIndex((group) => group.id === activeGuidedGroup.id) : -1;
  const guidedStepIssues = activeGuidedGroup
    ? counts.needsAttention.filter((item) => activeGuidedGroup.questions.some((question) => question.id === item.question.id))
    : [];

  const goToGuidedGroup = useCallback((id: string, focusId?: string) => {
    const groups = buildQuestionNavigation(questions.current, data?.sections ?? [], eligibility.current);
    const group = groups.find((item) => item.id === id);
    if (!group) return;
    setGuidedSectionId(group.id);
    setGuidedError(false);
    setGuidedAnnouncement(`Section ${groups.findIndex((item) => item.id === id) + 1} of ${groups.length}: ${group.title}`);
    post({ type: "guided", enabled: true, section: group.id });
    const target = focusId ?? group.questions[0]?.id;
    if (target) post({ type: "focus-question", id: target });
  }, [data?.sections, post]);

  useEffect(() => {
    if (data?.presentation !== "guided") return;
    const first = buildQuestionNavigation(questions.current, data.sections ?? [], eligibility.current)[0];
    if (first && !guidedSectionId) setGuidedSectionId(first.id);
    setGuidedMode(true);
  }, [data, guidedSectionId]);

  useEffect(() => {
    if (!guidedMode || !data) return;
    const groups = buildQuestionNavigation(questions.current, data.sections ?? [], eligibility.current);
    if (!groups.length) return;
    if (!groups.some((group) => group.id === guidedSectionId)) {
      const next = groups[0];
      setGuidedSectionId(next.id);
      setGuidedError(false);
      setGuidedAnnouncement(`The available questions changed. Now showing ${next.title}.`);
      if (frameReady) post({ type: "guided", enabled: true, section: next.id });
    }
  }, [counts, data, frameReady, guidedMode, guidedSectionId, post]);

  useEffect(() => {
    if (!guidedMode || !activeGuidedGroup) return;
    post({ type: "guided", enabled: true, section: activeGuidedGroup.id });
  }, [activeGuidedGroup?.id, frameReady, guidedMode, post]);

  useEffect(() => {
    if (confirming || !focusQuestionAfterClose.current) return;
    const id = focusQuestionAfterClose.current;
    focusQuestionAfterClose.current = null;
    const targetQuestion = questions.current.find((question) => question.id === id);
    if (guidedMode && targetQuestion?.section) goToGuidedGroup(targetQuestion.section, id);
    else post({ type: "focus-question", id });
  }, [confirming, goToGuidedGroup, guidedMode, post]);

  const applyLock = useCallback((v: boolean) => { lockedRef.current = v; setLocked(v); post({ type: "lock", locked: v }); }, [post]);

  // ---- load
  const load = useCallback(async () => {
    setPhase("loading");
    const res = await api<Loaded & { ok: boolean }>(`/api/p/${token}`, { headers: { "X-KQA-Client": "respondent" } });
    if (res.status === 404) { setPhase("invalid"); return; }
    if (!res.ok || !res.data.questions) { setPhase("error"); return; }
    version.current = res.data.version;
    refreshRequiredRef.current = false;
    setRefreshRequired(false);
    answers.current = res.data.answers ?? {};
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
    if (!Object.keys(batch).length) return;
    pending.current = {};
    inflight.current = true;
    setSave("saving");
    const res = await api<{ savedAt: string; code?: string; details?: { id: string; reason: string }[] }>(`/api/p/${token}/answers`, { method: "PUT", body: { version: version.current, answers: batch } });
    inflight.current = false;
    if (res.ok) {
      attempts.current = 0;
      setLastSaved(new Date(res.data.savedAt));
      if (Object.keys(pending.current).length) { setSave("saving"); timer.current = setTimeout(flush, 350); } else setSave("saved");
      return;
    }
    if (res.status === 0 || res.status >= 500 || res.status === 429) {
      // Network or server trouble: keep the changes and try again, newest edits winning.
      pending.current = { ...batch, ...Object.fromEntries(Object.entries(pending.current).map(([k, v]) => [k, { ...batch[k], ...v }])) };
      setSave(navigator.onLine ? "error" : "offline");
      attempts.current += 1;
      retry.current = setTimeout(flush, Math.min(30000, 1500 * 2 ** Math.min(attempts.current, 5)));
      return;
    }
    if (res.status === 409 && res.data.code === "questionnaire_version_changed") {
      pending.current = {};
      clearTimeout(retry.current);
      refreshRequiredRef.current = true;
      setRefreshRequired(true);
      setSave("idle");
      applyLock(true);
      toast("This questionnaire was updated. Reload to continue; your earlier saved answers are safe, but recent changes on this page were not saved.", "err");
      return;
    }
    if (res.status === 403 || res.status === 409) {
      setSave("idle");
      applyLock(true);
      toast(res.data.error ?? "These answers are locked.", "err");
      return;
    }
    // 400/404: the server refused a value. Show why, then put the page back to what is actually saved.
    setSave("error");
    const why = res.data.details?.[0] ? `${res.data.details[0].reason}` : res.data.error;
    toast(`Could not save that answer: ${why ?? "it was not accepted"}.`, "err");
    const fresh = await api<Loaded>(`/api/p/${token}`);
    if (fresh.ok && fresh.data.answers) {
      answers.current = fresh.data.answers;
      if (fresh.data.progress?.eligible) eligibility.current = fresh.data.progress.eligible;
      post({ type: "answers", answers: fresh.data.answers });
      recount();
      setSave("saved");
    }
  }, [token, applyLock, post, recount, toast]);

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
        post({ type: "init", questions: questions.current, answers: answers.current, participant: { name: data?.participant.name }, locked: lockedRef.current, probe: false, preview: false, guided: data?.presentation === "guided", guidedSection: guidedSectionId });
        setFrameReady(true);
      } else if (m.type === "set" && typeof m.id === "string") {
        const part: { value?: unknown; note?: unknown } = {};
        if ("value" in m) part.value = m.value;
        if ("note" in m) part.note = m.note;
        queue(m.id, part);
      } else if (m.type === "eligibility" && m.eligible && typeof m.eligible === "object" && !Array.isArray(m.eligible)) {
        const next: Record<string, boolean> = {};
        for (const question of questions.current) next[question.id] = (m.eligible as Record<string, unknown>)[question.id] !== false;
        eligibility.current = next;
        recount();
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [data, guidedSectionId, post, queue, recount]);

  // ---- connectivity and leaving the page
  useEffect(() => {
    const online = () => { post({ type: "offline", offline: false }); if (Object.keys(pending.current).length) { setSave("saving"); void flush(); } };
    const offline = () => { post({ type: "offline", offline: true }); setSave("offline"); };
    const hide = () => {
      if (document.visibilityState === "hidden" && Object.keys(pending.current).length && !inflight.current) {
        const batch = pending.current; pending.current = {};
        void fetch(`/api/p/${token}/answers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: version.current, answers: batch }), keepalive: true }).catch(() => { pending.current = { ...batch, ...pending.current }; });
      }
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", hide);
    window.addEventListener("pagehide", hide);
    return () => { window.removeEventListener("online", online); window.removeEventListener("offline", offline); document.removeEventListener("visibilitychange", hide); window.removeEventListener("pagehide", hide); clearTimeout(timer.current); clearTimeout(retry.current); };
  }, [flush, post, token]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (Object.keys(pending.current).length || inflight.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  // ---- submit
  async function submit() {
    setSubmitting(true);
    clearTimeout(timer.current);
    for (let i = 0; i < 20 && inflight.current; i++) await new Promise((r) => setTimeout(r, 150));
    await flush();
    for (let i = 0; i < 20 && inflight.current; i++) await new Promise((r) => setTimeout(r, 150));
    if (refreshRequiredRef.current) { setSubmitting(false); setConfirming(false); return; }
    if (Object.keys(pending.current).length) { setSubmitting(false); toast("Your latest changes have not saved yet. Check your connection and try again.", "err"); return; }
    const res = await api<{ submittedAt: string; code?: string; missing?: { id: string; label: string }[]; invalidSelections?: { id: string; selected: number; maximum: number }[] }>(`/api/p/${token}/submit`, { method: "POST", body: { version: version.current } });
    setSubmitting(false);
    if (res.ok) {
      setConfirming(false);
      setSubmitProblems({});
      setSubmitError("");
      applyLock(true);
      setData((d) => (d ? { ...d, participant: { ...d.participant, status: "submitted", submittedAt: res.data.submittedAt } } : d));
      setSave("idle");
    } else {
      if (res.status === 409 && res.data.code === "questionnaire_version_changed") {
        setConfirming(false);
        pending.current = {};
        refreshRequiredRef.current = true;
        setRefreshRequired(true);
        setSave("idle");
        applyLock(true);
        toast("This questionnaire was updated. Reload to continue; your saved answers are safe.", "err");
        return;
      }
      if (res.status === 422) {
        const problems: Record<string, string> = {};
        for (const item of res.data.missing ?? []) problems[item.id] = "Answer this required question.";
        for (const item of res.data.invalidSelections ?? []) problems[item.id] = `Choose no more than ${item.maximum} ${item.maximum === 1 ? "option" : "options"}.`;
        setSubmitProblems(problems);
        setSubmitError(res.data.error ?? "Some answers need attention before you can submit. Review the marked questions.");
        recount();
        return;
      }
      setConfirming(false);
      toast(res.data.error ?? "Could not submit.", "err");
    }
  }

  function continueGuided() {
    if (!activeGuidedGroup) return;
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
  if (phase === "loading") return <div className="center-page"><div className="row muted"><Spinner /> Opening your questionnaire…</div></div>;
  if (phase === "invalid") {
    return (
      <main className="center-page"><div className="hero"><BrandMark size={44} wordmark /><h1>This link is not valid</h1><p className="muted">It may have been mistyped, or your host may have replaced it with a new one. Ask your host to send the link again.</p></div></main>
    );
  }
  if (phase === "error" || !data) {
    return (
      <main className="center-page"><div className="hero"><BrandMark size={44} wordmark /><h1>We could not open this just now</h1><p className="muted">Check your connection and try again. Nothing you have already saved is lost.</p><button className="btn primary" onClick={() => void load()}>Try again</button></div></main>
    );
  }

  const submitted = data.participant.status === "submitted";
  const pct = counts.total ? Math.round((counts.answered / counts.total) * 100) : 0;
  const hasUnsavedChanges = Object.keys(pending.current).length > 0;
  const SAVE_LABEL: Record<SaveState, string> = { idle: submitted ? "Locked" : "Autosave on", saving: "Saving…", saved: "Saved", error: "Retrying…", offline: hasUnsavedChanges ? "Offline — changes waiting to sync" : "Offline" };
  const reviewQuestions = questions.current.filter((question) => eligibility.current[question.id] !== false);
  const hiddenQuestionCount = questions.current.length - reviewQuestions.length;
  const currentQuestionGroups = buildQuestionNavigation(questions.current, data.sections ?? [], eligibility.current);
  const answeredInNavigation = reviewQuestions.filter((question) => hasValue(answers.current[question.id]?.value)).length;

  return (
    <div className="rs">
      <div className="rs-bar">
        <div className="rs-bar-in">
          <BrandMark />
          <div className="rs-title"><b>{data.title}</b><span>Answering as {data.participant.name}</span></div>
          <div className="right rs-bar-actions">
            <div
              className="rs-progress"
              role="progressbar"
              aria-label="Questionnaire progress"
              aria-valuemin={0}
              aria-valuemax={Math.max(counts.total, 1)}
              aria-valuenow={counts.answered}
              aria-valuetext={`${counts.answered} of ${counts.total} questions answered`}
            >
              <div className="bar"><i style={{ width: `${pct}%` }} /></div>
              <small>{counts.answered}/{counts.total} answered</small>
            </div>
            <div className="rs-question-nav-wrap">
              <button
                ref={questionNavTrigger}
                className="btn rs-question-nav-trigger"
                type="button"
                aria-expanded={questionNavOpen}
                aria-controls="respondent-question-navigation"
                aria-label={`Browse questions, ${answeredInNavigation} of ${reviewQuestions.length} answered`}
                disabled={!frameReady || locked}
                onClick={() => setQuestionNavOpen((open) => !open)}
              >
                Questions
              </button>
              {questionNavOpen && (
                <nav
                  id="respondent-question-navigation"
                  className="rs-question-nav"
                  aria-label="Question navigation"
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setQuestionNavOpen(false);
                      questionNavTrigger.current?.focus();
                    }
                  }}
                >
                  <p className="rs-question-nav-hint">
                    {hiddenQuestionCount
                      ? `Questions hidden by your answers are omitted. Any saved answers are retained and may reappear if they become eligible.`
                      : "Choose a question to go to it. Your answers will not change."}
                  </p>
                  <div className="rs-question-nav-groups">
                    {currentQuestionGroups.map((group) => {
                      const answered = group.questions.filter((question) => hasValue(answers.current[question.id]?.value)).length;
                      return (
                        <section className="rs-question-nav-group" key={group.id} aria-labelledby={`rs-nav-section-${group.id}`}>
                          <div className="rs-question-nav-section-head">
                            <h2 id={`rs-nav-section-${group.id}`}>{group.title}</h2>
                            <span>{answered} of {group.questions.length} answered</span>
                          </div>
                          {group.description && <p className="rs-question-nav-description">{group.description}</p>}
                          <ul>
                            {group.questions.map((question) => {
                              const isAnswered = hasValue(answers.current[question.id]?.value);
                              return (
                                <li key={question.id}>
                                  <button
                                    type="button"
                                    className="rs-question-nav-item"
                                    onClick={() => {
                                      setQuestionNavOpen(false);
                                      if (guidedMode) goToGuidedGroup(group.id, question.id);
                                      else post({ type: "focus-question", id: question.id });
                                    }}
                                  >
                                    <span>{question.label}</span>
                                    <small>{isAnswered ? "Answered" : question.required ? "Required" : "Not answered"}</small>
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
            <span className={`save-state ${save}`} role="status" aria-live="polite" title={save === "offline" && hasUnsavedChanges ? "These changes have not reached KQA. They will be retried when you reconnect; keep this page open until it shows Saved." : lastSaved ? `Last saved ${lastSaved.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}` : SAVE_LABEL[save]}><i /><span className="rs-save-label">{SAVE_LABEL[save]}</span></span>
            <button className={`btn accent ${submitted ? "done" : ""}`} disabled={locked} onClick={() => setConfirming(true)}>{submitted ? <><Icon name="check" size={16} /> Submitted</> : "Review answers"}</button>
          </div>
        </div>
      </div>

      <div className={`rs-banner ${refreshRequired || (!submitted && closed) ? "warn" : submitted ? "ok" : "none"}`} role={refreshRequired ? "alert" : submitted || closed ? "status" : undefined}>
        {refreshRequired && <><Icon name="lock" size={16} /> This questionnaire changed while the page was open. Changes made since the last save were not saved. Reload to continue with the latest version. <button className="btn" onClick={() => window.location.reload()}>Reload questionnaire</button></>}
        {submitted && <><Icon name="check" size={16} /> Submitted. Your answers are locked, and your host can reopen them if you need a change.</>}
        {!refreshRequired && !submitted && closed && <><Icon name="lock" size={16} /> This interview is closed, so answers can no longer be changed.</>}
      </div>

      {guidedMode && activeGuidedGroup && (
        <section className="rs-guided" aria-label="Questionnaire sections">
          <div className="rs-guided-step">
            <div>
              <p className="rs-guided-count" aria-current="step">Section {activeGuidedIndex + 1} of {questionGroups.length}</p>
              <h1>{activeGuidedGroup.title}</h1>
              {activeGuidedGroup.description && <p>{activeGuidedGroup.description}</p>}
            </div>
            <div className="rs-guided-actions">
              <button className="btn" type="button" disabled={activeGuidedIndex <= 0 || locked} onClick={() => goToGuidedGroup(questionGroups[activeGuidedIndex - 1].id)}>Back</button>
              <button className="btn accent" type="button" disabled={locked || !frameReady} onClick={continueGuided}>{activeGuidedIndex === questionGroups.length - 1 ? "Review answers" : "Continue"}</button>
              <button className="btn" type="button" disabled={locked} onClick={() => { setGuidedMode(false); setGuidedError(false); post({ type: "guided", enabled: false }); }}>Show all questions</button>
            </div>
          </div>
          <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">{guidedAnnouncement}</p>
          {guidedError && guidedStepIssues.length > 0 && (
            <div className="rs-guided-error" ref={guidedErrorRef} role="alert" tabIndex={-1} aria-labelledby="rs-guided-error-title">
              <h2 id="rs-guided-error-title">Check this section</h2>
              <p>Resolve these answers before continuing:</p>
              <ul>{guidedStepIssues.map(({ question, reason }) => <li key={question.id}><button type="button" onClick={() => post({ type: "focus-question", id: question.id })}>{question.label}: {reason}</button></li>)}</ul>
            </div>
          )}
        </section>
      )}

      <div className="rs-frame">
        {!frameReady && <div className="rs-loading"><span className="row"><Spinner /> Loading the questions…</span></div>}
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
          title="Check your answers"
          onClose={() => !submitting && setConfirming(false)}
          className="review-modal"
          actions={
            <>
              <button className="btn" disabled={submitting} onClick={() => setConfirming(false)}>Keep editing</button>
              {!counts.needsAttention.length && <button className="btn accent" disabled={submitting} onClick={submit}>{submitting && <Spinner />} Submit answers</button>}
            </>
          }
        >
          <div className="review-content">
            <p className="muted">Check the answers below. You can clear an answer here; any optional note stays saved. After submission, your answers are locked; your host can reopen them if you need a change.</p>
            {counts.needsAttention.length || submitError ? (
              <p className="review-problems" role="alert">{submitError || "Resolve the marked answers before submitting."} Choose Answer or Edit to return to that question.</p>
            ) : null}
            <div className="review-list">
              {reviewQuestions.map((question) => {
                const answer = answers.current[question.id];
                const attention = counts.needsAttention.find((item) => item.question.id === question.id);
                const problem = attention?.reason ?? submitProblems[question.id];
                const answered = hasValue(answer?.value);
                return (
                  <section className="review-entry" key={question.id}>
                    <div className="review-entry-copy">
                      <h3>{question.label}</h3>
                      <p className="review-value" style={{ whiteSpace: "pre-wrap" }}>{answered ? displayValue(question, answer?.value) : "Not answered"}</p>
                      {answer?.note && <p className="review-note"><strong>Note:</strong> {answer.note}</p>}
                      {problem && <p className="review-problem">{problem}</p>}
                    </div>
                    <div className="review-entry-actions">
                      <button className="btn" disabled={submitting} onClick={() => { focusQuestionAfterClose.current = question.id; setConfirming(false); }}>{answered ? "Edit" : "Answer"}</button>
                      {answered && <button className="btn" disabled={!frameReady || submitting || locked} aria-label={`Clear answer to ${question.label}`} onClick={() => post({ type: "clear-answer", id: question.id })}>Clear</button>}
                    </div>
                  </section>
                );
              })}
            </div>
            <p className="muted review-retention">Questions hidden by your current answers are not listed here. Any earlier answers to them are retained and may reappear if the question becomes eligible.</p>
          </div>
        </Modal>
      )}
    </div>
  );
}
