import {
  discoverOvenEventStreamPages,
  openOvenEventStreams,
  OVEN_EVENT_INTERNAL_MAX_STREAMS,
  OVEN_EVENT_MAX_READ_EVENTS,
  OVEN_EVENT_MAX_READ_STREAMS,
} from "./oven-event-store.mjs";

const MAX_WARNINGS = 64;

function repoAfterSequences(watermarks, repoKey) {
  const result = {};
  const prefix = `${repoKey}/`;
  for (const [key, sequence] of Object.entries(watermarks)) {
    if (key.startsWith(prefix)) result[key.slice(prefix.length)] = sequence;
  }
  return result;
}

function delivery(repo, event) {
  return {
    deliveryId: `${repo.repoKey}:${event.ovenId}:${event.sequence}:${event.eventId}`,
    repoKey: repo.repoKey,
    repo: repo.name,
    ...event,
  };
}

function collector() {
  const warnings = [];
  const resets = [];
  const seenWarnings = new Set();
  const seenResets = new Set();
  return {
    warnings,
    resets,
    warning(repoKey, error) {
      const item = { repoKey, code: error?.code ?? "EOBSERVER", error: error?.message ?? String(error) };
      const signature = JSON.stringify(item);
      if (seenWarnings.has(signature)) return;
      seenWarnings.add(signature);
      if (warnings.length < MAX_WARNINGS) warnings.push(item);
    },
    reset(repoKey, error) {
      const item = { repoKey, code: "EREPLAYRESET", ...error.reset };
      const signature = JSON.stringify(item);
      if (seenResets.has(signature)) return;
      seenResets.add(signature);
      if (resets.length < MAX_WARNINGS) resets.push(item);
    },
  };
}

function compareItems(left, right) {
  return left.occurredAt.localeCompare(right.occurredAt)
    || `${left.repoKey}/${left.ovenId}`.localeCompare(`${right.repoKey}/${right.ovenId}`);
}

function heapDown(heap, start) {
  let index = start;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && compareItems(heap[left].current, heap[smallest].current) < 0) smallest = left;
    if (right < heap.length && compareItems(heap[right].current, heap[smallest].current) < 0) smallest = right;
    if (smallest === index) return;
    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }
}

function drainReaders(repo, readers, limit) {
  const heap = [];
  for (const reader of readers) {
    const event = reader.next();
    if (event) heap.push({ reader, current: delivery(repo, event) });
  }
  for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index -= 1) heapDown(heap, index);
  const deliveries = [];
  while (heap.length && deliveries.length < limit + 1) {
    const head = heap[0];
    deliveries.push(head.current);
    const next = head.reader.next();
    if (next) head.current = delivery(repo, next);
    else {
      heap[0] = heap.at(-1);
      heap.pop();
    }
    if (heap.length) heapDown(heap, 0);
  }
  return deliveries;
}

function mergeDeliveries(left, right, limit) {
  const merged = [];
  let leftIndex = 0;
  let rightIndex = 0;
  while (merged.length < limit + 1 && (leftIndex < left.length || rightIndex < right.length)) {
    if (rightIndex >= right.length
        || (leftIndex < left.length && compareItems(left[leftIndex], right[rightIndex]) <= 0)) {
      merged.push(left[leftIndex]);
      leftIndex += 1;
    } else {
      merged.push(right[rightIndex]);
      rightIndex += 1;
    }
  }
  return merged;
}

