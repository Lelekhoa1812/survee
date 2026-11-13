import { handleMcp } from "@/lib/mcp/http";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const JSON_HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store", Allow: "POST" };

export function GET() {
  return new Response(JSON.stringify({ error: "Method not allowed. POST JSON-RPC to this URL." }), { status: 405, headers: JSON_HEADERS });
}

export function DELETE() {
  return new Response(JSON.stringify({ error: "This server does not keep a session." }), { status: 405, headers: JSON_HEADERS });
}

export function POST(req: Request) {
  return handleMcp(req);
}
