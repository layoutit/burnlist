import {
  readAllOvenEventDeliveries,
} from "./oven-event-deliveries.mjs";
import {
  discoverOvenEventStreamPages,
  OVEN_EVENT_MAX_READ_EVENTS,
  OVEN_EVENT_MAX_READ_STREAMS,
  readOvenEventTail,
} from "./oven-event-store.mjs";

export const OVEN_EVENT_OBSERVER_SCAN_MS = 500;
export const OVEN_EVENT_OBSERVER_MAX_SUBSCRIBERS = 32;

function observerError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function warning(repoKey, error) {
  return { repoKey, code: error?.code ?? "EOBSERVER", error: error?.message ?? String(error) };
}

function appendTail(repos, ovenIds, { internal }) {
  const watermarks = {};
  const warnings = [];
  const streamKeys = [];
  let streamCount = 0;
  let complete = true;
  for (const repo of repos) {
    try {
      const pages = internal
        ? discoverOvenEventStreamPages(repo.root)
        : [ovenIds];
      for (const page of pages) {
        const sequences = readOvenEventTail(repo.root, {
          ovenIds: internal ? page : ovenIds,
          onInvalid(error) { warnings.push(warning(repo.repoKey, error)); },
        });
        streamCount += Object.keys(sequences).length;
        if (!internal && streamCount > OVEN_EVENT_MAX_READ_STREAMS) {
          throw observerError(`The event feed spans more than ${OVEN_EVENT_MAX_READ_STREAMS} streams.`, 413);
        }
        for (const [id, sequence] of Object.entries(sequences)) {
          const key = `${repo.repoKey}/${id}`;
          watermarks[key] = sequence;
          streamKeys.push(key);
        }
      }
    } catch (error) {
      if (!internal && (error?.status === 413 || error?.code === "ESTREAMLIMIT")) throw error;
      warnings.push(warning(repo.repoKey, error));
      complete = false;
    }
  }
  return { watermarks, warnings, streamKeys: streamKeys.sort(), complete };
}

export function readOvenEventTailWatermarks(repos, { ovenIds = [] } = {}) {
  return appendTail(repos, ovenIds, { internal: false });
}

export function readAllOvenEventTailWatermarks(repos) {
  return appendTail(repos, [], { internal: true });
}

function selectionSets(selection) {
  return {
    repoKeys: new Set(selection.repos.map((repo) => repo.repoKey)),
    ovenIds: new Set(selection.ovenIds),
  };
}

function splitKey(key) {
  const slash = key.indexOf("/");
  return { repoKey: key.slice(0, slash), ovenId: key.slice(slash + 1) };
}

function interested(target, key) {
  const { repoKey, ovenId } = splitKey(key);
  return target.repoKeys.has(repoKey) && (!target.ovenIds.size || target.ovenIds.has(ovenId));
}

function scopedKnownWatermarks(watermarks, knownKeys, subscriber) {
  const scoped = {};
  for (const key of knownKeys) {
    if (interested(subscriber, key)) scoped[key] = watermarks[key] ?? 0;
  }
  return scoped;
}

function resetKey(item) {
  return `${item.repoKey}/${item.ovenId}`;
}

function resetWatermark(item) {
  return Math.min(Math.max(0, (item.baseSequence ?? 1) - 1), item.committedSequence ?? 0);
}

function missingReset(key, sequence) {
  const { repoKey, ovenId } = splitKey(key);
  return {
    repoKey,
    ovenId,
    code: "EREPLAYRESET",
    reason: "stream-missing",
    requestedSequence: sequence,
    baseSequence: 1,
    committedSequence: 0,
  };
}