function readPage(repo, ovenIds, watermarks, limit, observed) {
  const repoWatermarks = repoAfterSequences(watermarks, repo.repoKey);
  const afterSequences = ovenIds.length
    ? Object.fromEntries(ovenIds.flatMap((id) => (
      Object.hasOwn(repoWatermarks, id) ? [[id, repoWatermarks[id]]] : []
    )))
    : repoWatermarks;
  const readers = openOvenEventStreams(repo.root, {
    ovenIds,
    afterSequences,
    maxStreams: OVEN_EVENT_MAX_READ_STREAMS,
    onInvalid: (error) => observed.warning(repo.repoKey, error),
    onReset: (error) => observed.reset(repo.repoKey, error),
  });
  const streamKeys = [];
  const startWatermarks = {};
  const tails = {};
  for (const reader of readers) {
    const key = `${repo.repoKey}/${reader.ovenId}`;
    streamKeys.push(key);
    tails[key] = reader.committedSequence;
    startWatermarks[key] = reader.reset
      ? Math.min(reader.baseSequence - 1, reader.committedSequence)
      : (afterSequences[reader.ovenId] ?? 0);
  }
  return {
    deliveries: drainReaders(repo, readers, limit),
    streamKeys,
    startWatermarks,
    tails,
  };
}

function validateLimit(limit) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OVEN_EVENT_MAX_READ_EVENTS) {
    throw Object.assign(
      new Error(`limit must be an integer from 1 to ${OVEN_EVENT_MAX_READ_EVENTS}.`),
      { status: 400 },
    );
  }
}

function result(deliveries, observed, streamKeys, startWatermarks, tails, complete) {
  return {
    deliveries,
    warnings: observed.warnings,
    resets: observed.resets,
    streamKeys,
    startWatermarks,
    tails,
    complete,
  };
}

export function readOvenEventDeliveries(repos, { ovenIds = [], watermarks = {}, limit = 256 } = {}) {
  validateLimit(limit);
  const observed = collector();
  let deliveries = [];
  const streamKeys = [];
  const startWatermarks = {};
  const tails = {};
  let streamCount = 0;
  let complete = true;
  for (const repo of repos) {
    let page;
    try { page = readPage(repo, ovenIds, watermarks, limit, observed); }
    catch (error) {
      if (error?.code === "ESTREAMLIMIT") throw Object.assign(error, { status: 413 });
      observed.warning(repo.repoKey, error);
      complete = false;
      continue;
    }
    streamCount += page.streamKeys.length;
    if (streamCount > OVEN_EVENT_MAX_READ_STREAMS) {
      throw Object.assign(
        new Error(`The event feed spans more than ${OVEN_EVENT_MAX_READ_STREAMS} streams; filter by repoKey or ovenId.`),
        { status: 413 },
      );
    }
    deliveries = mergeDeliveries(deliveries, page.deliveries, limit);
    streamKeys.push(...page.streamKeys);
    Object.assign(startWatermarks, page.startWatermarks);
    Object.assign(tails, page.tails);
  }
  return result(deliveries, observed, streamKeys, startWatermarks, tails, complete);
}

export function readAllOvenEventDeliveries(repos, { watermarks = {}, limit = 256 } = {}) {
  validateLimit(limit);
  const observed = collector();
  let deliveries = [];
  const streamKeys = [];
  const startWatermarks = {};
  const tails = {};
  let streamCount = 0;
  let complete = true;
  for (const repo of repos) {
    try {
      for (const ovenIds of discoverOvenEventStreamPages(repo.root, {
        maxStreams: Math.max(1, OVEN_EVENT_INTERNAL_MAX_STREAMS - streamCount),
      })) {
        const page = readPage(repo, ovenIds, watermarks, limit, observed);
        streamCount += page.streamKeys.length;
        if (streamCount > OVEN_EVENT_INTERNAL_MAX_STREAMS) {
          throw Object.assign(new Error(`Internal Oven event observation exceeds ${OVEN_EVENT_INTERNAL_MAX_STREAMS} streams.`), {
            code: "ESTREAMLIMIT",
          });
        }
        deliveries = mergeDeliveries(deliveries, page.deliveries, limit);
        streamKeys.push(...page.streamKeys);
        Object.assign(startWatermarks, page.startWatermarks);
        Object.assign(tails, page.tails);
      }
    } catch (error) {
      observed.warning(repo.repoKey, error);
      complete = false;
    }
  }
  return result(deliveries, observed, streamKeys, startWatermarks, tails, complete);
}
