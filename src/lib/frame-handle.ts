import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { sessionSecret } from "./env";
import { looksLikeToken } from "./tokens";

const HANDLE_TTL_MS = 60 * 60 * 1000;
const AAD = Buffer.from("survee-respondent-frame-v1");

function key(): Buffer {
  const secret = sessionSecret();
  if (!secret) throw new Error("SESSION_SECRET is not configured.");
  return createHash("sha256").update("survee:respondent-frame-handle:v1\0").update(secret).digest();
}

/** Create a short-lived, read-only frame handle; the respondent bearer never enters the iframe URL. */
export function createRespondentFrameHandle(token: string, now = Date.now()): string {
  if (!looksLikeToken(token)) throw new Error("Invalid respondent token.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(AAD);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify({ token, expiresAt: now + HANDLE_TTL_MS }), "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

/** Resolve only a valid, unexpired frame handle. The result grants frame HTML access, not answer writes. */
export function resolveRespondentFrameHandle(handle: string, now = Date.now()): string | null {
  try {
    if (!/^[A-Za-z0-9_-]{60,256}$/.test(handle)) return null;
    const bytes = Buffer.from(handle, "base64url");
    if (bytes.length < 29) return null;
    const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
    decipher.setAAD(AAD);
    decipher.setAuthTag(bytes.subarray(12, 28));
    const plaintext = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    const payload = JSON.parse(plaintext) as { token?: unknown; expiresAt?: unknown };
    if (typeof payload.token !== "string" || !looksLikeToken(payload.token)
      || typeof payload.expiresAt !== "number" || !Number.isSafeInteger(payload.expiresAt)
      || payload.expiresAt <= now || payload.expiresAt > now + HANDLE_TTL_MS) return null;
    return payload.token;
  } catch {
    return null;
  }
}
