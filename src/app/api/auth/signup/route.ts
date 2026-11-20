import { createHash, randomBytes } from "node:crypto";
import { parseEmail } from "@/lib/mail/address";
import { newMessageId, sendSmtp } from "@/lib/mail/smtp";
import { smtpSettings, publicBaseUrl } from "@/lib/env";
import { fail, json, readJson, sameOrigin, str, withServerErrors } from "@/lib/http";
import { createPendingSignup, removePendingSignup } from "@/lib/repo/accounts";
import { consumeRateLimit } from "@/lib/repo";
import { headers } from "next/headers";

const GENERIC = "If this address is eligible for a survee workspace, check its inbox for next steps.";

function clientIp(h: Headers): string {
  // Vercel supplies this independently of proxy-overwritable x-forwarded-for.
  // Do not accept caller-provided forwarding headers as a rate-limit identity.
  return h.get("x-vercel-forwarded-for")?.split(",")[0].trim() || "unknown";
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] ?? char);
}

export const POST = withServerErrors("auth/signup", async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the survee app.");
  const body = await readJson<{ email?: unknown; password?: unknown; tenantName?: unknown }>(req, 8 * 1024);
  if (!body.ok) return body.res;
  const emailRaw = str(body.data.email, 254) ?? "";
  const parsed = parseEmail(emailRaw);
  const password = typeof body.data.password === "string" ? body.data.password : "";
  const tenantName = str(body.data.tenantName, 100) ?? "";
  if (!tenantName) return fail(400, "Enter a workspace name.", { field: "tenantName" });
  if (!parsed.ok || !parsed.email) return fail(400, "Enter a valid email address.", { field: "email" });
  if (password.length < 8 || password.length > 200) return fail(400, "Use a password between 8 and 200 characters.", { field: "password" });
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
  if (!pending.ok && pending.reason === "signup_pending") return generic();
  const email = pending.ok
    ? (() => {
        const verifyUrl = new URL("/verify", base.origin);
        verifyUrl.hash = new URLSearchParams({ token }).toString();
        return {
          subject: "Verify your survee account",
          text: `Verify your survee account and create the ${tenantName} workspace: ${verifyUrl.toString()}\n\nThis link expires in 30 minutes. If you did not request this, you can ignore this message.`,
          html: `<p>Verify your survee account and create the <strong>${escapeHtml(tenantName)}</strong> workspace.</p><p><a href="${escapeHtml(verifyUrl.toString())}">Verify email address</a></p><p>This link expires in 30 minutes. If you did not request this, you can ignore this message.</p>`,
        };
      })()
    : {
        subject: "A survee account sign-in was requested",
        text: `Someone tried to create a survee workspace with this email address, but an account is already associated with it. If this was you, sign in at ${base.origin}/admin/login or reset your password at ${base.origin}/forgot-password. If you did not request this, you can ignore this message.`,
        html: `<p>Someone tried to create a survee workspace with this email address, but an account is already associated with it.</p><p>If this was you, <a href="${escapeHtml(`${base.origin}/admin/login`)}">sign in</a> or <a href="${escapeHtml(`${base.origin}/forgot-password`)}">reset your password</a>.</p><p>If you did not request this, you can ignore this message.</p>`,
      };
  try {
    await sendSmtp({
      to: parsed.email,
      ...email,
      messageId: newMessageId(smtp.user),
    });
    return generic();
  } catch {
    if (pending.ok) await removePendingSignup(pending.id).catch(() => {});
    return fail(503, "We could not send the survee message. Try again later.");
  }
});
