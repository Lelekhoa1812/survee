import { fail, json, readJson, sameOrigin, str } from "@/lib/http";
import { completePasswordReset } from "@/lib/repo/accounts";

export async function POST(req: Request) {
  if (!(await sameOrigin())) return fail(403, "This request did not come from the KQA app.");
  const body = await readJson<{ token?: unknown; password?: unknown }>(req, 4096);
  if (!body.ok) return body.res;
  const token = str(body.data.token, 128);
  const password = typeof body.data.password === "string" ? body.data.password : "";
  if (!token) return fail(400, "That password reset link is invalid or has expired.");
  if (password.length < 12 || password.length > 200) return fail(400, "Use a password between 12 and 200 characters.");
  try {
    if (!(await completePasswordReset(token, password))) return fail(400, "That password reset link is invalid or has expired. Request a new one.");
    return json({ ok: true });
  } catch {
    return fail(503, "The password could not be reset. Request a new link and try again.");
  }
}
