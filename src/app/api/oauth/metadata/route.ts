import { authorizationServerMetadata, protectedResourceMetadata, requestOrigin } from "@/lib/mcp/oauth";

const HEADERS = { "Content-Type": "application/json", "Cache-Control": "public, max-age=60" };

export function GET(req: Request) {
  const url = new URL(req.url);
  const marker = `${url.pathname}${url.search}`;
  const authorizationServer = url.searchParams.get("kind") === "as" || marker.includes("oauth-authorization-server") || marker.includes("openid-configuration");
  const body = authorizationServer ? authorizationServerMetadata(requestOrigin(req)) : protectedResourceMetadata(requestOrigin(req));
  return new Response(JSON.stringify(body), { status: 200, headers: HEADERS });
}
