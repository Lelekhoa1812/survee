const MAX_AGE_MS = 6 * 24 * 60 * 60 * 1000;
const STORAGE_PREFIX = "survee:idempotency:";

type SavedOperation = { operationId: string; fingerprint: string; createdAt: number };
const memoryOperations = new Map<string, SavedOperation>();

/** Reuse an in-flight operation key after a timeout, reload, or other lost response. */
export async function clientOperationId(scope: string, payload: unknown): Promise<{ operationId: string; fingerprint: string }> {
  const fingerprint = await sha256(JSON.stringify(payload));
  const storageKey = `${STORAGE_PREFIX}${scope}:${fingerprint}`;
  const now = Date.now();
  for (const [key, saved] of memoryOperations) {
    if (now - saved.createdAt >= MAX_AGE_MS || now < saved.createdAt) memoryOperations.delete(key);
  }
  try {
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "null") as Partial<SavedOperation> | null;
        if (!saved || typeof saved.createdAt !== "number" || now - saved.createdAt >= MAX_AGE_MS || now < saved.createdAt) localStorage.removeItem(key);
      } catch { localStorage.removeItem(key); }
    }
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<SavedOperation>;
      if (saved.fingerprint === fingerprint && typeof saved.operationId === "string" && typeof saved.createdAt === "number"
        && now - saved.createdAt >= 0 && now - saved.createdAt < MAX_AGE_MS) {
        memoryOperations.set(storageKey, saved as SavedOperation);
        return { operationId: saved.operationId, fingerprint };
      }
    }
  } catch {
    // Fall back to memory when browser storage is disabled.
  }
  const saved = memoryOperations.get(storageKey);
  if (saved && now - saved.createdAt >= 0 && now - saved.createdAt < MAX_AGE_MS) return { operationId: saved.operationId, fingerprint };
  const operationId = crypto.randomUUID();
  const operation: SavedOperation = { operationId, fingerprint, createdAt: now };
  memoryOperations.set(storageKey, operation);
  try { localStorage.setItem(storageKey, JSON.stringify(operation)); } catch { /* storage is optional */ }
  return { operationId, fingerprint };
}

export function clearClientOperationId(scope: string, fingerprint: string): void {
  const storageKey = `${STORAGE_PREFIX}${scope}:${fingerprint}`;
  memoryOperations.delete(storageKey);
  try { localStorage.removeItem(storageKey); } catch { /* storage is optional */ }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
