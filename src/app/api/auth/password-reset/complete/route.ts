import { headers } from "next/headers";
import { smtpSettings } from "@/lib/env";
import { fail, json, readJson, sameOrigin, str, withServerErrors } from "@/lib/http";
import { completePasswordReset } from "@/lib/repo/accounts";
import { consumeRateLimit } from "@/lib/repo";
import { newMessageId, sendSmtp } from "@/lib/mail/smtp";

function clientIp(h: Headers): string {
  const platform = h.get("x-vercel-forwarded-for") ?? h.get("x-real-ip");
  if (platform) return platform.split(",")[0].trim();
  const chain = (h.get("x-forwarded-for") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return chain.at(-1) ?? "unknown";
}

export const POST = withServerErrors("auth/password-reset/complete", async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the survee app.");
  const body = await readJson<{ token?: unknown; password?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const token = str(body.data.token, 128);
  const password = typeof body.data.password === "string" ? body.data.password : "";
  if (!token) return fail(400, "That password reset link is invalid or has expired.");
  if (password.length < 8 || password.length > 200) return fail(400, "Use a password between 8 and 200 characters.");
  try {
    const ipKey = `password-reset-complete-ip:${clientIp(await headers())}`;
    if (!(await consumeRateLimit(ipKey, 15))) return fail(429, "Too many attempts. Wait a few minutes and try again.");
    const completed = await completePasswordReset(token, password);
    if (!completed.ok) return fail(400, "That password reset link is invalid or has expired. Request a new one.");

    // The password is already changed. A notification delivery problem must not make
    // the completed reset look like a failure or encourage another submission.
    const smtp = smtpSettings();
    if (smtp.ok) {
      try {
        await sendSmtp({
          to: completed.email,
          subject: "Your survee password was changed",
          messageId: newMessageId(smtp.user),
          text: "Your survee password was changed. If you did not make this change, contact your workspace owner.",
          html: "<p>Your survee password was changed.</p><p>If you did not make this change, contact your workspace owner.</p>",
        });
      } catch {
        // Best effort only; the password change and expired sessions remain effective.
      }
    }
    return json({ ok: true });
  } catch {
    return fail(503, "The password could not be reset. Request a new link and try again.");
  }
});
