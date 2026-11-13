import { timingSafeEqual } from "node:crypto";
import { mcpToken } from "../env";
import { authenticateApiKey } from "../repo/keys";

/**
 * Missing bearer, a query-string token, or the admin cookie is 401 and does not touch Mongo.
 * The env token is compared first, still without Mongo. Any other bearer is one hash lookup
 * against api_keys. A revoked, expired, or unknown key is the same 401.
 */
export async function authorizeMcp(req: Request): Promise<{ ok: true } | { ok: false; status: 401; error: string }> {
  const url = new URL(req.url);
  if (url.searchParams.has("token") || url.searchParams.has("access_token") || url.searchParams.has("KQA_MCP_TOKEN")) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return { ok: false, status: 401, error: "Unauthorized." };
  const expected = mcpToken();
  if (expected && tokensMatch(match[1], expected)) return { ok: true };
  try {
    if (await authenticateApiKey(match[1])) return { ok: true };
  } catch {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  return { ok: false, status: 401, error: "Unauthorized." };
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
