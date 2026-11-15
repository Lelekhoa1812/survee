import { AsyncLocalStorage } from "node:async_hooks";
import { cookies } from "next/headers";
import { AXION_TENANT_ID } from "./env";
import { SESSION_COOKIE, verifySession } from "./auth";

export interface TenantPrincipal {
  tenantId: string;
  userId?: string;
  email?: string;
  role?: "owner" | "admin" | "member" | "service";
  source: "session" | "api_key" | "service_token";
  /** Safe credential identity for MCP audit events. Never contains a bearer value. */
  auditActor?: {
    kind: "api_key" | "oauth" | "service_token";
    id: string;
    name: string;
  };
}

const principalStorage = new AsyncLocalStorage<TenantPrincipal>();

/** Establish the authenticated tenant for one MCP request. Never accepts a tenant from tool arguments. */
export function withTenantPrincipal<T>(principal: TenantPrincipal, run: () => T): T {
  return principalStorage.run(principal, run);
}

export function currentPrincipal(): TenantPrincipal | null {
  return principalStorage.getStore() ?? null;
}

/**
 * Admin repository calls resolve the tenant from the signed session cookie. MCP calls use
 * AsyncLocalStorage after the bearer has been authenticated. Missing context fails closed.
 */
export async function currentTenantId(): Promise<string | null> {
  const scoped = currentPrincipal();
  if (scoped?.tenantId) return scoped.tenantId;
  try {
    const jar = await cookies();
    return verifySession(jar.get(SESSION_COOKIE)?.value)?.tenantId ?? null;
  } catch {
    return null;
  }
}

/** Scope a Mongo filter. During migration only, Axion can also see documents that have no tenantId. */
export function tenantFilter<T extends Record<string, unknown>>(tenantId: string, filter: T = {} as T): Record<string, unknown> {
  const ownerScope = tenantId === AXION_TENANT_ID
    ? { $or: [{ tenantId }, { tenantId: { $exists: false } }] }
    : { tenantId };
  return Object.keys(filter).length ? { $and: [ownerScope, filter] } : ownerScope;
}
