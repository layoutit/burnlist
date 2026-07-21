import { ovenId } from "../ovens/oven-contract.mjs";
import { readOvenEvents } from "./oven-event-store.mjs";

const replayCursorPattern = /^oev1-[A-Za-z0-9_-]{2,8192}$/u;
const watermarkKeyPattern = /^[a-f0-9]{12}\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const repoKeyPattern = /^[a-f0-9]{12}$/u;
const allowedQueryKeys = new Set(["after", "limit", "ovenId", "repoKey", "stream"]);
const MAX_STREAM_SUBSCRIBERS = 32;
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
  if (!repoKeys.length) return repos;
  const known = new Map(repos.map((repo) => [repo.repoKey, repo]));
  return repoKeys.map((key) => {
    if (!repoKeyPattern.test(key)) throw requestError("repoKey must be a lowercase 12-character hexadecimal key.");
    const repo = known.get(key);
    if (!repo) throw requestError(`Unknown repository key: ${key}`, 404);
    return repo;
  });
}

export function decodeOvenEventReplayCursor(value) {
  if (!value) return {};
  if (!replayCursorPattern.test(value)) throw requestError("after must be a valid Oven event replay cursor.");
  let decoded;
  try { decoded = JSON.parse(Buffer.from(value.slice(5), "base64url").toString("utf8")); }
  catch { throw requestError("after must be a valid Oven event replay cursor."); }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw requestError("Oven event replay cursor is invalid.");
  const watermarks = {};
  for (const [key, sequence] of Object.entries(decoded)) {
    if (!watermarkKeyPattern.test(key) || !Number.isSafeInteger(sequence) || sequence < 0) {
      throw requestError("Oven event replay cursor is invalid.");
    }
    watermarks[key] = sequence;
  }
  return watermarks;
}

export function encodeOvenEventReplayCursor(watermarks) {
  const ordered = {};
  for (const key of Object.keys(watermarks).sort()) ordered[key] = watermarks[key];
  return `oev1-${Buffer.from(JSON.stringify(ordered)).toString("base64url")}`;
}

export function ovenEventFeedSelection(url, repos, headers = {}) {
  for (const key of url.searchParams.keys()) {
    if (!allowedQueryKeys.has(key)) throw requestError(`Unsupported Oven event query parameter: ${key}`);
  }
  const repoKeys = unique(url.searchParams.getAll("repoKey"));
  const ovenIds = unique(url.searchParams.getAll("ovenId")).map(ovenId);
  const headerAfter = typeof headers["last-event-id"] === "string" ? headers["last-event-id"].trim() : "";
  const queryAfter = one(url, "after") ?? "";
  if (headerAfter && queryAfter && headerAfter !== queryAfter) throw requestError("after and Last-Event-ID disagree.");
  const after = headerAfter || queryAfter || null;
  const limitText = one(url, "limit");
  const limit = limitText === null ? 256 : Number(limitText);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) throw requestError("limit must be an integer from 1 to 1000.");
  const streamValue = one(url, "stream");
  if (streamValue !== null && streamValue !== "1") throw requestError("stream must be 1 when supplied.");
  return {
    repos: selectedRepos(repos, repoKeys),
    ovenIds,
    watermarks: decodeOvenEventReplayCursor(after),
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

export function readOvenEventDeliveries(repos, { ovenIds = [], watermarks = {}, limit = 256 } = {}) {
  const deliveries = [];
  const warnings = [];
  for (const repo of repos) {
    let events = [];
    try {
      events = readOvenEvents(repo.root, {
        ovenIds,
        afterSequences: repoAfterSequences(watermarks, repo.repoKey),
        limitPerOven: limit + 1,
        onInvalid: (error) => warnings.push({ repoKey: repo.repoKey, error: error.message }),
      });
    } catch (error) {
      warnings.push({ repoKey: repo.repoKey, error: error.message });
    }
    for (const event of events) {
      deliveries.push({
        deliveryId: `${repo.repoKey}:${event.ovenId}:${event.sequence}:${event.eventId}`,
        repoKey: repo.repoKey,
        repo: repo.name,
        ...event,
      });
    }
  }
  return { deliveries: causalDeliveryOrder(deliveries), warnings };
}

function causalDeliveryOrder(deliveries) {
  const streams = new Map();
  for (const delivery of deliveries) {
    const key = `${delivery.repoKey}/${delivery.ovenId}`;
    const stream = streams.get(key) ?? [];
    stream.push(delivery);
    streams.set(key, stream);
  }
  for (const stream of streams.values()) stream.sort((left, right) => left.sequence - right.sequence);
  const compare = (left, right) => {
    const a = left.stream[left.index];
    const b = right.stream[right.index];
    return a.occurredAt.localeCompare(b.occurredAt) || left.key.localeCompare(right.key);
  };
  const heap = [...streams].map(([key, stream]) => ({ key, stream, index: 0 }));
  const swap = (left, right) => { [heap[left], heap[right]] = [heap[right], heap[left]]; };
  const down = (start) => {
    let index = start;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      let smallest = index;
      if (left < heap.length && compare(heap[left], heap[smallest]) < 0) smallest = left;
      if (right < heap.length && compare(heap[right], heap[smallest]) < 0) smallest = right;
      if (smallest === index) return;
      swap(index, smallest);
      index = smallest;
    }
  };
  for (let index = Math.floor(heap.length / 2) - 1; index >= 0; index -= 1) down(index);
  const ordered = [];
  while (heap.length) {
    const head = heap[0];
    ordered.push(head.stream[head.index]);
    head.index += 1;
    if (head.index >= head.stream.length) {
      heap[0] = heap.at(-1);
      heap.pop();
    }
    if (heap.length) down(0);
  }
  return ordered;
}

