"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { AnswerMap, Question } from "@/lib/format/schema";
import { api, BrandMark, Icon, Modal, Spinner, useToast } from "./ui";

type Phase = "loading" | "ready" | "invalid" | "error";
type SaveState = "idle" | "saving" | "saved" | "error" | "offline";
interface Loaded {
  participant: { name: string; status: "invited" | "in_progress" | "submitted"; submittedAt?: string };
  interview: { name: string; status: "open" | "closed" };
  title: string;
  questions: Question[];
  answers: AnswerMap;
}
type Patch = Record<string, { value?: unknown; note?: unknown }>;

const hasValue = (v: unknown) => v !== undefined && v !== null && (Array.isArray(v) ? v.length > 0 : typeof v === "string" ? v.trim() !== "" : true);

export function RespondentShell({ token }: { token: string }) {
  const toast = useToast();
  const [phase, setPhase] = useState<Phase>("loading");
  const [data, setData] = useState<Loaded | null>(null);
  const [save, setSave] = useState<SaveState>("idle");
  const [locked, setLocked] = useState(false);
  const [closed, setClosed] = useState(false);
  const [counts, setCounts] = useState({ answered: 0, total: 0, missing: [] as Question[] });
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [frameReady, setFrameReady] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const frame = useRef<HTMLIFrameElement>(null);
  const answers = useRef<AnswerMap>({});
  const questions = useRef<Question[]>([]);
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const retry = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const inflight = useRef(false);
  const lockedRef = useRef(false);
  const attempts = useRef(0);

  const recount = useCallback(() => {
    const qs = questions.current;
    const missing = qs.filter((q) => q.required && !hasValue(answers.current[q.id]?.value));
    setCounts({ answered: qs.filter((q) => hasValue(answers.current[q.id]?.value)).length, total: qs.length, missing });
  }, []);

  const post = useCallback((msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage({ kqa: 1, ...msg }, "*"), []);

  const applyLock = useCallback((v: boolean) => { lockedRef.current = v; setLocked(v); post({ type: "lock", locked: v }); }, [post]);

  // ---- load
  const load = useCallback(async () => {
    setPhase("loading");
    const res = await api<Loaded & { ok: boolean }>(`/api/p/${token}`, { headers: { "X-KQA-Client": "respondent" } });
    if (res.status === 404) { setPhase("invalid"); return; }
    if (!res.ok || !res.data.questions) { setPhase("error"); return; }
    answers.current = res.data.answers ?? {};
    questions.current = res.data.questions;
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
    const res = await api<{ savedAt: string; details?: { id: string; reason: string }[] }>(`/api/p/${token}/answers`, { method: "PUT", body: { answers: batch } });
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
      post({ type: "answers", answers: fresh.data.answers });
      recount();
      setSave("saved");
    }
  }, [token, applyLock, post, recount, toast]);

  const queue = useCallback((id: string, part: { value?: unknown; note?: unknown }) => {
    if (lockedRef.current) return;
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
        post({ type: "init", questions: questions.current, answers: answers.current, participant: { name: data?.participant.name }, locked: lockedRef.current, probe: false, preview: false });
        setFrameReady(true);
      } else if (m.type === "set" && typeof m.id === "string") {
        const part: { value?: unknown; note?: unknown } = {};
        if ("value" in m) part.value = m.value;
        if ("note" in m) part.note = m.note;
        queue(m.id, part);
      }
    }
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [data, post, queue]);

  // ---- connectivity and leaving the page
  useEffect(() => {
    const online = () => { post({ type: "offline", offline: false }); if (Object.keys(pending.current).length) { setSave("saving"); void flush(); } };
    const offline = () => { post({ type: "offline", offline: true }); setSave("offline"); };
    const hide = () => {
      if (document.visibilityState === "hidden" && Object.keys(pending.current).length && !inflight.current) {
        const batch = pending.current; pending.current = {};
        void fetch(`/api/p/${token}/answers`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers: batch }), keepalive: true }).catch(() => { pending.current = { ...batch, ...pending.current }; });
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
    if (Object.keys(pending.current).length) { setSubmitting(false); toast("Your latest changes have not saved yet. Check your connection and try again.", "err"); return; }
    const res = await api<{ submittedAt: string; missing?: { id: string; label: string }[] }>(`/api/p/${token}/submit`, { method: "POST", body: {} });
    setSubmitting(false);
    if (res.ok) {
      setConfirming(false);
      applyLock(true);
      setData((d) => (d ? { ...d, participant: { ...d.participant, status: "submitted", submittedAt: res.data.submittedAt } } : d));
      setSave("idle");
    } else {
      setConfirming(false);
      toast(res.data.error ?? "Could not submit.", "err");
      if (res.status === 422) recount();
    }
  }

  // ---- states other than the questionnaire
  if (phase === "loading") return <div className="center-page"><div className="row muted"><Spinner /> Opening your questionnaire…</div></div>;
  if (phase === "invalid") {
    return (
      <main className="center-page"><div className="hero"><BrandMark size={44} /><h1>This link is not valid</h1><p className="muted">It may have been mistyped, or your host may have replaced it with a new one. Ask your host to send the link again.</p></div></main>
    );
  }
  if (phase === "error" || !data) {
    return (
      <main className="center-page"><div className="hero"><BrandMark size={44} /><h1>We could not open this just now</h1><p className="muted">Check your connection and try again. Nothing you have already saved is lost.</p><button className="btn primary" onClick={() => void load()}>Try again</button></div></main>
    );
  }

  const submitted = data.participant.status === "submitted";
  const pct = counts.total ? Math.round((counts.answered / counts.total) * 100) : 0;
  const SAVE_LABEL: Record<SaveState, string> = { idle: submitted ? "Locked" : "Autosave on", saving: "Saving…", saved: "Saved", error: "Retrying…", offline: "Offline, will save" };

  return (
    <div className="rs">
      <div className="rs-bar">
        <div className="rs-bar-in">
          <BrandMark />
          <div className="rs-title"><b>{data.title}</b><span>Answering as {data.participant.name}</span></div>
          <div className="right row" style={{ gap: 18 }}>
            <div className="rs-progress" aria-label={`${counts.answered} of ${counts.total} answered`}>
              <div className="bar"><i style={{ width: `${pct}%` }} /></div>
              <small>{counts.answered} of {counts.total} answered</small>
            </div>
            <span className={`save-state ${save}`} role="status" aria-live="polite" title={lastSaved ? `Last saved ${lastSaved.toLocaleTimeString("en-AU", { hour: "numeric", minute: "2-digit" })}` : undefined}><i />{SAVE_LABEL[save]}</span>
            <button className={`btn accent ${submitted ? "done" : ""}`} disabled={locked || counts.answered === 0} onClick={() => setConfirming(true)}>{submitted ? <><Icon name="check" size={16} /> Submitted</> : "Submit"}</button>
          </div>
        </div>
      </div>

      <div className={`rs-banner ${submitted ? "ok" : closed ? "warn" : "none"}`} role={submitted || closed ? "status" : undefined}>
        {submitted && <><Icon name="check" size={16} /> Submitted. Your answers are locked, and your host can reopen them if you need a change.</>}
        {!submitted && closed && <><Icon name="lock" size={16} /> This interview is closed, so answers can no longer be changed.</>}
      </div>

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
          title={counts.missing.length ? "A few required answers are missing" : "Submit your answers?"}
          onClose={() => !submitting && setConfirming(false)}
          actions={
            counts.missing.length ? (
              <button className="btn primary" onClick={() => setConfirming(false)}>Go back and answer</button>
            ) : (
              <>
                <button className="btn" disabled={submitting} onClick={() => setConfirming(false)}>Keep editing</button>
                <button className="btn accent" disabled={submitting} onClick={submit}>{submitting && <Spinner />} Submit answers</button>
              </>
            )
          }
        >
          {counts.missing.length ? (
            <>
              <p className="muted">These questions are marked required. Answer them, then submit.</p>
              <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>{counts.missing.map((q) => <li key={q.id}>{q.label}</li>)}</ul>
            </>
          ) : (
            <p className="muted">You have answered {counts.answered} of {counts.total} questions. After you submit, your answers are locked. Your host can reopen them if you need to make a change.</p>
          )}
        </Modal>
      )}
    </div>
  );
}
