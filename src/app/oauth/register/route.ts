import { consumeRateLimit } from "@/lib/repo";
import { registerClient } from "@/lib/mcp/oauth";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 16 * 1024;
const REGISTRATIONS_PER_IP = 30;
const RATE_WINDOW_MINUTES = 60;

type ClientMetadata = {
  client_name?: unknown;
  redirect_uris?: unknown;
  token_endpoint_auth_method?: unknown;
};

function errorResponse(status: number, error: string, description?: string, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error, ...(description ? { error_description: description } : {}) }), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function clientIp(headers: Headers): string {
  const platform = headers.get("x-vercel-forwarded-for") ?? headers.get("x-real-ip");
  if (platform?.trim()) return platform.split(",")[0].trim();
  const chain = (headers.get("x-forwarded-for") ?? "").split(",").map((item) => item.trim()).filter(Boolean);
  return chain.at(-1) ?? "unknown";
}

async function readMetadata(req: Request): Promise<{ ok: true; data: ClientMetadata } | { ok: false; tooLarge?: true }> {
  const rawLength = req.headers.get("content-length");
  if (rawLength && /^\d+$/.test(rawLength) && Number(rawLength) > MAX_BODY_BYTES) return { ok: false, tooLarge: true };

  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = req.body?.getReader();
  if (reader) {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch {
        return { ok: false };
      }
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, tooLarge: true };
      }
      chunks.push(chunk.value);
    }
  }

  try {
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return { ok: false };
    return { ok: true, data: data as ClientMetadata };
  } catch {
    return { ok: false };
  }
}

export async function POST(req: Request) {
  const parsed = await readMetadata(req);
  if (!parsed.ok) {
    return parsed.tooLarge
      ? errorResponse(413, "invalid_client_metadata", "Client metadata is too large.")
      : errorResponse(400, "invalid_client_metadata");
  }

  const body = parsed.data;
  if (body.token_endpoint_auth_method != null && body.token_endpoint_auth_method !== "none") {
    return errorResponse(400, "invalid_client_metadata", "This server only accepts public clients.");
  }
  if (body.client_name != null && typeof body.client_name !== "string") {
    return errorResponse(400, "invalid_client_metadata", "client_name must be a string.");
  }
  if (!Array.isArray(body.redirect_uris) || body.redirect_uris.some((uri) => typeof uri !== "string")) {
    return errorResponse(400, "invalid_client_metadata", "Send one to five redirect URLs.");
  }
  const uris = body.redirect_uris as string[];

  let allowed: boolean;
  try {
    allowed = await consumeRateLimit(`oauth-register-ip:${clientIp(req.headers)}`, REGISTRATIONS_PER_IP, RATE_WINDOW_MINUTES);
  } catch {
    return errorResponse(503, "server_error", "Client registration is temporarily unavailable.");
  }
  if (!allowed) {
    return errorResponse(429, "too_many_requests", "Too many client registrations. Try again later.", { "Retry-After": String(RATE_WINDOW_MINUTES * 60) });
  }

  let created: Awaited<ReturnType<typeof registerClient>>;
  try {
    created = await registerClient({ name: typeof body.client_name === "string" ? body.client_name : undefined, redirectUris: uris });
  } catch {
    return errorResponse(503, "server_error", "Client registration is temporarily unavailable.");
  }
  if (!created.ok) return errorResponse(400, "invalid_client_metadata", created.error);
  return new Response(JSON.stringify({
    client_id: created.clientId,
    client_name: created.name,
    redirect_uris: created.redirectUris,
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    client_id_issued_at: Math.floor(Date.now() / 1000),
  }), { status: 201, headers: JSON_HEADERS });
}
