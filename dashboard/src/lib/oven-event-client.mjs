import {
  createOvenSnapshotCache,
  OVEN_BROWSER_CACHE_MAX_INACTIVE_BYTES,
  OVEN_BROWSER_CACHE_MAX_INACTIVE_ENTRIES,
} from "./oven-snapshot-cache.mjs";
import {
  normalizedEventSelectors,
  optionalSnapshotText,
  ovenSnapshotEventMatches,
  ovenSnapshotKey,
  publicOvenSnapshotState,
} from "./oven-snapshot-contract.mjs";

export { ovenSnapshotKey } from "./oven-snapshot-contract.mjs";
export {
  OVEN_BROWSER_CACHE_MAX_INACTIVE_BYTES,
  OVEN_BROWSER_CACHE_MAX_INACTIVE_ENTRIES,
} from "./oven-snapshot-cache.mjs";

export const OVEN_BROWSER_RECONCILE_MS = 30_000;
export const OVEN_EVENT_COALESCE_MS = 25;

export function ovenBrowserTimers(target = globalThis) {
  return Object.freeze({
    setInterval: target.setInterval.bind(target),
    clearInterval: target.clearInterval.bind(target),
    setTimeout: target.setTimeout.bind(target),
    clearTimeout: target.clearTimeout.bind(target),
  });
}

const defaultTimers = ovenBrowserTimers();

function defaultReceive(response, json, fallbackError) {
  if (!response.ok) throw new Error(json?.error ?? fallbackError);
  return json;
}


