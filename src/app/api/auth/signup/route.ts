import { createHash, randomBytes } from "node:crypto";
import { parseEmail } from "@/lib/mail/address";
import { newMessageId, sendSmtp } from "@/lib/mail/smtp";
import { smtpSettings, publicBaseUrl } from "@/lib/env";
import { fail, json, readJson, sameOrigin, str } from "@/lib/http";
import { createPendingSignup, removePendingSignup } from "@/lib/repo/accounts";
import { consumeRateLimit } from "@/lib/repo";
import { headers } from "next/headers";

const GENERIC = "If this address can create an account, check its inbox for a verification link.";

function clientIp(h: Headers): string {
  const platform = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip");
  if (platform) return platform.split(",")[0].trim();
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  return chain.at(-1) ?? "unknown";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the KQA app.");
  const body = await readJson<{ email?: unknown; password?: unknown; tenantName?: unknown }>(req, 8 * 1024);
  if (!body.ok) return body.res;
  const emailRaw = str(body.data.email, 254) ?? "";
  const parsed = parseEmail(emailRaw);
  const password = typeof body.data.password === "string" ? body.data.password : "";
  const tenantName = str(body.data.tenantName, 100) ?? "";
  if (!tenantName) return fail(400, "Enter a workspace name.", { field: "tenantName" });
  if (!parsed.ok || !parsed.email) return fail(400, "Enter a valid email address.", { field: "email" });
  if (password.length < 12 || password.length > 200) return fail(400, "Use a password between 12 and 200 characters.", { field: "password" });
  if (/\.(local|test|example|invalid)$/i.test(parsed.email.split("@")[1] ?? "")) {
    return fail(400, "Use an email address that can receive the verification message.", { field: "email" });
  }

  const smtp = smtpSettings();
  const base = publicBaseUrl();
  if (!smtp.ok || !base.ok) return fail(503, "Signup is temporarily unavailable. Try again later.");

  const h = await headers();
  const ipKey = `signup-ip:${clientIp(h)}`;
  const emailKey = `signup-email:${createHash("sha256").update(parsed.email).digest("hex")}`;
  const generic = () => json({ ok: true, message: GENERIC });
  try {
    const [ipAllowed, emailAllowed] = await Promise.all([consumeRateLimit(ipKey, 5), consumeRateLimit(emailKey, 3)]);
    if (!ipAllowed || !emailAllowed) return fail(429, "Too many attempts. Wait a few minutes and try again.");
  } catch {
    return fail(503, "Signup is temporarily unavailable. Try again later.");
  }

  const token = randomBytes(32).toString("base64url");
  let pending: Awaited<ReturnType<typeof createPendingSignup>>;
  try {
    pending = await createPendingSignup({ email: parsed.email, password, tenantName, token });
  } catch {
    return fail(503, "Signup is temporarily unavailable. Try again later.");
  }
  if (!pending.ok) return generic();

  const verifyUrl = new URL("/verify", base.origin);
  verifyUrl.hash = new URLSearchParams({ token }).toString();
  try {
    await sendSmtp({
      to: parsed.email,
      subject: "Verify your KQA account",
      messageId: newMessageId(smtp.user),
      text: `Verify your KQA account and create the ${tenantName} workspace: ${verifyUrl.toString()}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this message.`,
      html: `<p>Verify your KQA account and create the <strong>${escapeHtml(tenantName)}</strong> workspace.</p><p><a href="${escapeHtml(verifyUrl.toString())}">Verify email address</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this message.</p>`,
    });
    return generic();
  } catch {
    await removePendingSignup(pending.id).catch(() => {});
    return fail(503, "We could not send the verification email. Try again later.");
  }
}
