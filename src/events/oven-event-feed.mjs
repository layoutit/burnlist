import { ovenId } from "../ovens/oven-contract.mjs";
import {
  openOvenEventStreams,
  OVEN_EVENT_MAX_READ_EVENTS,
  OVEN_EVENT_MAX_READ_STREAMS,
} from "./oven-event-store.mjs";

const replayCursorPattern = /^oev1-[A-Za-z0-9_-]{2,8192}$/u;
const watermarkKeyPattern = /^[a-f0-9]{12}\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const repoKeyPattern = /^[a-f0-9]{12}$/u;
const allowedQueryKeys = new Set(["after", "limit", "ovenId", "repoKey", "stream"]);
const MAX_STREAM_SUBSCRIBERS = 32;
const MAX_FEED_REPOS = 32;
const MAX_FEED_STREAMS = 64;
const MAX_FEED_WARNINGS = 64;
let activeStreamSubscribers = 0;

function requestError(message, status = 400) {
  return Object.assign(new Error(message), { status });
}

function unique(values) {
  return [...new Set(values)];
}

function one(url, name) {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw requestError(`${name} must be supplied at most once.`);
  return values[0] ?? null;
}

function selectedRepos(repos, repoKeys) {
  if (!Array.isArray(repos)) throw new Error("Oven event repositories must be an array.");
  if (repoKeys.length > MAX_FEED_REPOS) throw requestError(`At most ${MAX_FEED_REPOS} repositories may be selected.`);
  if (!repoKeys.length) {
    if (repos.length > MAX_FEED_REPOS) throw requestError(`The event feed spans more than ${MAX_FEED_REPOS} repositories; filter by repoKey.`, 413);
    return repos;
  }
  const known = new Map(repos.map((repo) => [repo.repoKey, repo]));
  return repoKeys.map((key) => {
    if (!repoKeyPattern.test(key)) throw requestError("repoKey must be a lowercase 12-character hexadecimal key.");
    const repo = known.get(key);
    if (!repo) throw requestError(`Unknown repository key: ${key}`, 404);
    return repo;
  });
}

function validatedWatermarks(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw requestError(`${label} is invalid.`);
  const entries = Object.entries(value);
  if (entries.length > MAX_FEED_STREAMS) throw requestError(`${label} contains too many stream watermarks.`);
  const result = {};
  for (const [key, sequence] of entries) {
    if (!watermarkKeyPattern.test(key) || !Number.isSafeInteger(sequence) || sequence < 0) {
      throw requestError(`${label} is invalid.`);
    }
    result[key] = sequence;
  }
  return result;
}

export function decodeOvenEventReplayCursor(value) {
  if (!value) return {};
  if (!replayCursorPattern.test(value)) throw requestError("after must be a valid Oven event replay cursor.");
  let decoded;
  try { decoded = JSON.parse(Buffer.from(value.slice(5), "base64url").toString("utf8")); }
  catch { throw requestError("after must be a valid Oven event replay cursor."); }
  return validatedWatermarks(decoded, "Oven event replay cursor");
}

export function encodeOvenEventReplayCursor(watermarks) {
  const validated = validatedWatermarks(watermarks, "Oven event replay cursor");
  const ordered = {};
  for (const key of Object.keys(validated).sort()) ordered[key] = validated[key];
  const cursor = `oev1-${Buffer.from(JSON.stringify(ordered)).toString("base64url")}`;
  if (!replayCursorPattern.test(cursor)) throw requestError("Oven event replay cursor is too large.");
  return cursor;
}

export function ovenEventFeedSelection(url, repos, headers = {}) {
  for (const key of url.searchParams.keys()) {
    if (!allowedQueryKeys.has(key)) throw requestError(`Unsupported Oven event query parameter: ${key}`);
  }
  const repoValues = url.searchParams.getAll("repoKey");
  const ovenValues = url.searchParams.getAll("ovenId");
  if (repoValues.length > MAX_FEED_REPOS) throw requestError(`At most ${MAX_FEED_REPOS} repoKey values may be supplied.`);
  if (ovenValues.length > MAX_FEED_STREAMS) throw requestError(`At most ${MAX_FEED_STREAMS} ovenId values may be supplied.`);
  const repoKeys = unique(repoValues);
  const ovenIds = unique(ovenValues).map(ovenId);
  const headerValue = headers["last-event-id"];
  const headerAfter = typeof headerValue === "string" ? headerValue.trim() : "";
  const queryAfter = one(url, "after") ?? "";
  if (headerAfter && queryAfter && headerAfter !== queryAfter) throw requestError("after and Last-Event-ID disagree.");
  const limitText = one(url, "limit");
  const limit = limitText === null ? 256 : Number(limitText);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OVEN_EVENT_MAX_READ_EVENTS) {
    throw requestError(`limit must be an integer from 1 to ${OVEN_EVENT_MAX_READ_EVENTS}.`);
  }
  const streamValue = one(url, "stream");
  if (streamValue !== null && streamValue !== "1") throw requestError("stream must be 1 when supplied.");
  return {
    repos: selectedRepos(repos, repoKeys),
    ovenIds,
    watermarks: decodeOvenEventReplayCursor(headerAfter || queryAfter || null),
    limit,
    stream: streamValue === "1",
  };
}

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

