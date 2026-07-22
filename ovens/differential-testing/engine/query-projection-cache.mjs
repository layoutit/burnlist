export const DIFFERENTIAL_QUERY_CACHE_MAX_ENTRIES = 16;
export const DIFFERENTIAL_QUERY_CACHE_MAX_BYTES = 64 * 1024 * 1024;

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

export function createDifferentialQueryProjectionCache({
  maxEntries = DIFFERENTIAL_QUERY_CACHE_MAX_ENTRIES,
  maxBytes = DIFFERENTIAL_QUERY_CACHE_MAX_BYTES,
} = {}) {
  nonNegativeInteger(maxEntries, "Differential query cache maxEntries");
  nonNegativeInteger(maxBytes, "Differential query cache maxBytes");
  const entries = new Map();
  let bytes = 0;

  const remove = (key) => {
    const entry = entries.get(key);
    if (!entry) return false;
    entries.delete(key);
    bytes -= entry.bytes;
    return true;
  };
  const enforceLimits = () => {
    while (entries.size > maxEntries || bytes > maxBytes) remove(entries.keys().next().value);
  };

  return Object.freeze({
    get(key) {
      const entry = entries.get(String(key));
      if (!entry) return null;
      entries.delete(String(key));
      entries.set(String(key), entry);
      return entry.value;
    },
    set(key, value, costBytes = value?.responseBytes) {
      const normalizedKey = String(key);
      const cost = nonNegativeInteger(costBytes, "Differential query cache entry bytes");
      remove(normalizedKey);
      if (maxEntries === 0 || cost > maxBytes) return value;
      entries.set(normalizedKey, { value, bytes: cost });
      bytes += cost;
      enforceLimits();
      return value;
    },
    clear() {
      entries.clear();
      bytes = 0;
    },
    stats: () => ({ entries: entries.size, bytes, maxEntries, maxBytes }),
  });
}
