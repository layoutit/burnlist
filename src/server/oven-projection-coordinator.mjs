import {
  OVEN_DATA_PUBLISHED_KIND,
  OVEN_DATA_PUBLISHED_PHASE,
} from "../events/oven-data-events.mjs";
import {
  OVEN_BINDING_CHANGED_KIND,
  OVEN_CANONICAL_MUTATION_PHASE,
  OVEN_DEFINITION_CHANGED_KIND,
} from "../events/oven-canonical-mutations.mjs";

export const OVEN_RECONCILE_INTERVAL_MS = 30_000;

export function createOvenProjectionCoordinator({
  observer,
  snapshotStore,
  handlers,
  resolveBindings,
  createContext,
  reconcileIntervalMs = OVEN_RECONCILE_INTERVAL_MS,
  timers = { setInterval, clearInterval },
} = {}) {
  if (!observer || typeof observer.observe !== "function") throw new Error("Oven projection coordinator requires an event observer.");
  if (!snapshotStore || typeof snapshotStore.invalidate !== "function") throw new Error("Oven projection coordinator requires a snapshot store.");
  if (!Array.isArray(handlers)) throw new Error("Oven projection coordinator handlers must be an array.");
  if (typeof resolveBindings !== "function" || typeof createContext !== "function") {
    throw new Error("Oven projection coordinator requires binding and context resolvers.");
  }
  if (!Number.isSafeInteger(reconcileIntervalMs) || reconcileIntervalMs < 1) {
    throw new Error("Oven projection reconciliation interval must be positive.");
  }
  const handlersById = new Map(handlers.map((handler) => [handler.id, handler]));
  const knownOvenIds = new Set();
  const pending = new Map();
  let stopped = false;

  const safeBindings = () => {
    const bindings = resolveBindings();
    if (!(bindings instanceof Map)) throw new Error("Oven projection bindings must be a Map.");
    return bindings;
  };
  const reconcile = () => {
    if (stopped) return;
    try {
      const bindings = safeBindings();
      for (const ovenId of bindings.keys()) knownOvenIds.add(ovenId);
      for (const ovenId of knownOvenIds) {
        const paths = (bindings.get(ovenId) ?? []).map((binding) => binding.path);
        snapshotStore.reconcile(paths, ovenId);
      }
      for (const handler of handlers) {
        const context = createContext(handler, bindings);
        try { handler.reconcileDataBindings?.(context); } catch { /* Request paths report failures. */ }
      }
    } catch {
      // Reconciliation is observational and retries on the next shared tick.
    }
  };
  const flush = () => {
    if (stopped || !pending.size) return;
    const batch = new Map(pending);
    pending.clear();
    let bindings;
    try { bindings = safeBindings(); } catch { return; }
    for (const [ovenId, repoKeys] of batch) {
      const candidates = bindings.get(ovenId) ?? [];
      const targets = new Set();
      for (const repoKey of repoKeys) {
        const exact = candidates.filter((binding) => binding.repoKey === repoKey);
        for (const binding of exact.length ? exact : candidates.filter((binding) => binding.repoKey === null)) {
          targets.add(binding.path);
        }
      }
      if (!targets.size) continue;
      for (const path of targets) snapshotStore.invalidate(path, ovenId);
      const handler = handlersById.get(ovenId);
      if (handler) createContext(handler, bindings).cache?.clear?.();
    }
  };
  const stopObserving = observer.observe({
    onDelivery(event) {
      const invalidatesProjection = (
        event.phase === OVEN_DATA_PUBLISHED_PHASE
        && event.kind === OVEN_DATA_PUBLISHED_KIND
      ) || (
        event.phase === OVEN_CANONICAL_MUTATION_PHASE
        && [OVEN_BINDING_CHANGED_KIND, OVEN_DEFINITION_CHANGED_KIND].includes(event.kind)
      );
      if (!invalidatesProjection) return;
      const repoKeys = pending.get(event.ovenId) ?? new Set();
      repoKeys.add(event.repoKey);
      pending.set(event.ovenId, repoKeys);
    },
    onReset() { reconcile(); },
    onScanComplete: flush,
  });
  reconcile();
  const timer = timers.setInterval(reconcile, reconcileIntervalMs);
  timer?.unref?.();

  return Object.freeze({
    flush,
    reconcile,
    stop() {
      if (stopped) return;
      stopped = true;
      pending.clear();
      stopObserving();
      timers.clearInterval(timer);
    },
    stats: () => ({ pendingOvens: pending.size, knownOvens: knownOvenIds.size, stopped }),
  });
}
