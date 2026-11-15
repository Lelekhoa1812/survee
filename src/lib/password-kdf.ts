import { scrypt } from "node:crypto";

export const PASSWORD_HASH_BYTES = 64;
export const PASSWORD_HASH_COST = 16_384;

/** One cost-bounded scrypt derivation for account password hashing and verification. */
export function derivePasswordKey(password: string, salt: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, PASSWORD_HASH_BYTES, { N: PASSWORD_HASH_COST, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => {
      if (error) reject(error);
      else resolve(key as Buffer);
    });
  });
}
