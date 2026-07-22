import { createHash } from "node:crypto";
import { lstatSync } from "node:fs";
import { readTextFileWithIdentity } from "./fs-safe.mjs";
import { streamOvenResponse } from "./oven-response-stream.mjs";

export const OVEN_JSON_CACHE_MAX_ENTRIES = 8;
export const OVEN_JSON_CACHE_MAX_BYTES = 128 * 1024 * 1024;
export const OVEN_JSON_ACTIVE_MAX_RESPONSES = 8;
export const OVEN_JSON_READ_ATTEMPTS = 3;

function safeLstat(path) {
  try { return lstatSync(path); } catch { return null; }
}

function signature(path, identity) {
  return [path, identity.dev, identity.ino, identity.size, identity.mtimeMs, identity.ctimeMs].join("\0");
}

function entryKey(scope, path) {
  return `${scope}\0${path}`;
}

function fileVersion(path, statPath) {
  const stat = statPath(path);
  if (!stat?.isFile() || stat.isSymbolicLink?.()) return null;
  return { stat, signature: signature(path, stat) };
}

function positiveInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive integer.`);
  return value;
}

function nonNegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
  return value;
}

function responseEtag(value) {
  if (value === undefined) return null;
  if (typeof value !== "string" || !/^(?:W\/)?"[^"\r\n]*"$/u.test(value)) {
    throw new Error("Oven JSON response ETag must be a quoted strong or weak validator.");
  }
  return value;
}

export function readStableJsonSource(path, maxBytes, label, {
  attempts = OVEN_JSON_READ_ATTEMPTS,
  readSource = readTextFileWithIdentity,
  statPath = safeLstat,
} = {}) {
  positiveInteger(attempts, "Oven JSON read attempts");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const before = fileVersion(path, statPath);
    if (!before) throw Object.assign(new Error(`${label} is missing`), { status: 404 });
    try {
      const { text, identity } = readSource(path, maxBytes, label);
      const after = fileVersion(path, statPath);
      if (after?.signature === signature(path, identity)) return { text, ...after };
    } catch (error) {
      const after = fileVersion(path, statPath);
      if (error?.code !== "ESTALE" && after?.signature === before.signature) throw error;
    }
  }
  throw Object.assign(new Error(`${label} changed while it was read`), { code: "ESTALE" });
}

export function ifNoneMatchMatches(value, currentEtag) {
  const header = Array.isArray(value) ? value.join(",") : String(value ?? "");
  if (header.trim() === "*") return true;
  const currentOpaque = currentEtag.replace(/^W\//u, "");
  return header.split(",").some((part) => {
    const candidate = part.trim().replace(/^W\//u, "");
    return /^"[^"\r\n]*"$/u.test(candidate) && candidate === currentOpaque;
  });
}

export function createOvenJsonSnapshotStore({
  maxEntries = OVEN_JSON_CACHE_MAX_ENTRIES,
  maxCacheBytes = OVEN_JSON_CACHE_MAX_BYTES,
  maxActiveResponses = OVEN_JSON_ACTIVE_MAX_RESPONSES,
  maxActiveBytes = OVEN_JSON_CACHE_MAX_BYTES,
  readAttempts = OVEN_JSON_READ_ATTEMPTS,
  readSource = readTextFileWithIdentity,
  statPath = safeLstat,
} = {}) {
  positiveInteger(maxEntries, "Oven JSON cache maxEntries");
  nonNegativeInteger(maxCacheBytes, "Oven JSON cache maxCacheBytes");
  positiveInteger(maxActiveResponses, "Oven JSON active response limit");
  nonNegativeInteger(maxActiveBytes, "Oven JSON active byte limit");
  positiveInteger(readAttempts, "Oven JSON read attempts");
  const entries = new Map();
  let cacheBytes = 0;
  let activeResponses = 0;
  let activeBytes = 0;

  const removeKey = (key) => {
    const cached = entries.get(key);
    if (!cached) return false;
    entries.delete(key);
    cacheBytes -= cached.costBytes;
    return true;
  };
  const remove = (path, scope) => {
    if (scope !== undefined) return removeKey(entryKey(String(scope), path));
    let removed = false;
    for (const [key, cached] of entries) {
      if (cached.path === path) removed = removeKey(key) || removed;
    }
    return removed;
  };
  const enforceLimits = () => {
    while (entries.size > maxEntries || cacheBytes > maxCacheBytes) removeKey(entries.keys().next().value);
  };
  const reserve = (bytes) => {
    if (activeResponses >= maxActiveResponses || activeBytes + bytes > maxActiveBytes) return null;
    activeResponses += 1;
    activeBytes += bytes;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeResponses -= 1;
      activeBytes -= bytes;
    };
  };

  const read = ({
    path,
    label,
    maxSourceBytes,
    validate,
    project,
    freshnessKey = "",
    scope = "",
    cache = true,
    estimateBytes = (sourceBytes) => sourceBytes * 3,
  }) => {
    if (typeof validate !== "function") throw new Error("Oven JSON snapshot validate must be a function.");
    if (project !== undefined && typeof project !== "function") throw new Error("Oven JSON snapshot project must be a function.");
    if (typeof estimateBytes !== "function") throw new Error("Oven JSON snapshot estimateBytes must be a function.");
    nonNegativeInteger(maxSourceBytes, "Oven JSON source byte limit");
    const normalizedScope = String(scope);
    const keyForEntry = entryKey(normalizedScope, path);
    const observed = fileVersion(path, statPath);
    if (!observed) {
      removeKey(keyForEntry);
      throw Object.assign(new Error(`${label} is missing`), { status: 404 });
    }
    const key = String(freshnessKey);
    const cached = entries.get(keyForEntry);
    if (cache && cached?.signature === observed.signature && cached.freshnessKey === key) {
      const confirmed = fileVersion(path, statPath);
      if (confirmed?.signature === observed.signature) {
        entries.delete(keyForEntry);
        entries.set(keyForEntry, cached);
        return cached;
      }
    }
    removeKey(keyForEntry);
    const stable = readStableJsonSource(path, maxSourceBytes, label, {
      attempts: readAttempts,
      readSource,
      statPath,
    });
    let payload;
    try { payload = JSON.parse(stable.text); }
    catch (error) { throw new SyntaxError(error.message, { cause: error }); }
    const source = Buffer.from(stable.text);
    const sourceBytes = source.length;
    const sourceDigest = createHash("sha256").update(source).digest("hex");
    const context = {
      path,
      stat: stable.stat,
      signature: stable.signature,
      freshnessKey: key,
      source,
      sourceBytes,
      sourceDigest,
    };
    validate(payload, context);
    const costBytes = Math.max(sourceBytes, nonNegativeInteger(estimateBytes(sourceBytes, payload), "Oven JSON cache cost"));
    const snapshot = {
      path,
      scope: normalizedScope,
      signature: stable.signature,
      freshnessKey: key,
      stat: stable.stat,
      source,
      sourceBytes,
      sourceDigest,
      payload,
      projection: project?.(payload, context) ?? null,
      costBytes,
    };
    if (cache && costBytes <= maxCacheBytes) {
      entries.set(keyForEntry, snapshot);
      cacheBytes += costBytes;
      enforceLimits();
    }
    return snapshot;
  };

  const serializeProjection = (snapshot, payload) => {
    if (!snapshot || typeof snapshot !== "object" || !Buffer.isBuffer(snapshot.source)
      || typeof snapshot.sourceDigest !== "string" || typeof snapshot.signature !== "string") {
      throw new Error("Oven JSON projection requires a canonical snapshot.");
    }
    const serialized = JSON.stringify(payload);
    if (serialized === undefined) throw new Error("Oven JSON projection must be serializable.");
    const source = Buffer.from(serialized);
    const sourceDigest = createHash("sha256").update(source).digest("hex");
    return Object.freeze({
      path: snapshot.path,
      scope: snapshot.scope,
      signature: `${snapshot.signature}\0projection:${sourceDigest}`,
      freshnessKey: snapshot.freshnessKey,
      source,
      sourceBytes: source.length,
      sourceDigest,
      canonicalSourceDigest: snapshot.sourceDigest,
      costBytes: source.length,
    });
  };

  const response = (snapshot, envelope, { etag } = {}) => {
    if (!snapshot || typeof snapshot !== "object" || !Buffer.isBuffer(snapshot.source)
      || snapshot.sourceBytes !== snapshot.source.length || typeof snapshot.sourceDigest !== "string") {
      throw new Error("Oven JSON response requires a canonical snapshot or serialized projection.");
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) || "payload" in envelope) {
      throw new Error("Oven JSON response envelope must be an object without payload.");
    }
    const serializedEnvelope = JSON.stringify(envelope);
    if (!serializedEnvelope?.endsWith("}")) throw new Error("Oven JSON response envelope must be serializable.");
    const prefix = Buffer.from(`${serializedEnvelope.slice(0, -1)},"payload":`);
    const suffix = Buffer.from("}");
    const responseBytes = prefix.length + snapshot.sourceBytes + suffix.length;
    const digest = createHash("sha256")
      .update(prefix).update("\0").update(snapshot.sourceDigest).update("\0").update(suffix)
      .digest("hex");
    return Object.freeze({
      prefix,
      source: snapshot.source,
      suffix,
      responseBytes,
      etag: responseEtag(etag) ?? `W/"oven-json-${digest}"`,
    });
  };

  const serveResponse = ({ req, res, representation, timeoutMs, timers, chunkBytes }) => {
    if (!representation || !Buffer.isBuffer(representation.prefix)
      || !Buffer.isBuffer(representation.source) || !Buffer.isBuffer(representation.suffix)
      || representation.responseBytes !== representation.prefix.length
        + representation.source.length + representation.suffix.length
      || responseEtag(representation.etag) === null) {
      throw new Error("Oven JSON response representation is invalid.");
    }
    if (ifNoneMatchMatches(req.headers["if-none-match"], representation.etag)) {
      res.writeHead(304, { etag: representation.etag, "cache-control": "no-store" });
      res.end();
      return { status: 304, etag: representation.etag };
    }
    const release = reserve(representation.responseBytes);
    if (!release) {
      res.writeHead(503, { "cache-control": "no-store", "retry-after": "1" });
      res.end();
      return { status: 503, etag: representation.etag };
    }
    res.writeHead(200, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      etag: representation.etag,
      "content-length": representation.responseBytes,
    });
    streamOvenResponse(req, res, [representation.prefix, representation.source, representation.suffix], {
      onCleanup: release,
      ...(timeoutMs === undefined ? {} : { timeoutMs }),
      ...(timers === undefined ? {} : { timers }),
      ...(chunkBytes === undefined ? {} : { chunkBytes }),
    });
    return { status: 200, etag: representation.etag };
  };

  const serve = ({ req, res, snapshot, envelope, etag, timeoutMs, timers, chunkBytes }) => serveResponse({
    req,
    res,
    representation: response(snapshot, envelope, { ...(etag === undefined ? {} : { etag }) }),
    ...(timeoutMs === undefined ? {} : { timeoutMs }),
    ...(timers === undefined ? {} : { timers }),
    ...(chunkBytes === undefined ? {} : { chunkBytes }),
  });

  return Object.freeze({
    read,
    serializeProjection,
    response,
    serve,
    serveResponse,
    invalidate: remove,
    reconcile(activePaths, scope) {
      const active = new Set(activePaths);
      const normalizedScope = scope === undefined ? undefined : String(scope);
      for (const [key, cached] of entries) {
        if (normalizedScope !== undefined && cached.scope !== normalizedScope) continue;
        const observed = active.has(cached.path) ? fileVersion(cached.path, statPath) : null;
        if (observed?.signature !== cached.signature) removeKey(key);
      }
      enforceLimits();
    },
    clear() { for (const key of [...entries.keys()]) removeKey(key); },
    stats: () => ({ entries: entries.size, cacheBytes, activeResponses, activeBytes }),
  });
}
