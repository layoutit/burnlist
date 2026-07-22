export const OVEN_BROWSER_CACHE_MAX_INACTIVE_ENTRIES = 16;
export const OVEN_BROWSER_CACHE_MAX_INACTIVE_BYTES = 64 * 1024 * 1024;

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

export function estimateOvenSnapshotBytes(value, response) {
  const header = response?.headers?.get?.("content-length");
  if (typeof header === "string" && /^(?:0|[1-9]\d*)$/u.test(header)) {
    const bytes = Number(header);
    if (Number.isSafeInteger(bytes)) return bytes;
  }
  if (value === undefined || value === null) return 0;
  try {
    const json = JSON.stringify(value);
    return typeof json === "string" ? json.length * 2 : 0;
  } catch {
    return 0;
  }
}

export function createOvenSnapshotCache({
  maxInactiveEntries = OVEN_BROWSER_CACHE_MAX_INACTIVE_ENTRIES,
  maxInactiveBytes = OVEN_BROWSER_CACHE_MAX_INACTIVE_BYTES,
  estimateBytes = estimateOvenSnapshotBytes,
} = {}) {
  nonNegativeInteger(maxInactiveEntries, "Oven browser cache maxInactiveEntries");
  nonNegativeInteger(maxInactiveBytes, "Oven browser cache maxInactiveBytes");
  if (typeof estimateBytes !== "function") throw new Error("Oven browser cache estimateBytes must be a function.");
  const entries = new Map();
  let access = 0;

  const touch = (entry) => { entry.lastAccess = ++access; };
  const inactive = () => [...entries.values()].filter((entry) => entry.listeners.size === 0);
  const prune = (onEvict = () => {}) => {
    const candidates = inactive().sort((left, right) => left.lastAccess - right.lastAccess);
    let bytes = candidates.reduce((total, entry) => total + entry.cacheBytes, 0);
    while (candidates.length > maxInactiveEntries || bytes > maxInactiveBytes) {
      const entry = candidates.shift();
      if (!entry) break;
      bytes -= entry.cacheBytes;
      entries.delete(entry.key);
      onEvict(entry);
    }
  };

  return Object.freeze({
    get: (key) => entries.get(key),
    set(key, entry) { entries.set(key, entry); touch(entry); return entry; },
    values: () => entries.values(),
    touch,
    update(entry, value, response) {
      entry.cacheBytes = nonNegativeInteger(estimateBytes(value, response), "Oven browser cache entry bytes");
      touch(entry);
    },
    prune,
    stats() {
      const cached = inactive();
      return {
        queries: entries.size,
        inactiveQueries: cached.length,
        inactiveBytes: cached.reduce((total, entry) => total + entry.cacheBytes, 0),
        maxInactiveEntries,
        maxInactiveBytes,
      };
    },
  });
}
