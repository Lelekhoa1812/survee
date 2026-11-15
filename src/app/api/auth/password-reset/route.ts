import { createHash, randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { publicBaseUrl, smtpSettings } from "@/lib/env";
import { fail, json, readJson, sameOrigin, str } from "@/lib/http";
import { parseEmail } from "@/lib/mail/address";
import { newMessageId, sendSmtp } from "@/lib/mail/smtp";
import { createPendingPasswordReset, removePendingPasswordReset } from "@/lib/repo/accounts";
import { consumeRateLimit } from "@/lib/repo";

const GENERIC = "If a verified KQA account uses this address, check its inbox for a password reset link.";

function clientIp(h: Headers): string {
  const platform = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip");
  if (platform) return platform.split(",")[0].trim();
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return chain.at(-1) ?? "unknown";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the KQA app.");
  const body = await readJson<{ email?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const parsed = parseEmail(str(body.data.email, 254) ?? "");
  if (!parsed.ok || !parsed.email) return fail(400, "Enter a valid email address.");

  const smtp = smtpSettings();
  const base = publicBaseUrl();
  if (!smtp.ok || !base.ok) return fail(503, "Password reset is temporarily unavailable. Try again later.");

  const h = await headers();
  const ipKey = `password-reset-ip:${clientIp(h)}`;
  const emailKey = `password-reset-email:${createHash("sha256").update(parsed.email).digest("hex")}`;
  try {
    const [ipAllowed, emailAllowed] = await Promise.all([consumeRateLimit(ipKey, 5), consumeRateLimit(emailKey, 3)]);
    if (!ipAllowed || !emailAllowed) return fail(429, "Too many attempts. Wait a few minutes and try again.");
  } catch {
    return fail(503, "Password reset is temporarily unavailable. Try again later.");
  }

  const generic = () => json({ ok: true, message: GENERIC });
  const token = randomBytes(32).toString("base64url");
  let pendingId;
  try {
    pendingId = await createPendingPasswordReset({ email: parsed.email, token });
  } catch {
    return fail(503, "Password reset is temporarily unavailable. Try again later.");
  }
  if (!pendingId) return generic();

  const resetUrl = new URL("/reset-password", base.origin);
  resetUrl.hash = new URLSearchParams({ token }).toString();
  try {
    await sendSmtp({
      to: parsed.email,
      subject: "Reset your KQA password",
      messageId: newMessageId(smtp.user),
      text: `Choose a new password using this link: ${resetUrl.toString()}\n\nThe link expires in 30 minutes and works once. If you did not request this, you can ignore this message.`,
      html: `<p>Choose a new KQA password using the link below. It expires in 30 minutes and works once.</p><p><a href="${escapeHtml(resetUrl.toString())}">Reset your password</a></p><p>If you did not request this, you can ignore this message.</p>`,
    });
  } catch {
    await removePendingPasswordReset(pendingId).catch(() => {});
  }
  return generic();
}
