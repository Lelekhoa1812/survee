import { authorizeMcp } from "./auth";
import { requestOrigin, wwwAuthenticate } from "./oauth";
import { dispatchTool, listToolDefs } from "./tools";
import { withTenantPrincipal } from "../tenant-context";
import type { McpCapability } from "./capabilities";
import { mcpOriginError, withMcpCors } from "./origin";
import { getPrompt, listPrompts } from "./prompts";

const PROTOCOL = "2025-06-18";
const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };

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

function protocolVersion(requested: unknown): string {
  // KQA implements only this version. Echo it when requested; otherwise answer
  // with a version the server supports, as required by MCP version negotiation.
  if (requested === PROTOCOL) return requested;
  return PROTOCOL;
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

async function handleOne(msg: RpcRequest, capabilities?: McpCapability[]): Promise<unknown | null> {
  if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0" || typeof msg.method !== "string") {
    return rpcError(msg?.id ?? null, -32600, "Invalid request.");
  }
  const hasId = Object.prototype.hasOwnProperty.call(msg, "id");
  if (msg.method === "notifications/initialized" || msg.method.startsWith("notifications/")) return hasId ? rpcResult(msg.id ?? null, {}) : null;
  if (!hasId) return null;
  if (msg.method === "initialize") {
    const params = (msg.params ?? {}) as { protocolVersion?: unknown; clientInfo?: unknown };
    return rpcResult(msg.id ?? null, {
      protocolVersion: protocolVersion(params.protocolVersion),
      capabilities: { tools: { listChanged: false }, prompts: { listChanged: false } },
      serverInfo: { name: "kqa", version: "1.0.0" },
      instructions: "KQA host tools and user-selected prompt templates. Use prompts/list to discover draft, review and update workflows; prompts do not add permissions or approve actions. Available tools reflect this credential's permissions; ask the workspace owner to grant a capability if a tool is unavailable. Send invites with send_invite. Check delivery with check_invite_delivery. This server does not read a mailbox except for message ids it stored.",
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
    const result = await dispatchTool(params.name, params.arguments ?? {}, capabilities);
    return rpcResult(msg.id ?? null, result);
  }
  return rpcError(msg.id ?? null, -32601, `Unknown method: ${msg.method}`);
}

/** Stateless Streamable HTTP: one JSON-RPC response, no session, no open stream. Auth runs before any tool. */
export async function handleMcp(req: Request): Promise<Response> {
  const originError = mcpOriginError(req);
  if (originError) return originError;
  const auth = await authorizeMcp(req);
  if (!auth.ok) return withMcpCors(req, unauthorized(req));
  const response = await withTenantPrincipal(auth.principal, async () => {
    if (!acceptable(req)) return new Response(JSON.stringify({ error: "Accept application/json or text/event-stream." }), { status: 406, headers: JSON_HEADERS });
    const body = await readBody(req);
    if (!body.ok) return new Response(JSON.stringify(rpcError(null, -32700, body.message)), { status: body.status, headers: JSON_HEADERS });
    // KQA speaks MCP 2025-06-18, which removed JSON-RPC batch support. Reject
    // arrays before dispatch so a small-message batch cannot fan out work.
    if (Array.isArray(body.data)) {
      return new Response(JSON.stringify(rpcError(null, -32600, "JSON-RPC batch requests are not supported.")), { status: 400, headers: JSON_HEADERS });
    }
    const reply = await handleOne(body.data as RpcRequest, auth.capabilities);
    if (!reply) return new Response(null, { status: 202, headers: JSON_HEADERS });
    return new Response(JSON.stringify(reply), { status: 200, headers: JSON_HEADERS });
  });
  return withMcpCors(req, response);
}
