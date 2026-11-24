import { fail, guardAdmin, json, readJson, str, adminSession, withServerErrors } from "@/lib/http";
import { createApiKeyWithOperation, hashKey, listApiKeys } from "@/lib/repo/keys";
import { DEFAULT_MCP_CAPABILITIES, parseMcpCapabilities } from "@/lib/mcp/capabilities";
import { operationArgumentDigest, requestOperationId } from "@/lib/operation-id";

export const GET = withServerErrors("admin/keys", async function GET() {
  const denied = await guardAdmin({ roles: ["owner", "admin"] });
  if (denied) return denied;
  return json({ ok: true, keys: await listApiKeys() });
});

export const POST = withServerErrors("admin/keys", async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const operationId = requestOperationId(req);
  if (!operationId) return fail(400, "Send a valid Idempotency-Key header so an uncertain retry cannot create a duplicate key.", { code: "idempotency_key_required" });
  const body = await readJson<{ name?: unknown; note?: unknown; value?: unknown; expiresAt?: unknown; capabilities?: unknown }>(req);
  if (!body.ok) return body.res;
  const name = str(body.data.name, 80);
  if (!name) return fail(400, "Give the key a name.");
  const note = str(body.data.note, 500);
  const secret = typeof body.data.value === "string" ? body.data.value.trim() : "";
  if (!secret) return fail(400, "Generate or enter a key value before creating the key.");
  const expires = parseExpiry(body.data.expiresAt);
  if (!expires.ok) return fail(400, expires.error);
  const capabilities = body.data.capabilities === undefined ? [...DEFAULT_MCP_CAPABILITIES] : parseMcpCapabilities(body.data.capabilities);
  if (!capabilities) return fail(400, "Choose at least one valid access permission.");
  const created = await createApiKeyWithOperation(
    { name, note, secret, expiresAt: expires.date, createdBy: session.email, capabilities },
    {
      operationId,
      credentialId: `host:${session.userId}`,
      argumentDigest: operationArgumentDigest({ name, note, secretHash: hashKey(secret), expiresAt: expires.date?.toISOString() ?? null, capabilities }),
    },
  );
  if (created.kind === "invalid") return fail(400, created.error);
  if (created.kind === "conflict") return fail(409, "This Idempotency-Key was already used with different key details.", { code: "idempotency_key_conflict" });
  if (created.kind === "unavailable") return fail(409, "This key was deleted after creation. Use a new Idempotency-Key to create another key.", { code: "idempotency_result_unavailable" });
  return json({ ok: true, key: created.key, secret }, created.kind === "created" ? 201 : 200);
});

function parseExpiry(value: unknown): { ok: true; date: Date | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, date: null };
  if (typeof value !== "string") return { ok: false, error: "Expiry must be a date and time." };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false, error: "Expiry must be a date and time." };
  if (date.getTime() <= Date.now()) return { ok: false, error: "Choose an expiry in the future, or leave it blank." };
  return { ok: true, date };
}
