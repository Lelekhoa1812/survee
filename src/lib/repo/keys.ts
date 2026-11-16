import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { ObjectId, type ObjectId as ObjectIdType } from "mongodb";
import { col } from "../db";
import { mcpToken } from "../env";
import type { ApiKeyDoc, ApiKeyView } from "./types";
import { currentTenantId, tenantFilter } from "../tenant-context";
import { AXION_TENANT_ID } from "../env";
import { DEFAULT_MCP_CAPABILITIES, effectiveMcpCapabilitiesForRole, parseMcpCapabilities, type McpCapability } from "../mcp/capabilities";
import { isTenantActive } from "./tenants";

const MIN_SECRET = 32;
const MAX_SECRET = 256;

export function hashKey(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** 256 bits, prefixed so a host can tell a KQA key from another secret. */
export function generateKeySecret(): string {
  return `kqa_${randomBytes(32).toString("base64url")}`;
}

export function splitSecret(secret: string): { prefix: string; suffix: string } {
  return { prefix: secret.slice(0, 12), suffix: secret.slice(-4) };
}

export function validateKeySecret(secret: string): string | null {
  if (secret.length < MIN_SECRET) return `A key value needs at least ${MIN_SECRET} characters.`;
  if (secret.length > MAX_SECRET) return `A key value must be ${MAX_SECRET} characters or fewer.`;
  if (/\s/.test(secret)) return "A key value cannot contain spaces.";
  const env = mcpToken();
  if (env && secret.length === env.length) {
    const same = timingSafeEqual(Buffer.from(secret), Buffer.from(env));
    if (same) return "That value is the server token. Choose a different key.";
  }
  return null;
}

function statusOf(doc: ApiKeyDoc, now = Date.now()): ApiKeyView["status"] {
  if (doc.revokedAt) return "revoked";
  if (doc.expiresAt && doc.expiresAt.getTime() <= now) return "expired";
  return "active";
}

export function toKeyView(doc: ApiKeyDoc): ApiKeyView {
  const capabilities = doc.capabilities === undefined
    ? undefined
    : parseMcpCapabilities(doc.capabilities) ?? [];
  return {
    id: doc._id.toHexString(),
    name: doc.name,
    note: doc.note ?? "",
    prefix: doc.prefix,
    suffix: doc.suffix,
    createdAt: doc.createdAt.toISOString(),
    createdBy: doc.createdBy,
    lastUsedAt: doc.lastUsedAt ? doc.lastUsedAt.toISOString() : null,
    expiresAt: doc.expiresAt ? doc.expiresAt.toISOString() : null,
    revokedAt: doc.revokedAt ? doc.revokedAt.toISOString() : null,
    status: statusOf(doc),
    via: doc.oauthClientId ? "oauth" : "key",
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

export async function listApiKeys(): Promise<ApiKeyView[]> {
  const tenantId = await currentTenantId();
  if (!tenantId) return [];
  const docs = await (await col.apiKeys()).find(tenantFilter(tenantId)).sort({ createdAt: -1 }).toArray();
  return docs.map(toKeyView);
}

export async function createApiKey(input: { name: string; note?: string; secret: string; expiresAt?: Date | null; createdBy: string; tenantId?: string; oauthClientId?: string; oauthUserId?: ObjectIdType; refreshSecret?: string; capabilities?: McpCapability[] }): Promise<{ ok: true; key: ApiKeyView; secret: string } | { ok: false; error: string }> {
  const problem = validateKeySecret(input.secret);
  if (problem) return { ok: false, error: problem };
  const capabilities = input.capabilities ?? [...DEFAULT_MCP_CAPABILITIES];
  if (!parseMcpCapabilities(capabilities)) return { ok: false, error: "Choose at least one valid access permission." };
  const tenantId = input.tenantId ?? await currentTenantId();
  if (!tenantId) return { ok: false, error: "An authenticated tenant is required." };
  const { prefix, suffix } = splitSecret(input.secret);
  const doc: ApiKeyDoc = {
    _id: new ObjectId(),
    tenantId,
    name: input.name,
    note: input.note || undefined,
    prefix,
    suffix,
    hash: hashKey(input.secret),
    createdAt: new Date(),
    createdBy: input.createdBy,
    capabilities,
    expiresAt: input.expiresAt ?? undefined,
    ...(input.oauthClientId ? { oauthClientId: input.oauthClientId } : {}),
    ...(input.oauthUserId ? { oauthUserId: input.oauthUserId } : {}),
    ...(input.refreshSecret ? { refreshHash: hashKey(input.refreshSecret) } : {}),
  };
  try {
    await (await col.apiKeys()).insertOne(doc);
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as { code: number }).code === 11000) {
      return { ok: false, error: "A key with that value already exists." };
    }
    throw e;
  }
  return { ok: true, key: toKeyView(doc), secret: input.secret };
}

export async function updateApiKey(id: string, patch: { name?: string; note?: string | null; expiresAt?: Date | null; revoked?: boolean; capabilities?: McpCapability[] }): Promise<{ ok: true; key: ApiKeyView } | { ok: false; error: string }> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return { ok: false, error: "Key not found." };
  if (patch.capabilities !== undefined && !parseMcpCapabilities(patch.capabilities)) return { ok: false, error: "Choose at least one valid access permission." };
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: "Key not found." };
  const c = await col.apiKeys();
  const existing = await c.findOne(tenantFilter(tenantId, { _id: new ObjectId(id) }));
  if (!existing) return { ok: false, error: "Key not found." };
  const $set: Partial<ApiKeyDoc> = {};
  const $unset: Record<string, ""> = {};
  if (patch.name !== undefined) $set.name = patch.name;
  if (patch.note !== undefined) {
    if (patch.note) $set.note = patch.note;
    else $unset.note = "";
  }
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt) $set.expiresAt = patch.expiresAt;
    else $unset.expiresAt = "";
  }
  if (patch.capabilities !== undefined) $set.capabilities = patch.capabilities;
  if (patch.revoked === true && !existing.revokedAt) $set.revokedAt = new Date();
  if (patch.revoked === false) $unset.revokedAt = "";
  const update: { $set?: Partial<ApiKeyDoc>; $unset?: Record<string, ""> } = {};
  if (Object.keys($set).length) update.$set = $set;
  if (Object.keys($unset).length) update.$unset = $unset;
  if (update.$set || update.$unset) await c.updateOne(tenantFilter(tenantId, { _id: existing._id }), update);
  const next = await c.findOne(tenantFilter(tenantId, { _id: existing._id }));
  if (!next) return { ok: false, error: "Key not found." };
  return { ok: true, key: toKeyView(next) };
}

