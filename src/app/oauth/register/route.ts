import { registerClient } from "@/lib/mcp/oauth";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

export async function POST(req: Request) {
  let body: { client_name?: unknown; redirect_uris?: unknown; token_endpoint_auth_method?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "invalid_client_metadata" }), { status: 400, headers: JSON_HEADERS });
  }
  if (body.token_endpoint_auth_method != null && body.token_endpoint_auth_method !== "none") {
    return new Response(JSON.stringify({ error: "invalid_client_metadata", error_description: "This server only accepts public clients." }), { status: 400, headers: JSON_HEADERS });
  }
  const uris = Array.isArray(body.redirect_uris) ? body.redirect_uris.filter((uri): uri is string => typeof uri === "string") : [];
  const created = await registerClient({ name: typeof body.client_name === "string" ? body.client_name : undefined, redirectUris: uris });
  if (!created.ok) return new Response(JSON.stringify({ error: "invalid_client_metadata", error_description: created.error }), { status: 400, headers: JSON_HEADERS });
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
