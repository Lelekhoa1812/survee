import { randomBytes } from "node:crypto";

/** 144 bits of randomness, 24 URL-safe characters. Unguessable, so the link itself is the credential. */
export function newToken(): string {
  return randomBytes(18).toString("base64url");
}

/** Cheap shape check so junk paths never reach the database. */
export function looksLikeToken(s: string): boolean {
  return /^[A-Za-z0-9_-]{22,32}$/.test(s);
}
