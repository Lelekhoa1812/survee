import { ObjectId } from "mongodb";
import { smtpSettings } from "../env";
import { col } from "../db";
import { currentTenantId } from "../tenant-context";
import { consumeRateLimit, getInterview, getParticipant } from "../repo";
import { insertMail, listMailByPerson, mailRecord, updateMailAttempt } from "../repo/mail";
import { domainOf, parseEmail } from "./address";
import { inviteLink } from "./policy";
import { currentMail, type MailRecord } from "./state";
import { newMessageId, sendSmtp, type OutboundMail } from "./smtp";
import { inviteMessage } from "./template";

export type SendCode = "not_found" | "no_email" | "closed" | "no_public_url" | "mail_not_configured" | "rate_limited" | "rate_limit_unavailable" | "preflight_unavailable" | "outcome_unknown" | "attempt_unavailable";

export type SendInviteResult =
  | { ok: true; result: "sent" | "already_sent"; to: string; sentAt: string; messageId?: string; interviewId: string; personId: string }
  | { ok: false; code: Exclude<SendCode, "attempt_unavailable" | "outcome_unknown">; error: string }
  | { ok: false; code: "outcome_unknown"; error: string; interviewId: string; personId: string }
  | { ok: false; code: "attempt_unavailable"; error: string; interviewId: string; personId: string };

export interface InviteContext {
  person: { id: string; interviewId: string; name: string; email?: string; token: string; status: string };
  interview: { id: string; name: string; status: "open" | "closed" };
  rows: MailRecord[];
}