function warningCollector() {
  const warnings = [];
  const seen = new Set();
  return {
    warnings,
    add(repoKey, error) {
      const warning = { repoKey, code: error?.code ?? "EOBSERVER", error: error?.message ?? String(error) };
      const signature = JSON.stringify(warning);
      if (seen.has(signature)) return;
      seen.add(signature);
      if (warnings.length < MAX_FEED_WARNINGS) warnings.push(warning);
    },
  };
}

function compareHeads(left, right) {
  return left.current.occurredAt.localeCompare(right.current.occurredAt) || left.key.localeCompare(right.key);
}

function heapDown(heap, start) {
  let index = start;
  while (true) {
    const left = index * 2 + 1;
    const right = left + 1;
    let smallest = index;
    if (left < heap.length && compareHeads(heap[left], heap[smallest]) < 0) smallest = left;
    if (right < heap.length && compareHeads(heap[right], heap[smallest]) < 0) smallest = right;
    if (smallest === index) return;
    [heap[index], heap[smallest]] = [heap[smallest], heap[index]];
    index = smallest;
  }
}

export function readOvenEventDeliveries(repos, { ovenIds = [], watermarks = {}, limit = 256 } = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OVEN_EVENT_MAX_READ_EVENTS) {
    throw requestError(`limit must be an integer from 1 to ${OVEN_EVENT_MAX_READ_EVENTS}.`);
  }
  const observed = warningCollector();
  const sources = [];
  let streamCount = 0;
  for (const repo of repos) {
    let streams;
    try {
      streams = openOvenEventStreams(repo.root, {
        ovenIds,
        afterSequences: repoAfterSequences(watermarks, repo.repoKey),
        maxStreams: OVEN_EVENT_MAX_READ_STREAMS,
        onInvalid: (error) => observed.add(repo.repoKey, error),
      });
    } catch (error) {
      if (error?.code === "ESTREAMLIMIT") throw requestError(error.message, 413);
      observed.add(repo.repoKey, error);
      continue;
    }
    if (streamCount + streams.length > MAX_FEED_STREAMS) {
      throw requestError(`The event feed spans more than ${MAX_FEED_STREAMS} streams; filter by repoKey or ovenId.`, 413);
    }
    streamCount += streams.length;
    for (const reader of streams) {
      const event = reader.next();
      if (event) sources.push({ key: `${repo.repoKey}/${event.ovenId}`, repo, reader, current: delivery(repo, event) });
    }
  }
  const heap = sources;
  for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index -= 1) heapDown(heap, index);
  const deliveries = [];
  while (heap.length && deliveries.length < limit + 1) {
    const head = heap[0];
    deliveries.push(head.current);
    const next = head.reader.next();
    if (next) head.current = delivery(head.repo, next);
    else {
      heap[0] = heap.at(-1);
      heap.pop();
    }
    if (heap.length) heapDown(heap, 0);
  }
  return { deliveries, warnings: observed.warnings };
}

function advancedWatermarks(watermarks, deliveries) {
  const next = { ...watermarks };
  for (const item of deliveries) {
    const key = `${item.repoKey}/${item.ovenId}`;
    next[key] = Math.max(next[key] ?? 0, item.sequence);
  }
  return next;
}

