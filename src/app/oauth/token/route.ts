import { exchangeCode, tokenResponse } from "@/lib/mcp/oauth";
import { rotateOAuthKey } from "@/lib/repo/keys";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 16 * 1024;

function fail(error: string, status = 400) {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

async function readForm(req: Request): Promise<Record<string, string>> {
  const mediaType = (req.headers.get("content-type") ?? "").split(";", 1)[0].trim().toLowerCase();
  if (mediaType !== "application/json" && mediaType !== "application/x-www-form-urlencoded") {
    throw new RequestBodyError(415, "unsupported_media_type");
  }

  const rawLength = req.headers.get("content-length");
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > MAX_BODY_BYTES) {
    throw new RequestBodyError(413, "invalid_request");
  }

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body?.getReader();
  if (reader) {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        throw new RequestBodyError(400, "invalid_request");
      }
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        throw new RequestBodyError(413, "invalid_request");
      }
      chunks.push(chunk.value);
    }
  }

  const text = Buffer.concat(chunks).toString("utf8");
  if (mediaType === "application/x-www-form-urlencoded") return Object.fromEntries(new URLSearchParams(text));
  try {
    const body: unknown = JSON.parse(text);
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Expected an object.");
    return Object.fromEntries(Object.entries(body).map(([key, value]) => [key, typeof value === "string" ? value : ""]));
  } catch {
    throw new RequestBodyError(400, "invalid_request");
  }
}

class RequestBodyError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export async function POST(req: Request) {
  let form: Record<string, string>;
  try {
    form = await readForm(req);
  } catch (error) {
    if (error instanceof RequestBodyError) return fail(error.code, error.status);
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
