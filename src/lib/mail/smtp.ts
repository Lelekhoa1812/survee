import { randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { smtpSettings } from "../env";

export interface OutboundMail {
  to: string;
  subject: string;
  text: string;
  html: string;
  messageId: string;
}

export function newMessageId(fromAddress: string): string {
  const domain = fromAddress.split("@")[1]?.replace(/[^A-Za-z0-9.-]/g, "") || "kqa.local";
  return `<${randomBytes(16).toString("hex")}.${Date.now().toString(36)}@${domain}>`;
}

/** Category only. The raw server text is never returned, and the password is stripped before matching. */
export function publicSmtpFailure(err: unknown, secret?: string): string {
  let raw = err instanceof Error ? err.message : "";
  if (secret && secret.length > 0) raw = raw.split(secret).join("");
  if (/auth|535|534|username and password|invalid login|badcredentials/i.test(raw)) {
    return "The mail server rejected the login. Check the mailbox settings and try again.";
  }
  if (/timeout|timed out|ETIMEDOUT|ECONNREFUSED|ENOTFOUND|ECONNRESET|getaddrinfo|network/i.test(raw)) {
    return "Could not reach the mail server. Try again in a moment.";
  }
  if (/rate|quota|421|450|452|454|too many|daily user sending/i.test(raw)) {
    return "The mailbox is sending too fast. Wait a while and try again.";
  }
  if (/550|551|552|553|rejected|invalid recipient|user unknown|mailbox unavailable|policy/i.test(raw)) {
    return "The mail server rejected that address. Check the address and try again.";
  }
  return "The message could not be sent. Check the address and try again.";
}

export async function sendSmtp(message: OutboundMail): Promise<{ messageId: string }> {
  const cfg = smtpSettings();
  if (!cfg.ok) throw new Error(cfg.error);
  const transport = nodemailer.createTransport({
    host: cfg.host,
    port: 587,
    secure: false,
    requireTLS: true,
    auth: { user: cfg.user, pass: cfg.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 15_000,
  });
  try {
    const info = await transport.sendMail({
      from: { name: "survee", address: cfg.user },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
      messageId: message.messageId,
      replyTo: cfg.user,
      dsn: { id: message.messageId, return: "headers", notify: ["failure", "success", "delay"], recipient: message.to },
    });
    const messageId = typeof info.messageId === "string" && info.messageId.trim() ? info.messageId.trim() : message.messageId;
    return { messageId };
  } catch (err) {
    throw new Error(publicSmtpFailure(err, cfg.password));
  } finally {
    transport.close();
  }
}
