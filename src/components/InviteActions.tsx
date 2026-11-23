"use client";

import { useEffect, useState } from "react";
import { parseEmail } from "@/lib/mail/address";
import { relTime } from "@/lib/time";
import type { PersonRow } from "./interview-types";
import { api, Badge, Icon, Modal, Spinner, useToast } from "./ui";

const DELIVERY = {
  delivered: { label: "Delivered", kind: "ok" as const },
  bounced: { label: "Bounced", kind: "err" as const },
  unknown: { label: "Not confirmed yet", kind: "" as const },
};

export function acknowledgeInvite(personId: string, attemptId: string, purpose: "email_change" | "token_rotation", reason: string) {
  return api(`/api/admin/people/${personId}/invite-resolution`, { method: "POST", body: { attemptId, purpose, reason } });
}

export function PersonEmailEditor({ person, refresh }: { person: PersonRow; refresh: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(person.email ?? "");
  const [busy, setBusy] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const [resolutionRecorded, setResolutionRecorded] = useState(false);
  const [reason, setReason] = useState("");
  const parsed = parseEmail(email);
  const stored = person.email ?? "";
  const unchanged = parsed.ok && (parsed.email ?? "") === stored;
  const needsResolution = person.mail.state === "pending" && Boolean(person.mail.attemptId) && !unchanged && !resolutionRecorded && !person.mail.resolution;
  const describedBy = `email-${person.id}-note`;

  useEffect(() => { setEmail(person.email ?? ""); }, [person.email]);

  async function save() {
    if (!parsed.ok) return;
    setBusy(true);
    if (person.mail.state === "pending" && person.mail.attemptId && !resolutionRecorded && !person.mail.resolution && (parsed.email ?? "") !== stored) {
      const resolution = await acknowledgeInvite(person.id, person.mail.attemptId, "email_change", reason);
      if (!resolution.ok) { setBusy(false); toast(resolution.data.error ?? "The invitation outcome could not be acknowledged.", "err"); return; }
      setResolutionRecorded(true);
      refresh();
    }
    const res = await api(`/api/admin/people/${person.id}`, { method: "PATCH", body: { email } });
    setBusy(false);
    if (res.ok) { toast(parsed.email ? "Email saved." : "Email removed. Copy the link to share it."); refresh(); }
    else { toast(res.data.error ?? "Could not save.", "err"); if (resolutionRecorded) refresh(); }
  }

  return (
    <div className="field">
      <label htmlFor={`email-${person.id}`}>Email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
      <div className="row wrap">
        <input id={`email-${person.id}`} className={`input${!parsed.ok ? " error" : ""}`} type="text" inputMode="email" autoComplete="off" spellCheck={false} value={email} maxLength={254} aria-invalid={!parsed.ok} aria-describedby={describedBy} onChange={(e) => setEmail(e.target.value)} onBlur={() => { if (parsed.ok) setEmail(parsed.email ?? ""); }} style={{ flex: "1 1 220px", minWidth: 200 }} />
        <button className="btn" type="button" disabled={busy || !parsed.ok || unchanged || (needsResolution && (!acknowledged || !reason.trim()))} onClick={() => void save()}>{busy && <Spinner />} {needsResolution ? "Acknowledge uncertainty and save email" : "Save email"}</button>
      </div>
      {!parsed.ok ? <span id={describedBy} className="field-error">{parsed.error}</span> : <span id={describedBy} className="hint">Leave this blank to copy the link instead of emailing it. Changing the address clears the sent mark and does not send a new message.</span>}
      {needsResolution && <div className="stack" role="group" aria-label="Acknowledge unconfirmed invitation outcome">
        <strong>The old address may still receive this invite, and the earlier private link may have been exposed.</strong>
        <label className="check-row"><input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledged(event.target.checked)} /> I understand the invitation outcome is still unknown.</label>
        <label htmlFor={`resolution-reason-${person.id}`}>Reason for changing the email</label>
        <input id={`resolution-reason-${person.id}`} className="input" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
        <span className="hint">Keep this operational; avoid entering respondent details.</span>
      </div>}
    </div>
  );
}

