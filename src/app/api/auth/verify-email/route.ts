import { smtpSettings } from "@/lib/env";
import { fail, json, readJson, sameOrigin, str, withServerErrors } from "@/lib/http";
import { newMessageId, sendSmtp } from "@/lib/mail/smtp";
import { completeEmailChange } from "@/lib/repo/accounts";

export const POST = withServerErrors("auth/verify-email", async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the survee app.");
  const body = await readJson<{ token?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const token = str(body.data.token, 128);
  if (!token) return fail(400, "That verification link is invalid or has expired.");
  try {
    const result = await completeEmailChange(token);
    if (!result.ok) return fail(400, result.error);
    const smtp = smtpSettings();
    if (smtp.ok && result.previousEmail !== result.email) {
      try {
        await sendSmtp({
          to: result.previousEmail,
          subject: "Your survee account email was changed",
          messageId: newMessageId(smtp.user),
          text: "The sign-in email for your survee account was changed. If you did not make this change, reset your password using your current sign-in address and contact your workspace owner.",
          html: "<p>The sign-in email for your survee account was changed.</p><p>If you did not make this change, reset your password using your current sign-in address and contact your workspace owner.</p>",
        });
      } catch {
        // The address change is already committed. A notice delivery failure must not misreport it as failed.
        console.error("[security] account email change notification could not be sent");
      }
    }
    return json({ ok: true, email: result.email });
  } catch {
    return fail(503, "Email verification is temporarily unavailable. Try again.");
  }
});
