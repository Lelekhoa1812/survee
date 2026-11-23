export interface HostSummaryCacheKey {
  tenantId: string;
  interviewId: string;
  surveyVersion: number;
  respondentRevision: number;
}

interface Entry {
  promise: Promise<unknown>;
  expiresAt: number;
  lastUsedAt: number;
  sizeBytes: number;
}

const CACHE_TTL_MS = 30_000;
const MAX_ENTRIES = 8;
const MAX_TOTAL_BYTES = 512 * 1024;
const MAX_ENTRY_BYTES = 128 * 1024;
const entries = new Map<string, Entry>();

function jsonStringSize(value: string, remaining: number): number | null {
  let bytes = 2;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code === 0x22 || code === 0x5c) bytes += 2;
    else if (code < 0x20) bytes += 6;
    else if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 6;
    } else if (code >= 0xdc00 && code <= 0xdfff) bytes += 6;
    else if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else bytes += 3;
    if (bytes > remaining) return null;
  }
  return bytes;
}

/** Estimate JSON size without serializing a potentially large summary copy. */
function boundedJsonSize(value: unknown, remaining = MAX_ENTRY_BYTES, seen = new WeakSet<object>()): number | null {
  if (value === null) return 4;
  if (typeof value === "string") return jsonStringSize(value, remaining);
  if (typeof value === "boolean") return value ? 4 : 5;
  if (typeof value === "number") return Number.isFinite(value) ? String(value).length : 4;
  if (typeof value !== "object") return null;
  if (seen.has(value)) return null;
  seen.add(value);

  let bytes = 2;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const item = value[index] === undefined || typeof value[index] === "function" || typeof value[index] === "symbol" ? null : value[index];
      const itemBytes = boundedJsonSize(item, remaining - bytes, seen);
      if (itemBytes === null) return null;
      bytes += itemBytes + (index ? 1 : 0);
      if (bytes > remaining) return null;
    }
    return bytes;
  }

  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null;
  let first = true;
  for (const [name, child] of Object.entries(value)) {
    if (child === undefined || typeof child === "function" || typeof child === "symbol") continue;
    const keyBytes = jsonStringSize(name, remaining - bytes);
    const childBytes = boundedJsonSize(child, remaining - bytes, seen);
    if (keyBytes === null || childBytes === null) return null;
    bytes += keyBytes + childBytes + 1 + (first ? 0 : 1);
    first = false;
    if (bytes > remaining) return null;
  }
  return bytes;
}

function evictExpired(now: number): void {
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

function evictToBounds(): void {
  while (entries.size > MAX_ENTRIES || [...entries.values()].reduce((sum, entry) => sum + entry.sizeBytes, 0) > MAX_TOTAL_BYTES) {
    const oldest = [...entries.entries()].sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt)[0];
    if (!oldest) return;
    entries.delete(oldest[0]);
  }
}

/** Reuse only aggregate summaries whose tenant, survey, and respondent revision all match. */
export function getCachedHostSummary<T>(key: HostSummaryCacheKey, compute: () => Promise<T>): Promise<T> {
  const cacheKey = JSON.stringify([key.tenantId, key.interviewId, key.surveyVersion, key.respondentRevision]);
  const now = Date.now();
  evictExpired(now);
  const hit = entries.get(cacheKey);
  if (hit) {
    hit.lastUsedAt = now;
    return hit.promise as Promise<T>;
  }

  const entry: Entry = { promise: Promise.resolve(undefined), expiresAt: now + CACHE_TTL_MS, lastUsedAt: now, sizeBytes: 0 };
  entry.promise = Promise.resolve().then(compute).then((value) => {
    let sizeBytes: number | null;
    try {
      sizeBytes = boundedJsonSize(value);
    } catch {
      sizeBytes = null;
    }
    if (entries.get(cacheKey) === entry && sizeBytes !== null && sizeBytes <= MAX_ENTRY_BYTES) {
      entry.sizeBytes = sizeBytes;
      entry.expiresAt = Date.now() + CACHE_TTL_MS;
      evictToBounds();
    } else if (entries.get(cacheKey) === entry) {
      entries.delete(cacheKey);
    }
    return value;
  }).catch((error: unknown) => {
    if (entries.get(cacheKey) === entry) entries.delete(cacheKey);
    throw error;
  });
  entries.set(cacheKey, entry);
  evictToBounds();
  return entry.promise as Promise<T>;
}
