import { fail, guardAdmin, json, readJson, str } from "@/lib/http";
import { deleteApiKey, updateApiKey } from "@/lib/repo/keys";
import { parseMcpCapabilities, type McpCapability } from "@/lib/mcp/capabilities";

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { id } = await ctx.params;
  const body = await readJson<{ name?: unknown; note?: unknown; expiresAt?: unknown; revoked?: unknown; capabilities?: unknown }>(req);
  if (!body.ok) return body.res;
  const patch: { name?: string; note?: string | null; expiresAt?: Date | null; revoked?: boolean; capabilities?: McpCapability[] } = {};
  if ("name" in body.data) {
    const name = str(body.data.name, 80);
    if (!name) return fail(400, "Give the key a name.");
    patch.name = name;
  }
  if ("note" in body.data) patch.note = str(body.data.note, 500) ?? null;
  if ("expiresAt" in body.data) {
    const expires = parseExpiry(body.data.expiresAt, true);
    if (!expires.ok) return fail(400, expires.error);
    patch.expiresAt = expires.date;
  }
  if ("revoked" in body.data) {
    if (typeof body.data.revoked !== "boolean") return fail(400, "Revoked must be true or false.");
    patch.revoked = body.data.revoked;
  }
  if ("capabilities" in body.data) {
    const capabilities = parseMcpCapabilities(body.data.capabilities);
    if (!capabilities) return fail(400, "Choose at least one valid access permission.");
    patch.capabilities = capabilities;
  }
  if (!Object.keys(patch).length) return fail(400, "Nothing to change.");
  const updated = await updateApiKey(id, patch);
  if (!updated.ok) return fail(404, updated.error);
  return json({ ok: true, key: updated.key });
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await guardAdmin({ mutating: true, roles: ["owner", "admin"] });
  if (denied) return denied;
  const { id } = await ctx.params;
  const removed = await deleteApiKey(id);
  if (!removed.ok) return fail(404, removed.error);
  return json({ ok: true });
}

function parseExpiry(value: unknown, allowPast: boolean): { ok: true; date: Date | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, date: null };
  if (typeof value !== "string") return { ok: false, error: "Expiry must be a date and time." };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false, error: "Expiry must be a date and time." };
  if (!allowPast && date.getTime() <= Date.now()) return { ok: false, error: "Choose an expiry in the future, or leave it blank." };
  return { ok: true, date };
}
