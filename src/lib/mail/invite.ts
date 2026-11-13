import { ObjectId } from "mongodb";
import { smtpSettings } from "../env";
import { col } from "../db";
import { getInterview, getParticipant } from "../repo";
import { insertMail, listMailByPerson, mailRecord } from "../repo/mail";
import { domainOf, parseEmail } from "./address";
import { inviteLink } from "./policy";
import { currentMail, type MailRecord } from "./state";
import { newMessageId, publicSmtpFailure, sendSmtp, type OutboundMail } from "./smtp";
import { inviteMessage } from "./template";

export type SendCode = "not_found" | "no_email" | "closed" | "no_public_url" | "mail_not_configured" | "send_failed";

export type SendInviteResult =
  | { ok: true; result: "sent" | "already_sent"; to: string; sentAt: string; messageId?: string; interviewId: string; personId: string }
  | { ok: false; code: Exclude<SendCode, "send_failed">; error: string }
  | { ok: false; code: "send_failed"; error: string; interviewId: string; personId: string };

export interface InviteContext {
  person: { id: string; interviewId: string; name: string; email?: string; token: string; status: string };
  interview: { id: string; name: string; status: "open" | "closed" };
  rows: MailRecord[];
}

export interface SendInviteDeps {
  load?: (personId: string) => Promise<InviteContext | null>;
  send?: (message: OutboundMail) => Promise<{ messageId: string }>;
  record?: (row: Parameters<typeof insertMail>[0]) => Promise<void>;
  linkFor?: (token: string) => { ok: true; link: string } | { ok: false; error: string };
  smtpReady?: () => { ok: true; from: string } | { ok: false; error: string };
}

async function loadFromDb(personId: string): Promise<InviteContext | null> {
  const person = await getParticipant(personId);
  if (!person) return null;
  const interview = await getInterview(person.interviewId);
  if (!interview) return null;
  const oid = /^[0-9a-f]{24}$/i.test(personId) ? new ObjectId(personId) : null;
  const rows = oid ? (await listMailByPerson(oid)).map(mailRecord) : [];
  return {
    person: { id: person.id, interviewId: person.interviewId, name: person.name, email: person.email, token: person.token, status: person.status },
    interview: { id: interview._id.toHexString(), name: interview.name, status: interview.status },
    rows,
  };
}

function storedSendError(err: unknown): string {
  const raw = err instanceof Error ? err.message : "";
  if (!raw || /pass(word)?\s*[:=]|smtp_password|secret/i.test(raw)) return "The message could not be sent. Check the address and try again.";
  if (/^(The |Could |Email |Set |Delivery |We )/.test(raw)) return raw.slice(0, 240);
  return publicSmtpFailure(err).slice(0, 240);
}

function logInvite(interviewId: string, participantId: string, result: "sent" | "failed", domain: string) {
  const interviewOid = /^[0-9a-f]{24}$/i.test(interviewId) ? new ObjectId(interviewId) : null;
  const personOid = /^[0-9a-f]{24}$/i.test(participantId) ? new ObjectId(participantId) : null;
  if (!interviewOid) return;
  void col.events().then((c) => c.insertOne({ _id: new ObjectId(), interviewId: interviewOid, participantId: personOid ?? undefined, type: "invite", at: new Date(), meta: { result, domain } })).catch(() => {});
}

/** One person, one SMTP conversation. Refusals (no email, closed, unset public URL) do not write a mail row. */
export async function sendInvite(input: { personId: string; triggeredBy: "admin" | "mcp"; resend?: boolean }, deps: SendInviteDeps = {}): Promise<SendInviteResult> {
  const ctx = await (deps.load ?? loadFromDb)(input.personId);
  if (!ctx) return { ok: false, code: "not_found", error: "Person not found." };
  const parsed = parseEmail(ctx.person.email ?? "");
  if (!parsed.ok) return { ok: false, code: "no_email", error: parsed.error };
  if (!parsed.email) return { ok: false, code: "no_email", error: "Add an email address before sending." };
  if (ctx.interview.status !== "open") {
    return { ok: false, code: "closed", error: "This interview is closed, so the link would not open. Reopen it before sending." };
  }
  const link = (deps.linkFor ?? inviteLink)(ctx.person.token);
  if (!link.ok) return { ok: false, code: "no_public_url", error: link.error };
  const current = currentMail({ email: parsed.email, token: ctx.person.token }, ctx.rows);
  if (current.state === "sent" && !input.resend) {
    return { ok: true, result: "already_sent", to: parsed.email, sentAt: current.sentAt ?? new Date().toISOString(), messageId: current.messageId, interviewId: ctx.interview.id, personId: ctx.person.id };
  }
  const ready = deps.smtpReady ? deps.smtpReady() : (() => {
    const cfg = smtpSettings();
    return cfg.ok ? { ok: true as const, from: cfg.user } : { ok: false as const, error: cfg.error };
  })();
  if (!ready.ok) return { ok: false, code: "mail_not_configured", error: ready.error };

  const message = inviteMessage(ctx.person.name, ctx.interview.name, link.link);
  const messageId = newMessageId(ready.from);
  const send = deps.send ?? sendSmtp;
  const record = deps.record ?? (async (row: Parameters<typeof insertMail>[0]) => { await insertMail(row); });
  const base = {
    interviewId: new ObjectId(ctx.interview.id),
    participantId: new ObjectId(ctx.person.id),
    kind: "invite" as const,
    to: parsed.email,
    token: ctx.person.token,
    triggeredBy: input.triggeredBy,
    sentAt: new Date(),
  };
  let sent: { messageId: string };
  try {
    sent = await send({ to: parsed.email, subject: message.subject, text: message.text, html: message.html, messageId });
  } catch (err) {
    const error = storedSendError(err);
    try {
      await record({ ...base, status: "failed", error });
      if (!deps.record) logInvite(ctx.interview.id, ctx.person.id, "failed", domainOf(parsed.email));
    } catch { /* the send already failed; do not hide that behind a second write error */ }
    return { ok: false, code: "send_failed", error, interviewId: ctx.interview.id, personId: ctx.person.id };
  }
  try {
    await record({ ...base, status: "sent", messageId: sent.messageId });
  } catch {
    // The message left. A failed row here would tell the host it did not, and the next click would send it again.
    return { ok: false, code: "send_failed", error: "The message was sent, but it could not be recorded. Do not send it again unless you mean to.", interviewId: ctx.interview.id, personId: ctx.person.id };
  }
  if (!deps.record) logInvite(ctx.interview.id, ctx.person.id, "sent", domainOf(parsed.email));
  return { ok: true, result: "sent", to: parsed.email, sentAt: base.sentAt.toISOString(), messageId: sent.messageId, interviewId: ctx.interview.id, personId: ctx.person.id };
}