export async function deleteApiKey(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^[0-9a-f]{24}$/i.test(id)) return { ok: false, error: "Key not found." };
  const tenantId = await currentTenantId();
  if (!tenantId) return { ok: false, error: "Key not found." };
  const result = await (await col.apiKeys()).deleteOne(tenantFilter(tenantId, { _id: new ObjectId(id) }));
  if (!result.deletedCount) return { ok: false, error: "Key not found." };
  return { ok: true };
}

/**
 * True only for a stored key that is not revoked and not past its expiry.
 * Updates last-used at most once a minute. Callers treat false and a database error the same: unauthorized.
 */
export async function authenticateApiKey(secret: string): Promise<boolean> {
  return (await authenticateApiKeyAccess(secret)) !== null;
}

/** Authenticate a bearer and return its immutable tenant binding. */
export async function authenticateApiKeyTenant(secret: string): Promise<string | null> {
  return (await authenticateApiKeyAccess(secret))?.tenantId ?? null;
}

/** Authenticate a bearer and return its immutable tenant binding and tool permissions. */
export async function authenticateApiKeyAccess(secret: string): Promise<{ tenantId: string; auditActor: { kind: "api_key" | "oauth"; id: string; name: string }; capabilities?: McpCapability[] } | null> {
  if (secret.length < MIN_SECRET || secret.length > MAX_SECRET || /\s/.test(secret)) return null;
  const c = await col.apiKeys();
  const doc = await c.findOne({ hash: hashKey(secret) });
  if (!doc || doc.revokedAt) return null;
  if (doc.expiresAt && doc.expiresAt.getTime() <= Date.now()) return null;
  const tenantId = doc.tenantId ?? AXION_TENANT_ID;
  if (!await isTenantActive(tenantId)) return null;
  const oauthRole = doc.oauthClientId ? await oauthWorkspaceRole(doc, tenantId) : null;
  if (doc.oauthClientId && !oauthRole) return null;
  const stale = !doc.lastUsedAt || Date.now() - doc.lastUsedAt.getTime() > 60_000;
  if (stale) void c.updateOne({ _id: doc._id }, { $set: { lastUsedAt: new Date() } }).catch(() => {});
  const name = typeof doc.name === "string" ? doc.name.split(secret).join("[redacted]") : "Unnamed API key";
  const auditActor = { kind: doc.oauthClientId ? "oauth" as const : "api_key" as const, id: doc._id.toHexString(), name };
  const granted = doc.capabilities === undefined ? undefined : parseMcpCapabilities(doc.capabilities) ?? [];
  if (oauthRole) {
    const capabilities = effectiveMcpCapabilitiesForRole(oauthRole, granted);
    return { tenantId, auditActor, ...(capabilities === undefined ? {} : { capabilities }) };
  }
  return granted === undefined ? { tenantId, auditActor } : { tenantId, auditActor, capabilities: granted };
}