export interface SendInviteDeps {
  load?: (personId: string) => Promise<InviteContext | null>;
  send?: (message: OutboundMail) => Promise<{ messageId: string }>;
  begin?: (row: Parameters<typeof insertMail>[0]) => Promise<string>;
  finish?: (id: string, patch: { status: "sent"; messageId: string }) => Promise<boolean>;
  log?: (interviewId: string, participantId: string, result: "sent" | "failed", domain: string) => Promise<void>;
  linkFor?: (token: string) => { ok: true; link: string } | { ok: false; error: string };
  smtpReady?: () => { ok: true; from: string } | { ok: false; error: string };
  tenantId?: () => Promise<string | null>;
  rateLimit?: (key: string, maxAttempts: number, windowMinutes: number) => Promise<boolean>;
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

async function logInvite(interviewId: string, participantId: string, result: "sent" | "failed", domain: string) {
  const interviewOid = /^[0-9a-f]{24}$/i.test(interviewId) ? new ObjectId(interviewId) : null;
  const personOid = /^[0-9a-f]{24}$/i.test(participantId) ? new ObjectId(participantId) : null;
  if (!interviewOid) return;
  const tenantId = await currentTenantId();
  if (!tenantId) return;
  try {
    await (await col.events()).insertOne({ _id: new ObjectId(), tenantId, interviewId: interviewOid, participantId: personOid ?? undefined, type: "invite", at: new Date(), meta: { result, domain } });
  } catch {
    console.error("[audit] invite event persistence failed");
  }
}

/** One durable mail attempt is recorded before SMTP. Refusals never create an attempt. */
export async function sendInvite(input: { personId: string; triggeredBy: "admin" | "mcp"; resend?: boolean }, deps: SendInviteDeps = {}): Promise<SendInviteResult> {
  let ctx: InviteContext | null;
  try {
    ctx = await (deps.load ?? loadFromDb)(input.personId);
  } catch {
    return { ok: false, code: "preflight_unavailable", error: "Could not verify this person's interview and invitation status before sending. No message was sent." };
  }
  if (!ctx) return { ok: false, code: "not_found", error: "Person not found." };
  const parsed = parseEmail(ctx.person.email ?? "");
  if (!parsed.ok) return { ok: false, code: "no_email", error: parsed.error };
  if (!parsed.email) return { ok: false, code: "no_email", error: "Add an email address before sending." };
  if (ctx.interview.status !== "open") {
    return { ok: false, code: "closed", error: "This interview is closed, so the link would not open. Reopen it before sending." };
  }
  let link: ReturnType<NonNullable<SendInviteDeps["linkFor"]>>;
  try {
    link = (deps.linkFor ?? inviteLink)(ctx.person.token);
  } catch {
    return { ok: false, code: "preflight_unavailable", error: "Could not prepare this person's invitation link before sending. No message was sent." };
  }
  if (!link.ok) return { ok: false, code: "no_public_url", error: link.error };
  const current = currentMail({ email: parsed.email, token: ctx.person.token }, ctx.rows);
  if (current.state === "sent" && !input.resend) {
    return { ok: true, result: "already_sent", to: parsed.email, sentAt: current.sentAt ?? new Date().toISOString(), messageId: current.messageId, interviewId: ctx.interview.id, personId: ctx.person.id };
  }
  if (current.state === "pending" && !input.resend) {
    return { ok: false, code: "outcome_unknown", error: "The previous invite outcome is unconfirmed. Check mail status; sending again may deliver a duplicate.", interviewId: ctx.interview.id, personId: ctx.person.id };
  }
  let ready: ReturnType<NonNullable<SendInviteDeps["smtpReady"]>>;
  try {
    ready = deps.smtpReady ? deps.smtpReady() : (() => {
      const cfg = smtpSettings();
      return cfg.ok ? { ok: true as const, from: cfg.user } : { ok: false as const, error: cfg.error };
    })();
  } catch {
    return { ok: false, code: "preflight_unavailable", error: "Could not verify mail settings before sending. No message was sent." };
  }
  if (!ready.ok) return { ok: false, code: "mail_not_configured", error: ready.error };

  let tenantId: string | null;
  try {
    tenantId = await (deps.tenantId ?? currentTenantId)();
  } catch {
    return { ok: false, code: "preflight_unavailable", error: "Could not verify the invitation rate-limit scope before sending. No message was sent." };
  }
  if (!tenantId && !deps.rateLimit) return { ok: false, code: "rate_limit_unavailable", error: "Invite sending is temporarily unavailable. Try again." };
  const scope = tenantId ?? "test-scope";
  const consume = deps.rateLimit ?? consumeRateLimit;
  try {
    // The per-person minute bucket prevents concurrent clicks from sending duplicates.
    // Recipient and workspace buckets cap repeated sends across a broader set of links.
    const allowed = await consume(`invite-person:${scope}:${ctx.person.id}`, 1, 1)
      && await consume(`invite-recipient:${scope}:${parsed.email}`, 5, 60)
      && await consume(`invite-workspace:${scope}`, 100, 60);
    if (!allowed) return { ok: false, code: "rate_limited", error: "An invite was sent recently. Wait before sending another." };
  } catch {
    return { ok: false, code: "rate_limit_unavailable", error: "Invite sending is temporarily unavailable. Try again." };
  }

  const message = inviteMessage(ctx.person.name, ctx.interview.name, link.link);
  const messageId = newMessageId(ready.from);
  const send = deps.send ?? sendSmtp;
  const begin = deps.begin ?? (async (row: Parameters<typeof insertMail>[0]) => (await insertMail(row))._id.toHexString());
  const finish = deps.finish ?? (async (id: string, patch: { status: "sent"; messageId: string }) =>
    updateMailAttempt(new ObjectId(id), patch));
  const base = {
    interviewId: new ObjectId(ctx.interview.id),
    participantId: new ObjectId(ctx.person.id),
    kind: "invite" as const,
    to: parsed.email,
    token: ctx.person.token,
    triggeredBy: input.triggeredBy,
    sentAt: new Date(),
  };
  let attemptId: string;
  try {
    attemptId = await begin({ ...base, status: "pending", messageId });
  } catch {
    return { ok: false, code: "attempt_unavailable", error: "The invite attempt could not be recorded, so no email was sent. Try again later.", interviewId: ctx.interview.id, personId: ctx.person.id };
  }
  let sent: { messageId: string };
  try {
    sent = await send({ to: parsed.email, subject: message.subject, text: message.text, html: message.html, messageId });
  } catch {
    // SMTP errors can occur after remote acceptance. Keep the durable intent pending;
    // a normal retry must not imply that the previous message was definitely rejected.
    return { ok: false, code: "outcome_unknown", error: "The invite outcome is unconfirmed. Check mail status; sending again may deliver a duplicate.", interviewId: ctx.interview.id, personId: ctx.person.id };
  }
  try {
    const updated = await finish(attemptId, { status: "sent", messageId: sent.messageId });
    if (!updated) throw new Error("Mail attempt was not updated.");
  } catch {
    return { ok: false, code: "outcome_unknown", error: "The invite outcome is unconfirmed. Check mail status; sending again may deliver a duplicate.", interviewId: ctx.interview.id, personId: ctx.person.id };
  }
  try {
    await (deps.log ?? logInvite)(ctx.interview.id, ctx.person.id, "sent", domainOf(parsed.email));
  } catch {
    console.error("[audit] invite event persistence failed");
  }
  return { ok: true, result: "sent", to: parsed.email, sentAt: base.sentAt.toISOString(), messageId: sent.messageId, interviewId: ctx.interview.id, personId: ctx.person.id };
}
