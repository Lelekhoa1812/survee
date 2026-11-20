import { fail, json, readJson, sameOrigin, str, withServerErrors } from "@/lib/http";
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
    return json({ ok: true, email: result.email });
  } catch {
    return fail(503, "Email verification is temporarily unavailable. Try again.");
  }
});
