import { ObjectId } from "mongodb";
import { smtpSettings } from "../env";
import { col, withMongoTransaction } from "../db";
import { currentTenantId, tenantFilter } from "../tenant-context";
import { consumeRateLimit, getInterview, getParticipant } from "../repo";
import { getInviteSendOperation, insertMail, insertMailWithOperation, listMailByPerson, mailRecord, updateMailAttempt, type InviteSendOperation, type InviteSendOperationResult } from "../repo/mail";
import { domainOf, parseEmail } from "./address";
import { inviteLink } from "./policy";
import { currentMail, type MailRecord } from "./state";
import { newMessageId, sendSmtp, type OutboundMail } from "./smtp";
import { inviteMessage } from "./template";

export type SendCode = "not_found" | "no_email" | "closed" | "no_public_url" | "mail_not_configured" | "rate_limited" | "rate_limit_unavailable" | "preflight_unavailable" | "outcome_unknown" | "attempt_unavailable" | "operation_id_conflict" | "operation_result_unavailable";

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
  begin?: (row: Parameters<typeof insertMail>[0], operation?: InviteSendOperation) => Promise<string | null | InviteSendOperationResult>;
  findOperation?: (operation: InviteSendOperation) => Promise<Exclude<InviteSendOperationResult, { kind: "created" }> | null>;
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
    if (!personOid) return;
    // Serialize the audit event with deletion too, so a late SMTP completion
    // cannot recreate participant-linked history after the erase transaction.
    await withMongoTransaction(async (session) => {
      const current = await (await col.participants()).updateOne(
        tenantFilter(tenantId, { _id: personOid, interviewId: interviewOid }),
        { $inc: { inviteAttemptRevision: 1 } },
        { session },
      );
      if (current.matchedCount !== 1) return false;
      await (await col.events()).insertOne({ _id: new ObjectId(), tenantId, interviewId: interviewOid, participantId: personOid, type: "invite", at: new Date(), meta: { result, domain } }, { session });
      return true;
    });
  } catch {
    console.error("[audit] invite event persistence failed");
  }
}

/** One durable mail attempt is recorded before SMTP. Refusals never create an attempt. */
function replayOperationAttempt(attempt: MailRecord, interviewId: string): SendInviteResult {
  if (attempt.status === "sent") {
    return { ok: true, result: "sent", to: attempt.to, sentAt: attempt.sentAt, ...(attempt.messageId ? { messageId: attempt.messageId } : {}), interviewId, personId: attempt.participantId ?? "" };
  }
  return { ok: false, code: "outcome_unknown", error: "The invite outcome is unconfirmed. Check mail status; this operation will not send another message.", interviewId, personId: attempt.participantId ?? "" };
}

export async function sendInvite(input: { personId: string; triggeredBy: "admin" | "mcp"; resend?: boolean; operation?: InviteSendOperation }, deps: SendInviteDeps = {}): Promise<SendInviteResult> {
  const replay = async (): Promise<SendInviteResult | null> => {
    if (!input.operation) return null;
    try {
      const existing = await (deps.findOperation ?? getInviteSendOperation)(input.operation);
      if (existing?.kind === "deleted") return { ok: false, code: "operation_result_unavailable", error: "This operation's invite attempt was erased. Use a new operationId to send another invite." };
      if (existing?.kind === "conflict") return { ok: false, code: "operation_id_conflict", error: "operationId was already used with different send_invite arguments." };
      if (existing?.kind === "replayed") return replayOperationAttempt(existing.attempt, existing.interviewId);
    } catch {
      return { ok: false, code: "preflight_unavailable", error: "Could not verify this invite operation before sending. No message was sent." };
    }
    return null;
  };
  const existingOperation = await replay();
  if (existingOperation) return existingOperation;
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
    if (!allowed) return (await replay()) ?? { ok: false, code: "rate_limited", error: "An invite was sent recently. Wait before sending another." };
  } catch {
    return { ok: false, code: "rate_limit_unavailable", error: "Invite sending is temporarily unavailable. Try again." };
  }

  const message = inviteMessage(ctx.person.name, ctx.interview.name, link.link);
  const messageId = newMessageId(ready.from);
  const send = deps.send ?? sendSmtp;
  const begin = deps.begin ?? (async (row: Parameters<typeof insertMail>[0], operation?: InviteSendOperation) => operation
    ? insertMailWithOperation(row, operation)
    : (await insertMail(row))?._id.toHexString() ?? null);
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
  let attemptId: string | null;
  try {
    const started = await begin({ ...base, status: "pending", messageId }, input.operation);
    if (started && typeof started === "object") {
      if (started.kind === "conflict") return { ok: false, code: "operation_id_conflict", error: "operationId was already used with different send_invite arguments." };
      if (started.kind === "deleted") return { ok: false, code: "operation_result_unavailable", error: "This operation's invite attempt was erased. Use a new operationId to send another invite." };
      if (started.kind === "replayed") {
        return replayOperationAttempt(started.attempt, started.interviewId || ctx.interview.id);
      }
      attemptId = started.kind === "created" ? started.attemptId : null;
    } else {
      attemptId = started;
    }
  } catch {
    return { ok: false, code: "attempt_unavailable", error: "The invite attempt could not be recorded, so no email was sent. Try again later.", interviewId: ctx.interview.id, personId: ctx.person.id };
  }
  if (!attemptId) return { ok: false, code: "attempt_unavailable", error: "This person's details changed before the invite could be recorded, so no email was sent. Reload the details and try again.", interviewId: ctx.interview.id, personId: ctx.person.id };
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
