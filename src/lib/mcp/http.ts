import { authorizeMcp } from "./auth";
import { randomUUID } from "node:crypto";
import { requestOrigin, wwwAuthenticate } from "./oauth";
import { dispatchTool, listToolDefs } from "./tools";
import { withTenantPrincipal } from "../tenant-context";
import type { McpCapability } from "./capabilities";
import { mcpOriginError, withMcpCors } from "./origin";
import { getPrompt, listPrompts } from "./prompts";
import { consumeRateLimit } from "../repo";
import type { TenantPrincipal } from "../tenant-context";

const PROTOCOL = "2025-06-18";
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const MCP_TOOL_WINDOW_MINUTES = 15;
const MCP_TOOL_CALL_LIMIT = 600;
const MCP_EXPENSIVE_TOOL_CALL_LIMIT = 60;
const MCP_IP_TOOL_CALL_LIMIT = 6_000;
const MCP_IP_EXPENSIVE_TOOL_CALL_LIMIT = 240;
const EXPENSIVE_MCP_TOOLS = new Set(["analyze_answers", "export_interview", "get_answers", "list_people", "send_invites"]);

export function unauthorized(req: Request): Response {
  return new Response(JSON.stringify({ error: "Unauthorized." }), {
    status: 401,
    headers: { ...JSON_HEADERS, "WWW-Authenticate": wwwAuthenticate(requestOrigin(req)) },
  });
}

type RpcId = string | number | null;

interface RpcRequest {
  jsonrpc?: string;
  id?: RpcId;
  method?: string;
  params?: unknown;
}

function rpcResult(id: RpcId, result: unknown) {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(id: RpcId, code: number, message: string) {
  return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
}

function acceptable(req: Request): boolean {
  const accept = req.headers.get("accept");
  if (!accept) return true;
  return /application\/json|\*\/\*|text\/event-stream/i.test(accept);
}

function hasJsonContentType(req: Request): boolean {
  const contentType = req.headers.get("content-type");
  if (!contentType) return false;
  return contentType.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

function protocolVersion(requested: unknown): string {
  // survee implements only this version. Echo it when requested; otherwise answer
  // with a version the server supports, as required by MCP version negotiation.
  if (requested === PROTOCOL) return requested;
  return PROTOCOL;
}

function credentialRateLimitId(principal: TenantPrincipal): string {
  const actor = principal.auditActor;
  return actor ? `${principal.tenantId}:${actor.kind}:${actor.id}` : `${principal.tenantId}:${principal.source}`;
}

async function mcpToolRateLimit(req: Request, credentialId: string, expensive: boolean): Promise<"allowed" | "limited" | "unavailable"> {
  try {
    const checks = [consumeRateLimit(`mcp-tool-key:${credentialId}`, MCP_TOOL_CALL_LIMIT, MCP_TOOL_WINDOW_MINUTES)];
    const platformIp = req.headers.get("x-vercel-forwarded-for")?.split(",", 1)[0]?.trim();
    if (platformIp) checks.push(consumeRateLimit(`mcp-tool-ip:${platformIp}`, MCP_IP_TOOL_CALL_LIMIT, MCP_TOOL_WINDOW_MINUTES));
    if (expensive) {
      checks.push(consumeRateLimit(`mcp-tool-expensive-key:${credentialId}`, MCP_EXPENSIVE_TOOL_CALL_LIMIT, MCP_TOOL_WINDOW_MINUTES));
      if (platformIp) checks.push(consumeRateLimit(`mcp-tool-expensive-ip:${platformIp}`, MCP_IP_EXPENSIVE_TOOL_CALL_LIMIT, MCP_TOOL_WINDOW_MINUTES));
    }
    const allowed = await Promise.all(checks);
    return allowed.every(Boolean) ? "allowed" : "limited";
  } catch {
    return "unavailable";
  }
}

async function readBody(req: Request): Promise<{ ok: true; data: unknown } | { ok: false; status: number; message: string }> {
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > 3.5 * 1024 * 1024) return { ok: false, status: 413, message: "That request is too large." };
  const reader = req.body?.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > 3.5 * 1024 * 1024) {
        await reader.cancel().catch(() => {});
        return { ok: false, status: 413, message: "That request is too large." };
      }
      chunks.push(value);
    }
  }
  try {
    return { ok: true, data: JSON.parse(Buffer.concat(chunks).toString("utf8")) };
  } catch {
    return { ok: false, status: 400, message: "That request was not valid JSON." };
  }
}

