import { timingSafeEqual } from "node:crypto";
import { mcpToken } from "../env";

/**
 * Locked: missing or wrong bearer is 401 and this function does not touch Mongo.
 * The admin cookie is not accepted. A token in the query string is refused so it cannot land in a log URL.
 */
export function authorizeMcp(req: Request): { ok: true } | { ok: false; status: 401; error: string } {
  const url = new URL(req.url);
  if (url.searchParams.has("token") || url.searchParams.has("access_token") || url.searchParams.has("KQA_MCP_TOKEN")) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  const expected = mcpToken();
  if (!match || !expected || !tokensMatch(match[1], expected)) return { ok: false, status: 401, error: "Unauthorized." };
  return { ok: true };
}

function tokensMatch(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  if (a.length !== b.length || b.length < 32) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
}