export function createOvenEventObserver({
  resolveRepos,
  readDeliveries,
  readLiveDeliveries,
  readSubscriberDeliveries,
  readTail,
  readLiveTail,
  scanIntervalMs = OVEN_EVENT_OBSERVER_SCAN_MS,
  batchLimit = OVEN_EVENT_MAX_READ_EVENTS,
  maxSubscribers = OVEN_EVENT_OBSERVER_MAX_SUBSCRIBERS,
  timers = { setInterval, clearInterval },
  now = Date.now,
} = {}) {
  if (typeof resolveRepos !== "function") throw new Error("Oven event observer resolveRepos must be a function.");
  const liveReader = readLiveDeliveries ?? readDeliveries ?? readAllOvenEventDeliveries;
  const subscriberReader = readSubscriberDeliveries ?? readDeliveries ?? readAllOvenEventDeliveries;
  const baselineReader = readTail ?? readOvenEventTailWatermarks;
  const liveTailReader = readLiveTail ?? readTail ?? readAllOvenEventTailWatermarks;
  for (const [label, value] of [
    ["live delivery", liveReader], ["subscriber delivery", subscriberReader],
    ["baseline", baselineReader], ["live tail", liveTailReader],
  ]) {
    if (typeof value !== "function") throw new Error(`Oven event observer ${label} reader must be a function.`);
  }
  if (!Number.isSafeInteger(scanIntervalMs) || scanIntervalMs < 1) throw new Error("Oven event observer scanIntervalMs must be positive.");
  if (!Number.isSafeInteger(batchLimit) || batchLimit < 1 || batchLimit > OVEN_EVENT_MAX_READ_EVENTS) {
    throw new Error(`Oven event observer batchLimit must be from 1 to ${OVEN_EVENT_MAX_READ_EVENTS}.`);
  }
  if (!Number.isSafeInteger(maxSubscribers) || maxSubscribers < 1
      || maxSubscribers > OVEN_EVENT_OBSERVER_MAX_SUBSCRIBERS) {
    throw new Error(`Oven event observer maxSubscribers must be from 1 to ${OVEN_EVENT_OBSERVER_MAX_SUBSCRIBERS}.`);
  }

  const subscribers = new Set();
  const listeners = new Set();
  const observerWatermarks = {};
  let initialized = false;
  let scanning = false;
  let scanTimer = null;
  let scanCount = 0;

  const initialize = () => {
    if (initialized) return;
    const baseline = liveTailReader(resolveRepos(), { ovenIds: [] });
    Object.assign(observerWatermarks, baseline.watermarks);
    initialized = true;
  };
  const maybeStop = () => {
    if (subscribers.size || listeners.size || scanTimer === null) return;
    timers.clearInterval(scanTimer);
    scanTimer = null;
  };
  const ensureTimer = () => {
    if (scanTimer !== null) return;
    scanTimer = timers.setInterval(scan, scanIntervalMs);
    scanTimer?.unref?.();
  };
  const removeSubscriber = (subscriber, notify = false) => {
    if (!subscribers.delete(subscriber)) return;
    if (notify) subscriber.onClose?.();
    maybeStop();
  };
  const deliverWarning = (item) => {
    for (const listener of listeners) {
      try { listener.onWarning?.(item); } catch { /* Observers are isolated. */ }
    }
    for (const subscriber of [...subscribers]) {
      if (item.repoKey && !subscriber.repoKeys.has(item.repoKey)) continue;
      const signature = JSON.stringify(item);
      if (subscriber.warnings.has(signature)) continue;
      subscriber.warnings.add(signature);
      let accepted = true;
      try { accepted = subscriber.onWarning?.(item) !== false; } catch { accepted = false; }
      if (!accepted) removeSubscriber(subscriber, true);
    }
  };
  const notifyLiveReset = (item) => {
    const key = resetKey(item);
    if (item.reason === "stream-missing") delete observerWatermarks[key];
    else observerWatermarks[key] = resetWatermark(item);
    for (const listener of listeners) {
      try { listener.onReset?.(item, { ...observerWatermarks }); } catch { /* Observers are isolated. */ }
    }
  };
  const notifySubscriberReset = (subscriber, item) => {
    const key = resetKey(item);
    if (!interested(subscriber, key)) return;
    const signature = JSON.stringify(item);
    if (subscriber.resets.has(signature)) return;
    subscriber.resets.add(signature);
    if (item.reason === "stream-missing") delete subscriber.watermarks[key];
    else subscriber.watermarks[key] = resetWatermark(item);
    let accepted = true;
    try { accepted = subscriber.onReset?.(item, { ...subscriber.watermarks }) !== false; }
    catch { accepted = false; }
    if (!accepted) removeSubscriber(subscriber, true);
  };
  const reconcileLiveKeys = (batch) => {
    const current = new Set(batch.streamKeys ?? []);
    if (batch.complete !== false) {
      for (const key of Object.keys(observerWatermarks)) {
        if (!current.has(key)) notifyLiveReset(missingReset(key, observerWatermarks[key]));
      }
    }
    for (const key of current) {
      if (observerWatermarks[key] === undefined) observerWatermarks[key] = batch.startWatermarks?.[key] ?? 0;
    }
    for (const item of batch.resets ?? []) notifyLiveReset(item);
  };
  const deliverLive = (item) => {
    const key = `${item.repoKey}/${item.ovenId}`;
    if (item.sequence <= (observerWatermarks[key] ?? 0)) return;
    observerWatermarks[key] = item.sequence;
    for (const listener of listeners) {
      try { listener.onDelivery?.(item, { ...observerWatermarks }); } catch { /* Observers are isolated. */ }
    }
  };
  const subscriberMinimums = () => {
    const result = { ...observerWatermarks };
    const keys = new Set([
      ...Object.keys(observerWatermarks),
      ...[...subscribers].flatMap((subscriber) => Object.keys(subscriber.watermarks)),
    ]);
    for (const key of keys) {
      let minimum;
      for (const subscriber of subscribers) {
        if (!interested(subscriber, key)) continue;
        minimum = Math.min(minimum ?? Number.MAX_SAFE_INTEGER, subscriber.watermarks[key] ?? 0);
      }
      if (minimum !== undefined) result[key] = minimum;
    }
    return result;
  };
  const deliverSubscribers = (repos) => {
    if (!subscribers.size) return;
    const batch = subscriberReader(repos, { watermarks: subscriberMinimums(), limit: batchLimit });
    for (const item of batch.warnings ?? []) deliverWarning(item);
    for (const item of batch.resets ?? []) {
      for (const subscriber of [...subscribers]) notifySubscriberReset(subscriber, item);
    }
    if (batch.complete !== false) {
      const current = new Set(batch.streamKeys ?? []);
      for (const subscriber of [...subscribers]) {
        for (const [key, sequence] of Object.entries(subscriber.watermarks)) {
          if (interested(subscriber, key) && !current.has(key)) notifySubscriberReset(subscriber, missingReset(key, sequence));
        }
      }
    }
    const counts = new Map();
    for (const item of (batch.deliveries ?? []).slice(0, batchLimit)) {
      const key = `${item.repoKey}/${item.ovenId}`;
      deliverLive(item);
      for (const subscriber of [...subscribers]) {
        if (!interested(subscriber, key) || item.sequence <= (subscriber.watermarks[key] ?? 0)) continue;
        const count = counts.get(subscriber) ?? 0;
        if (count >= subscriber.limit) continue;
        subscriber.watermarks[key] = item.sequence;
        counts.set(subscriber, count + 1);
        let accepted = true;
        try { accepted = subscriber.onDelivery(item, { ...subscriber.watermarks }) !== false; }
        catch { accepted = false; }
        if (!accepted) removeSubscriber(subscriber, true);
      }
    }
  };

  function scan() {
    if (scanning || (!subscribers.size && !listeners.size)) return;
    scanning = true;
    scanCount += 1;
    try {
      const repos = resolveRepos();
      if (listeners.size) {
        const batch = liveReader(repos, { watermarks: { ...observerWatermarks }, limit: batchLimit });
        reconcileLiveKeys(batch);
        for (const item of batch.warnings ?? []) deliverWarning(item);
        for (const item of (batch.deliveries ?? []).slice(0, batchLimit)) deliverLive(item);
      }
      deliverSubscribers(repos);
      for (const subscriber of [...subscribers]) {
        let accepted = true;
        try { accepted = subscriber.onIdle?.(now(), { ...subscriber.watermarks }) !== false; }
        catch { accepted = false; }
        if (!accepted) removeSubscriber(subscriber, true);
      }
      for (const listener of listeners) {
        try { listener.onScanComplete?.({ ...observerWatermarks }); } catch { /* Observers are isolated. */ }
      }
    } catch (error) {
      deliverWarning(warning(null, error));
    } finally { scanning = false; }
  }

  return Object.freeze({
    baseline(selection) { return baselineReader(selection.repos, { ovenIds: selection.ovenIds }); },
    prepare() { initialize(); },
    canSubscribe: () => subscribers.size < maxSubscribers,
    subscribe(selection, { onDelivery, onReset, onWarning, onIdle, onClose } = {}) {
      if (typeof onDelivery !== "function") throw new Error("Oven event subscriber onDelivery must be a function.");
      if (subscribers.size >= maxSubscribers) throw observerError("Too many Oven event subscribers.", 429);
      initialize();
      const sets = selectionSets(selection);
      const startingWatermarks = selection.tail ? observerWatermarks : selection.watermarks;
      const subscriber = {
        ...sets,
        limit: selection.limit,
        watermarks: scopedKnownWatermarks(startingWatermarks, Object.keys(observerWatermarks), sets),
        warnings: new Set(),
        resets: new Set(),
        onDelivery,
        onReset,
        onWarning,
        onIdle,
        onClose,
      };
      subscribers.add(subscriber);
      ensureTimer();
      scan();
      return Object.freeze({
        unsubscribe: () => removeSubscriber(subscriber),
        watermarks: () => ({ ...subscriber.watermarks }),
      });
    },
    observe(callbacks = {}) {
      initialize();
      listeners.add(callbacks);
      ensureTimer();
      return () => {
        listeners.delete(callbacks);
        maybeStop();
      };
    },
    scan,
    close() {
      for (const subscriber of [...subscribers]) removeSubscriber(subscriber, true);
      listeners.clear();
      if (scanTimer !== null) timers.clearInterval(scanTimer);
      scanTimer = null;
    },
    stats: () => ({
      subscribers: subscribers.size,
      listeners: listeners.size,
      scans: scanCount,
      running: scanTimer !== null,
      watermarks: { ...observerWatermarks },
    }),
  });
}
