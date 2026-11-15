import { authorizeMcp } from "@/lib/mcp/auth";
import { handleMcp, unauthorized } from "@/lib/mcp/http";
import { mcpOptionsResponse, mcpOriginError, withMcpCors } from "@/lib/mcp/origin";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Allow: "POST" };

export async function GET(req: Request) {
  const originError = mcpOriginError(req);
  if (originError) return originError;
  const auth = await authorizeMcp(req);
  if (!auth.ok) return withMcpCors(req, unauthorized(req));
  return withMcpCors(req, new Response(JSON.stringify({ error: "Method not allowed. POST JSON-RPC to this URL." }), { status: 405, headers: JSON_HEADERS }));
}

export function DELETE(req: Request) {
  const originError = mcpOriginError(req);
  if (originError) return originError;
  return withMcpCors(req, new Response(JSON.stringify({ error: "This server does not keep a session." }), { status: 405, headers: JSON_HEADERS }));
}

export function OPTIONS(req: Request) {
  return mcpOptionsResponse(req);
}

export function POST(req: Request) {
  return handleMcp(req);
}