function advancedWatermarks(watermarks, deliveries) {
  const next = { ...watermarks };
  for (const delivery of deliveries) {
    const key = `${delivery.repoKey}/${delivery.ovenId}`;
    next[key] = Math.max(next[key] ?? 0, delivery.sequence);
  }
  return next;
}

function writeSse(res, event, data, id) {
  return res.write(`${id ? `id: ${id}\n` : ""}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export function serveOvenEventFeed({ req, res, url, repos, json, scanIntervalMs = 500, keepAliveMs = 15_000 }) {
  const selection = ovenEventFeedSelection(url, repos, req.headers);
  const initial = readOvenEventDeliveries(selection.repos, selection);
  const acceptsSse = String(req.headers.accept ?? "").includes("text/event-stream");
  if (!selection.stream && !acceptsSse) {
    const events = initial.deliveries.slice(0, selection.limit);
    const watermarks = advancedWatermarks(selection.watermarks, events);
    json(res, 200, {
      schema: "burnlist-oven-event-feed@1",
      generatedAt: new Date().toISOString(),
      cursor: encodeOvenEventReplayCursor(watermarks),
      total: initial.deliveries.length,
      truncated: events.length < initial.deliveries.length,
      events,
      warnings: initial.warnings,
    });
    return;
  }
  if (activeStreamSubscribers >= MAX_STREAM_SUBSCRIBERS) throw requestError("Too many Oven event subscribers.", 429);
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  let waitingDrain = !res.write("retry: 1000\n\n");
  activeStreamSubscribers += 1;
  let watermarks = { ...selection.watermarks };
  let pending = initial.deliveries.slice(0, selection.limit);
  let pendingIndex = 0;
  const pump = () => {
    waitingDrain = false;
    while (!res.destroyed && pendingIndex < pending.length) {
      const delivery = pending[pendingIndex];
      pendingIndex += 1;
      watermarks = advancedWatermarks(watermarks, [delivery]);
      if (!writeSse(res, "oven-event", delivery, encodeOvenEventReplayCursor(watermarks))) {
        waitingDrain = true;
        res.once("drain", pump);
        return;
      }
    }
    if (pendingIndex >= pending.length) {
      pending = [];
      pendingIndex = 0;
    }
  };
  let scanning = false;
  const scan = () => {
    if (scanning || waitingDrain || pendingIndex < pending.length || res.destroyed) return;
    scanning = true;
    try {
      const current = readOvenEventDeliveries(selection.repos, { ...selection, watermarks });
      pending.push(...current.deliveries.slice(0, selection.limit));
      pump();
    } catch (error) {
      if (!waitingDrain && !writeSse(res, "observer-error", { error: error.message })) {
        waitingDrain = true;
        res.once("drain", pump);
      }
    } finally { scanning = false; }
  };
  if (waitingDrain) res.once("drain", pump);
  else pump();
  const scanTimer = setInterval(scan, scanIntervalMs);
  const keepAliveTimer = setInterval(() => {
    if (res.destroyed || waitingDrain || pendingIndex < pending.length) return;
    if (!res.write(`: keepalive ${Date.now()}\n\n`)) {
      waitingDrain = true;
      res.once("drain", pump);
    }
  }, keepAliveMs);
  scanTimer.unref();
  keepAliveTimer.unref();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    activeStreamSubscribers -= 1;
    clearInterval(scanTimer);
    clearInterval(keepAliveTimer);
    res.off("drain", pump);
  };
  req.once("close", close);
  res.once("close", close);
}
