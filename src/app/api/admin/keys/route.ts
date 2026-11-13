import { fail, guardAdmin, json, readJson, str, adminSession } from "@/lib/http";
import { createApiKey, generateKeySecret, listApiKeys } from "@/lib/repo/keys";

export async function GET() {
  const denied = await guardAdmin();
  if (denied) return denied;
  return json({ ok: true, keys: await listApiKeys() });
}

export async function POST(req: Request) {
  const denied = await guardAdmin({ mutating: true });
  if (denied) return denied;
  const session = await adminSession();
  if (!session) return fail(401, "Sign in to continue.");
  const body = await readJson<{ name?: unknown; note?: unknown; value?: unknown; expiresAt?: unknown }>(req);
  if (!body.ok) return body.res;
  const name = str(body.data.name, 80);
  if (!name) return fail(400, "Give the key a name.");
  const note = str(body.data.note, 500);
  const supplied = typeof body.data.value === "string" ? body.data.value.trim() : "";
  const secret = supplied || generateKeySecret();
  const expires = parseExpiry(body.data.expiresAt);
  if (!expires.ok) return fail(400, expires.error);
  const created = await createApiKey({ name, note, secret, expiresAt: expires.date, createdBy: session.email });
  if (!created.ok) return fail(400, created.error);
  return json({ ok: true, key: created.key, secret: created.secret }, 201);
}

function parseExpiry(value: unknown): { ok: true; date: Date | null } | { ok: false; error: string } {
  if (value == null || value === "") return { ok: true, date: null };
  if (typeof value !== "string") return { ok: false, error: "Expiry must be a date and time." };
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { ok: false, error: "Expiry must be a date and time." };
  if (date.getTime() <= Date.now()) return { ok: false, error: "Choose an expiry in the future, or leave it blank." };
  return { ok: true, date };
}
