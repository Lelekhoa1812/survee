import { publicBaseUrl } from "../env";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

/**
 * Browser requests must come from a configured origin to prevent DNS rebinding.
 * Origin-less requests remain available for server-to-server MCP clients.
 */
export function mcpOriginError(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (origin === null) return null;

  if (isAllowedOrigin(origin)) return null;

  return new Response(JSON.stringify({ error: "Origin is not allowed for MCP." }), {
    status: 403,
    headers: JSON_HEADERS,
  });
}

/** Add CORS headers only for origins that passed the MCP allowlist. */
export function withMcpCors(req: Request, response: Response): Response {
  const origin = req.headers.get("origin");
  if (!origin || !isAllowedOrigin(origin)) return response;

  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Expose-Headers", "WWW-Authenticate, x-request-id");
  addVary(headers, "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/** Handle browser preflight for the one method this stateless server supports. */
export function mcpOptionsResponse(req: Request): Response {
  const originError = mcpOriginError(req);
  if (originError) return originError;

  const origin = req.headers.get("origin");
  if (!origin) return methodNotAllowed();

  const method = req.headers.get("access-control-request-method");
  if (!method) return withMcpCors(req, methodNotAllowed());

  const allowedHeaders = new Set(["accept", "authorization", "content-type", "mcp-protocol-version"]);
  const requestedHeaders = (req.headers.get("access-control-request-headers") ?? "")
    .split(",")
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean);
  if (method.toUpperCase() !== "POST" || requestedHeaders.some((header) => !allowedHeaders.has(header))) {
    return withMcpCors(req, new Response(JSON.stringify({ error: "This MCP preflight is not allowed." }), {
      status: 403,
      headers: JSON_HEADERS,
    }));
  }

  const headers = new Headers({
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST",
    "Access-Control-Allow-Headers": "Accept, Authorization, Content-Type, MCP-Protocol-Version",
    "Access-Control-Max-Age": "600",
  });
  addVary(headers, "Origin", "Access-Control-Request-Method", "Access-Control-Request-Headers");
  return new Response(null, { status: 204, headers });
}

function serializedOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.username || url.password || url.origin !== value) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function isAllowedOrigin(value: string): boolean {
  const origin = serializedOrigin(value);
  return origin !== null && allowedOrigins().has(origin);
}

function methodNotAllowed(): Response {
  return new Response(JSON.stringify({ error: "Method not allowed. POST JSON-RPC to this URL." }), {
    status: 405,
    headers: { ...JSON_HEADERS, Allow: "POST" },
  });
}

function addVary(headers: Headers, ...names: string[]): void {
  const vary = new Set((headers.get("Vary") ?? "").split(",").map((name) => name.trim()).filter(Boolean));
  for (const name of names) vary.add(name);
  headers.set("Vary", [...vary].join(", "));
}

function allowedOrigins(): Set<string> {
  const allowed = new Set<string>();
  const app = publicBaseUrl();
  if (app.ok) allowed.add(app.origin);

  // Extra trusted browser clients must be configured as comma-separated,
  // serialized origins (scheme + host + optional non-default port only).
  for (const entry of (process.env.KQA_MCP_ALLOWED_ORIGINS ?? "").split(",")) {
    const origin = serializedOrigin(entry.trim());
    if (origin) allowed.add(origin);
  }
  return allowed;
}