function writeSse(res, event, data, id) {
  return res.write(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function serveOvenEventFeed({
  req,
  res,
  url,
  repos,
  json,
  scanIntervalMs = 500,
  keepAliveMs = 15_000,
  maxSubscribers = MAX_STREAM_SUBSCRIBERS,
  timers = { setInterval, clearInterval },
  readDeliveries = readOvenEventDeliveries,
}) {
  const selection = ovenEventFeedSelection(url, repos, req.headers);
  const acceptsSse = String(req.headers.accept ?? "").includes("text/event-stream");
  const streaming = selection.stream || acceptsSse;
  if (!Number.isSafeInteger(maxSubscribers) || maxSubscribers < 1 || maxSubscribers > MAX_STREAM_SUBSCRIBERS) {
    throw new Error(`Oven event subscriber limit must be from 1 to ${MAX_STREAM_SUBSCRIBERS}.`);
  }
  if (streaming && activeStreamSubscribers >= maxSubscribers) throw requestError("Too many Oven event subscribers.", 429);
  const initial = readDeliveries(selection.repos, selection);
  if (!streaming) {
    const events = initial.deliveries.slice(0, selection.limit);
    json(res, 200, {
      schema: "burnlist-oven-event-feed@1",
      generatedAt: new Date().toISOString(),
      cursor: encodeOvenEventReplayCursor(advancedWatermarks(selection.watermarks, events)),
      total: events.length,
      truncated: events.length < initial.deliveries.length,
      events,
      warnings: initial.warnings,
    });
    return;
  }
  activeStreamSubscribers += 1;
  let closed = false;
  let waitingDrain = false;
  let scanTimer = null;
  let keepAliveTimer = null;
  let watermarks = { ...selection.watermarks };
  let pending = [];
  let pendingIndex = 0;
  const reportedWarnings = new Set();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    activeStreamSubscribers = Math.max(0, activeStreamSubscribers - 1);
    if (scanTimer !== null) timers.clearInterval(scanTimer);
    if (keepAliveTimer !== null) timers.clearInterval(keepAliveTimer);
    res.off?.("drain", onDrain);
    res.off?.("close", cleanup);
    res.off?.("error", cleanup);
    res.off?.("finish", cleanup);
    req.off?.("aborted", cleanup);
  };
  const closeStream = () => {
    cleanup();
    if (!res.destroyed) res.destroy?.();
  };
  const onDrain = () => {
    waitingDrain = false;
    pump();
  };
  const queueBatch = (batch) => {
    for (const warning of batch.warnings ?? []) {
      const signature = JSON.stringify(warning);
      if (reportedWarnings.has(signature) || reportedWarnings.size >= MAX_FEED_WARNINGS) continue;
      reportedWarnings.add(signature);
      pending.push({ type: "warning", value: warning });
    }
    for (const item of batch.deliveries.slice(0, selection.limit)) pending.push({ type: "delivery", value: item });
  };
  function pump() {
    if (closed || waitingDrain) return;
    try {
      while (!closed && pendingIndex < pending.length) {
        const frame = pending[pendingIndex];
        pendingIndex += 1;
        let accepted;
        if (frame.type === "delivery") {
          watermarks = advancedWatermarks(watermarks, [frame.value]);
          accepted = writeSse(res, "oven-event", frame.value, encodeOvenEventReplayCursor(watermarks));
        } else accepted = writeSse(res, "observer-error", frame.value);
        if (!accepted) {
          waitingDrain = true;
          res.once("drain", onDrain);
          return;
        }
      }
      pending = [];
      pendingIndex = 0;
    } catch { closeStream(); }
  }
  const scan = () => {
    if (closed || waitingDrain || pendingIndex < pending.length) return;
    try { queueBatch(readDeliveries(selection.repos, { ...selection, watermarks })); }
    catch (error) {
      queueBatch({ deliveries: [], warnings: [{ code: error?.code ?? "EOBSERVER", error: error?.message ?? String(error) }] });
    }
    pump();
  };
  const keepAlive = () => {
    if (closed || waitingDrain || pendingIndex < pending.length) return;
    try {
      if (!res.write(`: keepalive ${Date.now()}\n\n`)) {
        waitingDrain = true;
        res.once("drain", onDrain);
      }
    } catch { closeStream(); }
  };

  try {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.once("close", cleanup);
    res.once("error", cleanup);
    res.once("finish", cleanup);
    req.once?.("aborted", cleanup);
    queueBatch(initial);
    if (!res.write("retry: 1000\n\n")) {
      waitingDrain = true;
      res.once("drain", onDrain);
    } else pump();
    if (!closed) {
      scanTimer = timers.setInterval(scan, scanIntervalMs);
      keepAliveTimer = timers.setInterval(keepAlive, keepAliveMs);
      scanTimer?.unref?.();
      keepAliveTimer?.unref?.();
    }
  } catch (error) {
    cleanup();
    if (res.headersSent) res.destroy?.();
    else throw error;
  }
}