export function InviteActions({ person, interviewOpen, publicOrigin, refresh }: { person: PersonRow; interviewOpen: boolean; publicOrigin: string | null; refresh: () => void }) {
  const toast = useToast();
  const [phase, setPhase] = useState<"idle" | "sending" | "checking">("idle");
  const [pendingAttempts, setPendingAttempts] = useState(person.mail?.pendingAttempts ?? []);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [attemptResolution, setAttemptResolution] = useState<{ attemptId: string; email: string; purpose: "email_change" | "token_rotation" } | null>(null);
  const [attemptResolutionReason, setAttemptResolutionReason] = useState("");
  const [attemptResolutionAck, setAttemptResolutionAck] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const email = person.email?.trim() ?? "";
  const mail = person.mail ?? { state: "unsent" as const, delivery: "unknown" as const };
  const delivery = DELIVERY[mail.delivery] ?? DELIVERY.unknown;

  useEffect(() => setPendingAttempts(person.mail?.pendingAttempts ?? []), [person.mail?.pendingAttempts]);

  async function send(resend: boolean) {
    setConfirm(false);
    setPhase("sending");
    const res = await api<{ result?: string; code?: string }>(`/api/admin/people/${person.id}/invite`, { method: "POST", body: { resend } });
    setPhase("idle");
    if (res.ok) {
      toast(res.data.result === "already_sent" ? `${person.name} already has this link.` : `Link sent to ${person.name}.`);
      refresh();
    } else {
      toast(res.data.error ?? "The message could not be sent. Check the address and try again.", "err");
      if (res.data.code === "outcome_unknown") refresh();
    }
  }

  async function check(attemptId?: string) {
    setPhase("checking");
    const res = await api<{ delivery?: string }>(`/api/admin/people/${person.id}/delivery`, { method: "POST", body: attemptId ? { attemptId } : {} });
    setPhase("idle");
    if (!res.ok) { toast(res.data.error ?? "We could not confirm delivery. Try again in a moment.", "err"); return; }
    const label = res.data.delivery === "delivered" ? "Delivered." : res.data.delivery === "bounced" ? "Bounced. Check the address and try again." : "Not confirmed yet.";
    toast(label, res.data.delivery === "bounced" ? "err" : "ok");
    refresh();
  }

  async function loadOlderAttempts() {
    const before = pendingAttempts.at(-1)?.attemptId;
    if (!before || loadingOlder) return;
    setLoadingOlder(true);
    const res = await api<{ attempts?: typeof pendingAttempts }>(`/api/admin/people/${person.id}/pending-invites?before=${encodeURIComponent(before)}`);
    setLoadingOlder(false);
    if (!res.ok) { toast(res.data.error ?? "Older unconfirmed attempts could not be loaded.", "err"); return; }
    const seen = new Set(pendingAttempts.map((attempt) => attempt.attemptId));
    setPendingAttempts((current) => [...current, ...(res.data.attempts ?? []).filter((attempt) => !seen.has(attempt.attemptId))]);
  }

  async function acknowledgeHistoricalAttempt() {
    if (!attemptResolution || !attemptResolutionReason.trim()) return;
    const result = await acknowledgeInvite(person.id, attemptResolution.attemptId, attemptResolution.purpose, attemptResolutionReason);
    if (!result.ok) { toast(result.data.error ?? "The invitation outcome could not be acknowledged.", "err"); return; }
    setAttemptResolution(null);
    refresh();
  }

  const refusal = !interviewOpen
    ? "Reopen the interview before sending a link. You can still copy it."
    : !publicOrigin
      ? "Sending is not set up yet. Copy the link instead."
      : !email
        ? "Add an email to send the link."
        : null;
  const showHistory = mail.state === "pending" || mail.state === "sent" || mail.state === "failed";
  const hasPendingHistory = (mail.pendingAttempts?.length ?? 0) > 0;
  if (refusal && !showHistory && !hasPendingHistory) return <p className="invite-meta">{refusal}</p>;

  return (
    <div className="invite-block">
      {refusal && <p className="invite-meta">{refusal}</p>}
      {phase === "sending" ? (
        <button className="btn sm primary" type="button" disabled aria-busy="true"><Spinner /> Sending…</button>
      ) : mail.state === "failed" ? (
        <>
          <p className="field-error">{mail.error || "The message could not be sent. Check the address and try again."}</p>
          {!refusal && <button className="btn sm" type="button" onClick={() => void send(true)}>Try again</button>}
        </>
      ) : mail.state === "sent" ? (
        <>
          <span className="invite-meta">Sent{mail.sentAt ? ` ${relTime(mail.sentAt)}` : ""}</span>
          <Badge kind={delivery.kind}>{delivery.label}</Badge>
          {mail.delivery === "bounced" && <span className="field-error">Check the address and try again.</span>}
          {!refusal && <button className="btn sm" type="button" onClick={() => setConfirm(true)}>Send again</button>}
          <button className="btn sm" type="button" disabled={phase === "checking"} onClick={() => void check()}>
            {phase === "checking" ? <><Spinner /> Checking…</> : "Check delivery"}
          </button>
        </>
      ) : mail.state === "pending" ? (
        <>
          <span className="invite-meta">Outcome unconfirmed{mail.sentAt ? ` ${relTime(mail.sentAt)}` : ""}</span>
          <p className="field-error">The mail server may have accepted this invite. Sending again may deliver a duplicate.</p>
          <button className="btn sm" type="button" disabled={phase === "checking"} onClick={() => void check()}>
            {phase === "checking" ? <><Spinner /> Checking…</> : "Check delivery"}
          </button>
          {!refusal && <button className="btn sm" type="button" onClick={() => setConfirm(true)}>Send again</button>}
        </>
      ) : (
        !refusal && <button className="btn sm primary" type="button" onClick={() => void send(false)}><Icon name="inbox" size={14} /> Send link</button>
      )}
      {pendingAttempts.length > 0 && <div className="stack" aria-label="Other unconfirmed invitations">
        <strong>Other unconfirmed invitation attempts</strong>
        {pendingAttempts.map((attempt) => <div className="row wrap" key={attempt.attemptId}>
          <span className="invite-meta">{attempt.email} · {relTime(attempt.sentAt)}</span>
          <Badge>Not confirmed yet</Badge>
          <button className="btn sm" type="button" disabled={phase === "checking"} onClick={() => void check(attempt.attemptId)}>{phase === "checking" ? <><Spinner /> Checking…</> : "Check this attempt"}</button>
          {attempt.resolution ? <span className="hint">Host acknowledged uncertainty for {attempt.resolution.purpose === "email_change" ? "email change" : "link replacement"}.</span> : <>
            <button className="btn sm" type="button" onClick={() => { setAttemptResolution({ attemptId: attempt.attemptId, email: attempt.email, purpose: "email_change" }); setAttemptResolutionReason(""); setAttemptResolutionAck(false); }}>Acknowledge for email change</button>
            <button className="btn sm" type="button" onClick={() => { setAttemptResolution({ attemptId: attempt.attemptId, email: attempt.email, purpose: "token_rotation" }); setAttemptResolutionReason(""); setAttemptResolutionAck(false); }}>Acknowledge for link replacement</button>
          </>}
        </div>)}
        {(mail.pendingAttemptCount ?? 0) > pendingAttempts.length + (mail.state === "pending" ? 1 : 0) && <button className="btn sm" type="button" disabled={loadingOlder} onClick={() => void loadOlderAttempts()}>{loadingOlder ? <><Spinner /> Loading…</> : "Load older unconfirmed attempts"}</button>}
      </div>}
      {confirm && (
        <Modal title={mail.state === "pending" ? "Send despite the unconfirmed result?" : "Send the link again?"} onClose={() => setConfirm(false)} actions={<><button className="btn" type="button" onClick={() => setConfirm(false)}>Cancel</button><button className="btn primary" type="button" onClick={() => void send(true)}>Send again</button></>}>
          <p className="muted">{mail.state === "pending" ? `The mail server may already have accepted this invite to ${email}. Sending again may deliver a duplicate.` : `${person.name} already received a link at ${email}. Send another?`}</p>
        </Modal>
      )}
      {attemptResolution && <Modal title="Acknowledge an unconfirmed invitation" onClose={() => setAttemptResolution(null)} actions={<><button className="btn" type="button" onClick={() => setAttemptResolution(null)}>Cancel</button><button className="btn primary" type="button" disabled={!attemptResolutionAck || !attemptResolutionReason.trim()} onClick={() => void acknowledgeHistoricalAttempt()}>Acknowledge unknown outcome</button></>}>
        <p className="field-error">The message to {attemptResolution.email} may still arrive, and the private link in it may have been exposed. This acknowledgement does not confirm delivery. It permits a later email change or link replacement; deletion stays blocked until delivery is confirmed.</p>
        <label className="check-row"><input type="checkbox" autoFocus checked={attemptResolutionAck} onChange={(event) => setAttemptResolutionAck(event.target.checked)} /> I understand the invitation outcome is still unknown.</label>
        <label className="field">Reason<textarea className="textarea" rows={3} maxLength={500} value={attemptResolutionReason} onChange={(event) => setAttemptResolutionReason(event.target.value)} /><span className="hint">Keep this operational; avoid entering respondent details.</span></label>
      </Modal>}
    </div>
  );
}
