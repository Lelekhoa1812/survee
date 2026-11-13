import { exchangeCode, tokenResponse } from "@/lib/mcp/oauth";
import { rotateOAuthKey } from "@/lib/repo/keys";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

function fail(error: string, status = 400) {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

async function readForm(req: Request): Promise<Record<string, string>> {
  const type = req.headers.get("content-type") ?? "";
  if (type.includes("application/json")) {
    const body = await req.json() as Record<string, unknown>;
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === "string" ? value : ""]));
  }
  const text = await req.text();
  return Object.fromEntries(new URLSearchParams(text));
}

export async function POST(req: Request) {
  let form: Record<string, string>;
  try {
    form = await readForm(req);
  } catch {
    return fail("invalid_request");
  }
  if (form.grant_type === "authorization_code") {
    if (!form.code || !form.client_id || !form.redirect_uri || !form.code_verifier) return fail("invalid_request");
    const exchanged = await exchangeCode({ code: form.code, clientId: form.client_id, redirectUri: form.redirect_uri, verifier: form.code_verifier });
    if (!exchanged.ok) return fail(exchanged.error, exchanged.error === "invalid_grant" ? 400 : 500);
    return new Response(JSON.stringify(tokenResponse(exchanged.access, exchanged.refresh, exchanged.expiresIn)), { status: 200, headers: JSON_HEADERS });
  }
  if (form.grant_type === "refresh_token") {
    if (!form.refresh_token) return fail("invalid_request");
    const rotated = await rotateOAuthKey(form.refresh_token);
    if (!rotated) return fail("invalid_grant");
    return new Response(JSON.stringify(tokenResponse(rotated.access, rotated.refresh, rotated.expiresIn)), { status: 200, headers: JSON_HEADERS });
  }
  return fail("unsupported_grant_type");
}
