import { timingSafeEqual } from "node:crypto";
import { AXION_TENANT_ID, mcpToken } from "../env";
import { authenticateApiKeyAccess } from "../repo/keys";
import { isTenantActive } from "../repo/tenants";
import type { TenantPrincipal } from "../tenant-context";
import type { McpCapability } from "./capabilities";

/**
 * Missing bearer, a query-string token, or the admin cookie is 401 and does not touch Mongo.
 * Missing and unknown tokens are rejected before tenant data is loaded. A valid credential
 * must also belong to an active tenant. A revoked, expired, suspended, or unknown key is the same 401.
 */
export async function authorizeMcp(req: Request): Promise<{ ok: true; principal: TenantPrincipal; capabilities?: McpCapability[] } | { ok: false; status: 401; error: string }> {
  const url = new URL(req.url);
  if (url.searchParams.has("token") || url.searchParams.has("access_token") || url.searchParams.has("KQA_MCP_TOKEN")) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return { ok: false, status: 401, error: "Unauthorized." };
  const expected = mcpToken();
  if (expected && tokensMatch(match[1], expected)) {
    try {
      if (await isTenantActive(AXION_TENANT_ID)) return { ok: true, principal: { tenantId: AXION_TENANT_ID, role: "service", source: "service_token" } };
    } catch {
      return { ok: false, status: 401, error: "Unauthorized." };
    }
    return { ok: false, status: 401, error: "Unauthorized." };
  }
  try {
    const access = await authenticateApiKeyAccess(match[1]);
    if (access) return { ok: true, principal: { tenantId: access.tenantId, role: "service", source: "api_key" }, ...(access.capabilities === undefined ? {} : { capabilities: access.capabilities }) };
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
