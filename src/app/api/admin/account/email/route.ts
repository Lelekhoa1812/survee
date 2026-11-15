import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { publicBaseUrl, smtpSettings } from "@/lib/env";
import { fail, guardAdmin, json, readJson } from "@/lib/http";
import { newMessageId, sendSmtp } from "@/lib/mail/smtp";
import { parseEmail } from "@/lib/mail/address";
import { adminSession } from "@/lib/http";
import { loginBlocked, recordLoginFailure } from "@/lib/repo";
import { createPendingEmailChange, removePendingEmailChange } from "@/lib/repo/accounts";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const body = await readJson<{ currentPassword?: unknown; email?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const currentPassword = typeof body.data.currentPassword === "string" ? body.data.currentPassword : "";
  const rawEmail = typeof body.data.email === "string" ? body.data.email : "";
  const parsed = parseEmail(rawEmail);
  if (!parsed.ok || !parsed.email) return fail(400, "Enter a valid email address.");
  if (/\.(local|test|example|invalid)$/i.test(parsed.email.split("@")[1] ?? "")) {
    return fail(400, "Use an email address that can receive the verification message.");
  }
  const smtp = smtpSettings();
  const base = publicBaseUrl();
  if (!smtp.ok || !base.ok) return fail(503, "Email verification is temporarily unavailable.");

  const rateKey = `email-change:${createHash("sha256").update(session.userId).digest("hex")}`;
  try {
    if (await loginBlocked(rateKey, 3)) return fail(429, "Too many email changes. Wait a few minutes and try again.");
    await recordLoginFailure(rateKey);
  } catch {
    return fail(503, "Email verification is temporarily unavailable.");
  }

  const token = randomBytes(32).toString("base64url");
  let pending: Awaited<ReturnType<typeof createPendingEmailChange>>;
  try {
    pending = await createPendingEmailChange({ userId: session.userId, currentPassword, email: parsed.email, token });
  } catch {
    return fail(503, "Email verification is temporarily unavailable.");
  }
  if (!pending.ok) return fail(400, pending.error);

  const url = new URL("/verify-email", base.origin);
  url.hash = new URLSearchParams({ token }).toString();
  try {
    await sendSmtp({
      to: parsed.email,
      subject: "Verify your KQA account email",
      messageId: newMessageId(smtp.user),
      text: `Verify this email address for your KQA account: ${url.toString()}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this message.`,
      html: `<p>Verify this email address for your KQA account.</p><p><a href="${escapeHtml(url.toString())}">Verify email address</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this message.</p>`,
    });
    return json({ ok: true, message: "We sent a verification link to the new address. Your current sign-in stays active until it is verified." });
  } catch {
    await removePendingEmailChange(pending.id).catch(() => {});
    return fail(503, "We could not send the verification email. Try again later.");
  }
}