/** OAuth credentials stay within the consent-giving account's current workspace role. */
async function oauthWorkspaceRole(doc: ApiKeyDoc, tenantId: string): Promise<"owner" | "admin" | "member" | null> {
  let userId = doc.oauthUserId;
  if (!userId) {
    // Older OAuth keys predate oauthUserId. Resolve them once per request from the recorded email; fail closed if unavailable.
    const user = await (await col.users()).findOne({ email: doc.createdBy });
    userId = user?._id;
  }
  if (!userId) return null;
  const membership = await (await col.memberships()).findOne({ tenantId, userId });
  return membership?.role === "owner" || membership?.role === "admin" || membership?.role === "member" ? membership.role : null;
}

const OAUTH_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Replace the access and refresh secrets for an OAuth connection. The previous values stop working. */
export async function rotateOAuthKey(refreshSecret: string): Promise<{ access: string; refresh: string; expiresIn: number } | null> {
  if (refreshSecret.length < MIN_SECRET || refreshSecret.length > MAX_SECRET) return null;
  const c = await col.apiKeys();
  const previousRefreshHash = hashKey(refreshSecret);
  const doc = await c.findOne({ refreshHash: previousRefreshHash });
  if (!doc || doc.revokedAt) return null;
  const now = new Date();
  if (doc.expiresAt && doc.expiresAt.getTime() <= now.getTime()) return null;
  const tenantId = doc.tenantId ?? AXION_TENANT_ID;
  if (!await isTenantActive(tenantId)) return null;
  if (doc.oauthClientId && !await oauthWorkspaceRole(doc, tenantId)) return null;
  const access = generateKeySecret();
  const refresh = generateKeySecret();
  const { prefix, suffix } = splitSecret(access);
  // Preserve an owner-configured absolute expiry across refresh. Only legacy
  // OAuth rows without an expiry receive the standard lifetime on rotation.
  const expiresAt = doc.expiresAt ?? new Date(now.getTime() + OAUTH_TTL_MS);
  // Compare-and-swap the old refresh hash and the state checked above. Only
  // one concurrent request can replace this refresh token; revocation or an
  // expiry change racing with rotation also causes the claim to fail.
  const rotated = await c.updateOne(
    {
      _id: doc._id,
      refreshHash: previousRefreshHash,
      revokedAt: { $exists: false },
      expiresAt: doc.expiresAt ? { $eq: doc.expiresAt, $gt: now } : { $exists: false },
    },
    { $set: { hash: hashKey(access), refreshHash: hashKey(refresh), prefix, suffix, expiresAt } },
  );
  if (rotated.matchedCount !== 1) return null;
  return { access, refresh, expiresIn: Math.max(0, Math.floor((expiresAt.getTime() - now.getTime()) / 1000)) };
}
