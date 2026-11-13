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

export function PersonEmailEditor({ person, refresh }: { person: PersonRow; refresh: () => void }) {
  const toast = useToast();
  const [email, setEmail] = useState(person.email ?? "");
  const [busy, setBusy] = useState(false);
  const parsed = parseEmail(email);
  const stored = person.email ?? "";
  const unchanged = parsed.ok && (parsed.email ?? "") === stored;
  const describedBy = `email-${person.id}-note`;

  useEffect(() => { setEmail(person.email ?? ""); }, [person.email]);

  async function save() {
    if (!parsed.ok) return;
    setBusy(true);
    const res = await api(`/api/admin/people/${person.id}`, { method: "PATCH", body: { email } });
    setBusy(false);
    if (res.ok) { toast(parsed.email ? "Email saved." : "Email removed. Copy the link to share it."); refresh(); }
    else toast(res.data.error ?? "Could not save.", "err");
  }

  return (
    <div className="field">
      <label htmlFor={`email-${person.id}`}>Email <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></label>
      <div className="row wrap">
        <input id={`email-${person.id}`} className={`input${!parsed.ok ? " error" : ""}`} type="text" inputMode="email" autoComplete="off" spellCheck={false} value={email} maxLength={254} aria-invalid={!parsed.ok} aria-describedby={describedBy} onChange={(e) => setEmail(e.target.value)} onBlur={() => { if (parsed.ok) setEmail(parsed.email ?? ""); }} style={{ flex: "1 1 220px", minWidth: 200 }} />
        <button className="btn" type="button" disabled={busy || !parsed.ok || unchanged} onClick={() => void save()}>{busy && <Spinner />} Save email</button>
      </div>
      {!parsed.ok ? <span id={describedBy} className="field-error">{parsed.error}</span> : <span id={describedBy} className="hint">Leave this blank to copy the link instead of emailing it. Changing the address clears the sent mark and does not send a new message.</span>}
    </div>
  );
}

export function InviteActions({ person, interviewOpen, publicOrigin, refresh }: { person: PersonRow; interviewOpen: boolean; publicOrigin: string | null; refresh: () => void }) {
  const toast = useToast();
  const [phase, setPhase] = useState<"idle" | "sending" | "checking">("idle");
  const [confirm, setConfirm] = useState(false);
  const email = person.email?.trim() ?? "";
  const mail = person.mail ?? { state: "unsent" as const, delivery: "unknown" as const };
  const delivery = DELIVERY[mail.delivery] ?? DELIVERY.unknown;

  async function send(resend: boolean) {
    setConfirm(false);
    setPhase("sending");
    const res = await api<{ result?: string }>(`/api/admin/people/${person.id}/invite`, { method: "POST", body: { resend } });
    setPhase("idle");
    if (res.ok) {
      toast(res.data.result === "already_sent" ? `${person.name} already has this link.` : `Link sent to ${person.name}.`);
      refresh();
    } else toast(res.data.error ?? "The message could not be sent. Check the address and try again.", "err");
  }

  async function check() {
    setPhase("checking");
    const res = await api<{ delivery?: string }>(`/api/admin/people/${person.id}/delivery`, { method: "POST", body: {} });
    setPhase("idle");
    if (!res.ok) { toast(res.data.error ?? "We could not confirm delivery. Try again in a moment.", "err"); return; }
    const label = res.data.delivery === "delivered" ? "Delivered." : res.data.delivery === "bounced" ? "Bounced. Check the address and try again." : "Not confirmed yet.";
    toast(label, res.data.delivery === "bounced" ? "err" : "ok");
    refresh();
  }

  const refusal = !interviewOpen
    ? "Reopen the interview before sending a link. You can still copy it."
    : !publicOrigin
      ? "Sending is not set up yet. Copy the link instead."
      : !email
        ? "Add an email to send the link."
        : null;
  const showHistory = mail.state === "sent" || mail.state === "failed";
  if (refusal && !showHistory) return <p className="invite-meta">{refusal}</p>;

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
      ) : (
        <button className="btn sm primary" type="button" onClick={() => void send(false)}><Icon name="inbox" size={14} /> Send link</button>
      )}
      {confirm && (
        <Modal title="Send the link again?" onClose={() => setConfirm(false)} actions={<><button className="btn" type="button" onClick={() => setConfirm(false)}>Cancel</button><button className="btn primary" type="button" onClick={() => void send(true)}>Send again</button></>}>
          <p className="muted">{person.name} already received a link at {email}. Send another?</p>
        </Modal>
      )}
    </div>
  );
}