async function handleOne(msg: RpcRequest, capabilities?: McpCapability[], requestId?: string): Promise<unknown | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id ?? null, -32600, "Invalid request.");
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  if (hasId && msg.id !== null && typeof msg.id !== "string" && typeof msg.id !== "number") {
    return rpcError(null, -32600, "Invalid request.");
  }
  if (msg.method === "notifications/initialized" || msg.method.startsWith("notifications/")) return hasId ? rpcResult(msg.id ?? null, {}) : null;
  if (!hasId) return null;
  if (msg.method === "initialize") {
    const params = (msg.params ?? {}) as { protocolVersion?: unknown; clientInfo?: unknown };
    return rpcResult(msg.id ?? null, {
      protocolVersion: protocolVersion(params.protocolVersion),
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
      serverInfo: { name: "survee", version: "1.0.0" },
      instructions: "survee host tools and user-selected prompt templates. Use prompts/list to discover draft, review and update workflows; prompts do not add permissions or approve actions. Available tools reflect this credential's permissions; ask the workspace owner to grant a capability if a tool is unavailable. Send invites with send_invite. Check delivery with check_invite_delivery. This server does not read a mailbox except for message ids it stored.",
    });
  }
  if (msg.method === "ping") return rpcResult(msg.id ?? null, {});
  if (msg.method === "tools/list") return rpcResult(msg.id ?? null, { tools: listToolDefs(capabilities) });
  if (msg.method === "prompts/list") return rpcResult(msg.id ?? null, { prompts: listPrompts() });
  if (msg.method === "prompts/get") {
    const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
    try {
      const prompt = getPrompt(params.name, params.arguments);
      if (!prompt) return rpcError(msg.id ?? null, -32602, "Unknown prompt.");
      return rpcResult(msg.id ?? null, prompt);
    } catch (error) {
      return rpcError(msg.id ?? null, -32602, error instanceof Error ? error.message : "Invalid prompt arguments.");
    }
  }
  if (msg.method === "tools/call") {
    const params = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
    if (typeof params.name !== "string") return rpcError(msg.id ?? null, -32602, "Tool name is required.");
    const result = await dispatchTool(params.name, params.arguments ?? {}, capabilities, requestId);
    return rpcResult(msg.id ?? null, result);
  }
  return rpcError(msg.id ?? null, -32601, `Unknown method: ${msg.method}`);
}

/** Stateless Streamable HTTP: one JSON-RPC response, no session, no open stream. Auth runs before any tool. */
export async function handleMcp(req: Request): Promise<Response> {
  const requestId = randomUUID();
  try {
    return await handleMcpRequest(req, requestId);
  } catch (error) {
    console.error("[mcp:http] unexpected error", { requestId, errorType: error instanceof Error ? error.name : "unknown" });
    return new Response(JSON.stringify({ error: "MCP request could not be completed. Try again in a moment.", code: "server_error", requestId }), {
      status: 500,
      headers: { ...JSON_HEADERS, "x-request-id": requestId },
    });
  }
}

async function handleMcpRequest(req: Request, requestId: string): Promise<Response> {
  const originError = mcpOriginError(req);
  if (originError) {
    originError.headers.set("x-request-id", requestId);
    return originError;
  }
  const auth = await authorizeMcp(req);
  if (!auth.ok) {
    const response = withMcpCors(req, unauthorized(req));
    response.headers.set("x-request-id", requestId);
    return response;
  }
  const response = await withTenantPrincipal(auth.principal, async () => {
    if (!acceptable(req)) return new Response(JSON.stringify({ error: "Accept application/json or text/event-stream." }), { status: 406, headers: JSON_HEADERS });
    if (!hasJsonContentType(req)) return new Response(JSON.stringify({ error: "Content-Type must be application/json." }), { status: 415, headers: JSON_HEADERS });
    const body = await readBody(req);
    if (!body.ok) return new Response(JSON.stringify(rpcError(null, -32700, body.message)), { status: body.status, headers: JSON_HEADERS });
    // survee speaks MCP 2025-06-18, which removed JSON-RPC batch support. Reject
    // arrays before dispatch so a small-message batch cannot fan out work.
    if (Array.isArray(body.data)) {
      return new Response(JSON.stringify(rpcError(null, -32600, "JSON-RPC batch requests are not supported.")), { status: 400, headers: JSON_HEADERS });
    }
    const rpc = body.data as RpcRequest;
    if (rpc?.method === "tools/call") {
      const params = rpc.params && typeof rpc.params === "object" ? rpc.params as { name?: unknown } : null;
      if (typeof params?.name === "string") {
        const limited = await mcpToolRateLimit(req, credentialRateLimitId(auth.principal), EXPENSIVE_MCP_TOOLS.has(params.name));
        if (limited !== "allowed") {
          const unavailable = limited === "unavailable";
          const headers = new Headers(JSON_HEADERS);
          if (!unavailable) headers.set("Retry-After", String(MCP_TOOL_WINDOW_MINUTES * 60));
          return new Response(JSON.stringify(rpcError(rpc.id ?? null, unavailable ? -32000 : -32029, unavailable
            ? "MCP request throttling is temporarily unavailable. Try again shortly."
            : "Too many MCP tool calls. Wait before trying again.")), {
            status: unavailable ? 503 : 429,
            headers,
          });
        }
      }
    }
    const reply = await handleOne(body.data as RpcRequest, auth.capabilities, requestId);
    if (!reply) return new Response(null, { status: 202, headers: JSON_HEADERS });
    return new Response(JSON.stringify(reply), { status: 200, headers: JSON_HEADERS });
  });
  const corsResponse = withMcpCors(req, response);
  corsResponse.headers.set("x-request-id", requestId);
  return corsResponse;
}
