import {
  createOvenJsonSnapshotStore,
  OVEN_JSON_CACHE_MAX_BYTES,
} from "./oven-json-snapshot.mjs";

const FALLBACK_STORE_KEY = Symbol("oven-json-snapshot-store");

function storeBudget(maxOvenDataBytes) {
  if (!Number.isSafeInteger(maxOvenDataBytes) || maxOvenDataBytes < 1) {
    return OVEN_JSON_CACHE_MAX_BYTES;
  }
  return Math.min(OVEN_JSON_CACHE_MAX_BYTES, maxOvenDataBytes * 2);
}

export function ovenJsonSnapshotStore(ctx) {
  if (ctx.ovenJsonSnapshots) return ctx.ovenJsonSnapshots;
  if (!(ctx.cache instanceof Map)) throw new Error("Oven JSON handler requires a snapshot store or cache map.");
  let store = ctx.cache.get(FALLBACK_STORE_KEY);
  if (!store) {
    const budget = storeBudget(ctx.maxOvenDataBytes);
    store = createOvenJsonSnapshotStore({ maxCacheBytes: budget, maxActiveBytes: budget });
    ctx.cache.set(FALLBACK_STORE_KEY, store);
  }
  return store;
}

export function readOvenJsonSnapshot(ctx, {
  ovenId = ctx.id,
  path = ctx.bindingPath,
  label,
  validate,
  project,
  freshnessKey,
  cache,
  estimateBytes,
}) {
  return ovenJsonSnapshotStore(ctx).read({
    scope: ovenId,
    path,
    label,
    maxSourceBytes: ctx.maxOvenDataBytes,
    validate,
    ...(project === undefined ? {} : { project }),
    ...(freshnessKey === undefined ? {} : { freshnessKey }),
    ...(cache === undefined ? {} : { cache }),
    ...(estimateBytes === undefined ? {} : { estimateBytes }),
  });
}

export function reconcileOvenJsonBindings(ctx, ovenId = ctx.id) {
  if (typeof ctx.ovenDataBindings?.get !== "function") return;
  const paths = (ctx.ovenDataBindings?.get(ovenId) ?? []).map((binding) => binding.path);
  ovenJsonSnapshotStore(ctx).reconcile(paths, ovenId);
}

export function serveOvenJsonSnapshot(ctx, snapshot, envelope) {
  return ovenJsonSnapshotStore(ctx).serve({
    req: ctx.req,
    res: ctx.res,
    snapshot,
    envelope,
    ...(ctx.responseTimeoutMs === undefined ? {} : { timeoutMs: ctx.responseTimeoutMs }),
    ...(ctx.responseTimers === undefined ? {} : { timers: ctx.responseTimers }),
  });
}

export function serializeOvenJsonProjection(ctx, snapshot, payload) {
  return ovenJsonSnapshotStore(ctx).serializeProjection(snapshot, payload);
}

export function createOvenJsonResponse(ctx, snapshot, envelope, options) {
  return ovenJsonSnapshotStore(ctx).response(snapshot, envelope, options);
}

export function serveOvenJsonResponse(ctx, representation) {
  return ovenJsonSnapshotStore(ctx).serveResponse({
    req: ctx.req,
    res: ctx.res,
    representation,
    ...(ctx.responseTimeoutMs === undefined ? {} : { timeoutMs: ctx.responseTimeoutMs }),
    ...(ctx.responseTimers === undefined ? {} : { timers: ctx.responseTimers }),
  });
}