export function createOvenSnapshotClient({
  fetchImpl = (...args) => fetch(...args),
  eventSourceFactory = (url) => new EventSource(url),
  focusTarget = typeof window === "undefined" ? null : window,
  reconcileIntervalMs = OVEN_BROWSER_RECONCILE_MS,
  timers = defaultTimers,
  coalesceMs = OVEN_EVENT_COALESCE_MS,
  now = Date.now,
  maxInactiveEntries = OVEN_BROWSER_CACHE_MAX_INACTIVE_ENTRIES,
  maxInactiveBytes = OVEN_BROWSER_CACHE_MAX_INACTIVE_BYTES,
  estimateBytes,
} = {}) {
  if (typeof fetchImpl !== "function" || typeof eventSourceFactory !== "function") {
    throw new Error("Oven snapshot client requires fetch and EventSource factories.");
  }
  if (!Number.isSafeInteger(reconcileIntervalMs) || reconcileIntervalMs < 1) {
    throw new Error("Oven browser reconciliation interval must be positive.");
  }
  if (!Number.isSafeInteger(coalesceMs) || coalesceMs < 0) {
    throw new Error("Oven event coalescing delay must be non-negative.");
  }
  if (typeof now !== "function") throw new Error("Oven snapshot client now must be a function.");

  const snapshotCache = createOvenSnapshotCache({
    maxInactiveEntries,
    maxInactiveBytes,
    ...(estimateBytes === undefined ? {} : { estimateBytes }),
  });
  const pendingKeys = new Set();
  let started = false;
  let lifecycle = 0;
  let eventSource = null;
  let connectPromise = null;
  let reconcileTimer = null;
  let pendingTimer = null;
  let observerError = "";
  let requestGeneration = 0;

  const notify = (entry) => {
    const snapshot = publicOvenSnapshotState(entry);
    for (const listener of entry.listeners) {
      try { listener(snapshot); } catch { /* Snapshot consumers are isolated. */ }
    }
  };

  const cancelRequest = (entry) => {
    entry.requestId += 1;
    entry.abortController?.abort?.();
    entry.abortController = null;
    entry.inFlight = false;
    entry.queued = false;
    entry.loading = false;
    pendingKeys.delete(entry.key);
  };
  const pruneInactive = () => snapshotCache.prune(cancelRequest);

  const refreshEntry = (entry) => {
    if (!started || !entry.listeners.size) return;
    if (entry.inFlight) {
      entry.queued = true;
      return;
    }
    entry.inFlight = true;
    entry.queued = false;
    entry.lastRequestedAt = now();
    entry.generation = ++requestGeneration;
    entry.loading = true;
    entry.stale = entry.hasData;
    entry.outcome = "loading";
    const requestId = ++entry.requestId;
    const requestLifecycle = lifecycle;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    entry.abortController = controller;
    notify(entry);
    const headers = entry.etag ? { "If-None-Match": entry.etag } : undefined;
    void Promise.resolve()
      .then(() => fetchImpl(entry.url, {
        cache: "no-store",
        ...(headers ? { headers } : {}),
        ...(controller ? { signal: controller.signal } : {}),
      }))
      .then(async (response) => {
        if (!started || lifecycle !== requestLifecycle || requestId !== entry.requestId) return;
        const nextEtag = response.headers?.get?.("etag");
        if (response.status === 304) {
          if (!entry.hasData) throw new Error(`${entry.fallbackError} The server returned 304 before an initial snapshot.`);
          if (nextEtag) entry.etag = nextEtag;
          entry.error = "";
          entry.loading = false;
          entry.stale = false;
          entry.outcome = "unchanged";
          snapshotCache.touch(entry);
          notify(entry);
          return;
        }
        const missing = response.status === 404 || response.status === 410;
        const json = await Promise.resolve(response.json()).catch((error) => {
          if (missing) return null;
          throw error;
        });
        if (missing) {
          if (!started || lifecycle !== requestLifecycle || requestId !== entry.requestId) return;
          entry.data = null;
          entry.hasData = false;
          entry.etag = "";
          entry.error = typeof json?.error === "string" ? json.error : entry.fallbackError;
          entry.loading = false;
          entry.stale = false;
          entry.outcome = "missing";
          snapshotCache.update(entry, null, response);
          notify(entry);
          return;
        }
        const data = await (entry.receive ?? defaultReceive)(response, json, entry.fallbackError);
        if (!started || lifecycle !== requestLifecycle || requestId !== entry.requestId) return;
        if (nextEtag) entry.etag = nextEtag;
        entry.data = data;
        entry.hasData = true;
        entry.error = "";
        entry.loading = false;
        entry.stale = false;
        entry.outcome = "accepted";
        snapshotCache.update(entry, data, response);
        notify(entry);
      })
      .catch((cause) => {
        if (!started || lifecycle !== requestLifecycle || requestId !== entry.requestId) return;
        entry.error = cause instanceof Error && cause.message ? cause.message : entry.fallbackError;
        entry.loading = false;
        entry.stale = entry.hasData;
        entry.outcome = "rejected";
        snapshotCache.touch(entry);
        notify(entry);
      })
      .finally(() => {
        if (!started || lifecycle !== requestLifecycle || requestId !== entry.requestId) return;
        entry.abortController = null;
        entry.inFlight = false;
        if (entry.queued) refreshEntry(entry);
        else if (!entry.listeners.size) pruneInactive();
      });
  };

  const flushPending = () => {
    pendingTimer = null;
    const keys = [...pendingKeys];
    pendingKeys.clear();
    for (const key of keys) {
      const entry = snapshotCache.get(key);
      if (entry) refreshEntry(entry);
    }
  };
  const scheduleKeys = (keys) => {
    for (const key of keys) pendingKeys.add(key);
    if (pendingTimer !== null || !pendingKeys.size) return;
    pendingTimer = timers.setTimeout(flushPending, coalesceMs);
    pendingTimer?.unref?.();
  };
  const reconcile = () => {
    scheduleKeys([...snapshotCache.values()].filter((entry) => entry.listeners.size).map((entry) => entry.key));
  };
  const reconcileFallback = () => {
    const currentTime = now();
    scheduleKeys([...snapshotCache.values()]
      .filter((entry) => entry.listeners.size && !entry.inFlight
        && (!entry.hasData || entry.lastRequestedAt === null
          || currentTime - entry.lastRequestedAt >= entry.fallbackMs))
      .map((entry) => entry.key));
  };
  const invalidate = (event) => {
    if (!event) return;
    scheduleKeys([...snapshotCache.values()].filter((entry) => entry.listeners.size && ovenSnapshotEventMatches(entry, event))
      .map((entry) => entry.key));
  };
  const onEvent = (message) => {
    try {
      const event = JSON.parse(message.data);
      invalidate({
        repoKey: typeof event.repoKey === "string" ? event.repoKey : null,
        ovenId: typeof event.ovenId === "string" ? event.ovenId : null,
        subjectId: typeof event.subjectId === "string" ? event.subjectId : null,
        kind: event.kind,
        phase: event.phase,
      });
    } catch {
      // Malformed observational events cannot replace or invalidate canonical state.
    }
  };
  const onReset = (message) => {
    try {
      const reset = JSON.parse(message.data);
      const repoKey = typeof reset.repoKey === "string" ? reset.repoKey : null;
      const resetOvenId = typeof reset.ovenId === "string" ? reset.ovenId : null;
      scheduleKeys([...snapshotCache.values()].filter((entry) => entry.listeners.size
        && (entry.repoKey === null || entry.repoKey === repoKey)
        && (resetOvenId === null || entry.ovenId === resetOvenId)).map((entry) => entry.key));
    } catch {
      // A malformed reset cannot alter canonical state; the slow fallback remains active.
    }
  };

  const connect = () => {
    if (!started || eventSource || connectPromise) return connectPromise;
    const connectLifecycle = lifecycle;
    const task = Promise.resolve()
      .then(() => fetchImpl("/api/events?tail=1", { cache: "no-store" }))
      .then(async (response) => {
        if (!response.ok) throw new Error(`Oven event baseline failed (${response.status})`);
        const baseline = await response.json();
        if (typeof baseline?.cursor !== "string" || !baseline.cursor) throw new Error("Oven event baseline cursor is missing.");
        if (!started || lifecycle !== connectLifecycle) return;
        const source = eventSourceFactory(`/api/events?stream=1&after=${encodeURIComponent(baseline.cursor)}`);
        if (!source || typeof source.addEventListener !== "function" || typeof source.close !== "function") {
          throw new Error("Oven EventSource factory returned an invalid source.");
        }
        eventSource = source;
        source.addEventListener("oven-event", onEvent);
        source.addEventListener("oven-reset", onReset);
        source.onopen = () => {
          observerError = "";
          reconcileFallback();
        };
        source.onerror = () => {
          observerError = "Oven event stream disconnected; canonical fallback remains active.";
        };
      })
      .catch((cause) => {
        observerError = cause instanceof Error ? cause.message : "Could not establish the Oven event baseline.";
      })
      .finally(() => { if (connectPromise === task) connectPromise = null; });
    connectPromise = task;
    return task;
  };

  const onFocus = () => {
    void connect();
    reconcile();
  };
  const stop = () => {
    if (!started) return;
    started = false;
    lifecycle += 1;
    focusTarget?.removeEventListener?.("focus", onFocus);
    if (reconcileTimer !== null) timers.clearInterval(reconcileTimer);
    if (pendingTimer !== null) timers.clearTimeout(pendingTimer);
    reconcileTimer = null;
    pendingTimer = null;
    connectPromise = null;
    pendingKeys.clear();
    if (eventSource) {
      eventSource.removeEventListener?.("oven-event", onEvent);
      eventSource.removeEventListener?.("oven-reset", onReset);
      eventSource.close();
      eventSource = null;
    }
    for (const entry of snapshotCache.values()) cancelRequest(entry);
  };
  const start = () => {
    if (started) return stop;
    started = true;
    lifecycle += 1;
    focusTarget?.addEventListener?.("focus", onFocus);
    reconcileTimer = timers.setInterval(() => {
      void connect();
      reconcileFallback();
    }, reconcileIntervalMs);
    reconcileTimer?.unref?.();
    void connect();
    return stop;
  };

  return Object.freeze({
    start,
    stop,
    reconcile,
    invalidate,
    subscribe(descriptor, listener) {
      if (!descriptor || typeof descriptor !== "object" || typeof descriptor.url !== "string") {
        throw new Error("Oven snapshot subscription requires a URL descriptor.");
      }
      if (typeof listener !== "function") throw new Error("Oven snapshot subscription listener is required.");
      const inferredQuery = descriptor.query ?? descriptor.url.split("?")[1] ?? "";
      const key = ovenSnapshotKey({ ...descriptor, query: inferredQuery });
      const events = normalizedEventSelectors(descriptor);
      const requestedFallbackMs = descriptor.fallbackMs ?? reconcileIntervalMs;
      if (!Number.isSafeInteger(requestedFallbackMs) || requestedFallbackMs < 1) {
        throw new Error("Oven snapshot fallbackMs must be positive.");
      }
      const fallbackMs = Math.max(reconcileIntervalMs, requestedFallbackMs);
      let entry = snapshotCache.get(key);
      if (!entry) {
        entry = {
          key,
          repoKey: optionalSnapshotText(descriptor.repoKey, "Oven snapshot repoKey"),
          ovenId: descriptor.ovenId,
          subjectId: optionalSnapshotText(descriptor.subjectId, "Oven snapshot subjectId"),
          url: descriptor.url,
          receive: descriptor.receive,
          fallbackError: descriptor.fallbackError ?? "Could not load Oven data.",
          listeners: new Set(), data: descriptor.initialData ?? null, error: "", loading: true,
          stale: false, outcome: "initial", generation: 0, requestId: 0, etag: "", inFlight: false, queued: false,
          abortController: null, cacheBytes: 0, lastAccess: 0,
          fallbackMs, lastRequestedAt: null, hasData: descriptor.initialData !== undefined && descriptor.initialData !== null,
          events,
        };
        snapshotCache.set(key, entry);
        snapshotCache.update(entry, entry.data);
      } else if (entry.url !== descriptor.url) {
        throw new Error("One Oven snapshot key cannot address multiple canonical URLs.");
      } else {
        entry.fallbackMs = Math.min(entry.fallbackMs, fallbackMs);
        const identities = new Set(entry.events.map((event) => JSON.stringify(event)));
        for (const event of events) if (!identities.has(JSON.stringify(event))) entry.events.push(event);
      }
      const wasInactive = entry.listeners.size === 0;
      entry.listeners.add(listener);
      snapshotCache.touch(entry);
      listener(publicOvenSnapshotState(entry));
      if (!started) start();
      if (wasInactive && !entry.inFlight) refreshEntry(entry);
      let subscribed = true;
      return Object.freeze({
        key,
        getState: () => publicOvenSnapshotState(entry),
        refresh: () => refreshEntry(entry),
        unsubscribe() {
          if (!subscribed) return;
          subscribed = false;
          entry.listeners.delete(listener);
          snapshotCache.touch(entry);
          if (!entry.listeners.size) {
            if (entry.inFlight) cancelRequest(entry);
            pruneInactive();
          }
        },
      });
    },
    stats: () => {
      const cached = snapshotCache.stats();
      return {
        started,
        eventSources: eventSource ? 1 : 0,
        ...cached,
        activeQueries: [...snapshotCache.values()].filter((entry) => entry.listeners.size).length,
        inFlight: [...snapshotCache.values()].filter((entry) => entry.inFlight).length,
        pending: pendingKeys.size,
        observerError,
      };
    },
  });
}

export const browserOvenSnapshotClient = createOvenSnapshotClient();
