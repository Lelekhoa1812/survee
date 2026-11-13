import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ObjectId } from "mongodb";
import { col } from "../db";
import { createApiKey, generateKeySecret, hashKey } from "../repo/keys";

export const OAUTH_SCOPE = "host";
const CODE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Origin ChatGPT actually called, so discovery matches that URL. */
export function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const host = (req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host).split(",")[0].trim();
  const proto = (req.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")).split(",")[0].trim();
  return `${proto}://${host}`;
}

export function mcpResource(origin: string): string {
  return `${origin}/api/mcp`;
}

export function wwwAuthenticate(origin: string): string {
  return `Bearer realm="kqa", resource_metadata="${origin}/.well-known/oauth-protected-resource/api/mcp", scope="${OAUTH_SCOPE}"`;
}

export function protectedResourceMetadata(origin: string) {
  return {
    resource: mcpResource(origin),
    authorization_servers: [origin],
    scopes_supported: [OAUTH_SCOPE],
    bearer_methods_supported: ["header"],
    resource_documentation: `${origin}/admin/docs`,
  };
}

export function authorizationServerMetadata(origin: string) {
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [OAUTH_SCOPE],
    authorization_response_iss_parameter_supported: true,
  };
}

export function s256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export function challengesMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}

/** https, or http on localhost only. No fragment, no userinfo. */
export function allowedRedirect(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.username || url.password || url.hash) return false;
  if (url.protocol === "https:") return true;
  return url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
}

export async function registerClient(input: { name?: string; redirectUris: string[] }): Promise<{ ok: true; clientId: string; name: string; redirectUris: string[] } | { ok: false; error: string }> {
  const uris = input.redirectUris.map((uri) => uri.trim()).filter(Boolean);
  if (!uris.length || uris.length > 5) return { ok: false, error: "Send one to five redirect URLs." };
  if (uris.some((uri) => !allowedRedirect(uri))) return { ok: false, error: "Redirect URLs must be https, or http on localhost." };
  const name = (input.name ?? "MCP client").trim().slice(0, 80) || "MCP client";
  const clientId = `kqa_${randomBytes(16).toString("base64url")}`;
  await (await col.oauthClients()).insertOne({ _id: new ObjectId(), clientId, name, redirectUris: uris, createdAt: new Date() });
  return { ok: true, clientId, name, redirectUris: uris };
}

export async function findClient(clientId: string) {
  if (!clientId || clientId.length > 80) return null;
  return (await col.oauthClients()).findOne({ clientId });
}

export function authorizeError(redirectUri: string, issuer: string, error: string, state?: string): string {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error);
  url.searchParams.set("iss", issuer);
  if (state) url.searchParams.set("state", state);
  return url.toString();
}

export async function issueCode(input: { clientId: string; redirectUri: string; challenge: string; email: string }): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await (await col.oauthCodes()).insertOne({
    _id: new ObjectId(),
    hash: hashKey(code),
    clientId: input.clientId,
    redirectUri: input.redirectUri,
    challenge: input.challenge,
    email: input.email,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
  });
  return code;
}

export async function exchangeCode(input: { code: string; clientId: string; redirectUri: string; verifier: string }): Promise<{ ok: true; access: string; refresh: string; expiresIn: number } | { ok: false; error: string }> {
  const codes = await col.oauthCodes();
  const doc = await codes.findOne({ hash: hashKey(input.code) });
  if (!doc) return { ok: false, error: "invalid_grant" };
  await codes.deleteOne({ _id: doc._id });
  if (doc.expiresAt.getTime() <= Date.now()) return { ok: false, error: "invalid_grant" };
  if (doc.clientId !== input.clientId || doc.redirectUri !== input.redirectUri) return { ok: false, error: "invalid_grant" };
  if (!challengesMatch(s256(input.verifier), doc.challenge)) return { ok: false, error: "invalid_grant" };
  const client = await findClient(doc.clientId);
  const access = generateKeySecret();
  const refresh = generateKeySecret();
  const created = await createApiKey({
    name: client?.name || "OAuth client",
    note: "Signed in through ChatGPT or another OAuth app. Revoke this key to disconnect it.",
    secret: access,
    refreshSecret: refresh,
    expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    createdBy: doc.email,
    oauthClientId: doc.clientId,
  });
  if (!created.ok) return { ok: false, error: "server_error" };
  return { ok: true, access, refresh, expiresIn: Math.floor(TOKEN_TTL_MS / 1000) };
}

export function tokenResponse(access: string, refresh: string, expiresIn: number) {
  return { access_token: access, token_type: "Bearer", expires_in: expiresIn, refresh_token: refresh, scope: OAUTH_SCOPE };
}
