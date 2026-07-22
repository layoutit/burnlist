import { ovenId } from "../ovens/oven-contract.mjs";
import { OVEN_EVENT_MAX_READ_EVENTS } from "./oven-event-store.mjs";
import { readOvenEventDeliveries } from "./oven-event-deliveries.mjs";
import { createOvenEventObserver } from "./oven-event-observer.mjs";

export { readOvenEventDeliveries } from "./oven-event-deliveries.mjs";

const replayCursorPattern = /^oev1-[A-Za-z0-9_-]{2,8192}$/u;
const watermarkKeyPattern = /^[a-f0-9]{12}\/[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const repoKeyPattern = /^[a-f0-9]{12}$/u;
const allowedQueryKeys = new Set(["after", "limit", "ovenId", "repoKey", "stream", "tail"]);
const MAX_STREAM_SUBSCRIBERS = 32;
const MAX_FEED_REPOS = 32;
const MAX_FEED_STREAMS = 64;

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
  const limitText = one(url, "limit");
  const limit = limitText === null ? 256 : Number(limitText);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OVEN_EVENT_MAX_READ_EVENTS) {
    throw requestError(`limit must be an integer from 1 to ${OVEN_EVENT_MAX_READ_EVENTS}.`);
  }
  const streamValue = one(url, "stream");
  if (streamValue !== null && streamValue !== "1") throw requestError("stream must be 1 when supplied.");
  const tailValue = one(url, "tail");
  if (tailValue !== null && tailValue !== "1") throw requestError("tail must be 1 when supplied.");
  if (tailValue === "1" && (headerAfter || queryAfter)) throw requestError("tail cannot be combined with after or Last-Event-ID.");
  return {
    repos: selectedRepos(repos, repoKeys),
    ovenIds,
    // Native EventSource reconnects retain the original query while advancing
    // Last-Event-ID. The header is therefore the authoritative reconnect cursor.
    watermarks: decodeOvenEventReplayCursor(headerAfter || queryAfter || null),
    limit,
    stream: streamValue === "1",
    tail: tailValue === "1",
  };
}

function scopedWatermarks(watermarks, streamKeys = [], deliveries = [], startWatermarks = {}) {
  const next = {};
  for (const key of streamKeys) next[key] = startWatermarks[key] ?? watermarks[key] ?? 0;
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
  observer,
}) {
  const selection = ovenEventFeedSelection(url, repos, req.headers);
  const acceptsSse = String(req.headers.accept ?? "").includes("text/event-stream");
  const streaming = selection.stream || acceptsSse;
  if (!Number.isSafeInteger(maxSubscribers) || maxSubscribers < 1 || maxSubscribers > MAX_STREAM_SUBSCRIBERS) {
    throw new Error(`Oven event subscriber limit must be from 1 to ${MAX_STREAM_SUBSCRIBERS}.`);
  }
  const eventObserver = observer ?? createOvenEventObserver({
    resolveRepos: () => repos,
    ...(readDeliveries === readOvenEventDeliveries ? {} : { readDeliveries }),
    scanIntervalMs,
    maxSubscribers,
    timers,
  });
  const ownedObserver = !observer;
  if (selection.tail && !selection.stream) {
    if (streaming) throw requestError("tail requires stream=1 when used as SSE.");
    const baseline = eventObserver.baseline(selection);
    json(res, 200, {
      schema: "burnlist-oven-event-feed@1",
      generatedAt: new Date().toISOString(),
      cursor: encodeOvenEventReplayCursor(baseline.watermarks),
      baseline: true,
      total: 0,
      truncated: false,
      events: [],
      warnings: baseline.warnings,
    });
    return;
  }
  if (!streaming) {
    const initial = readDeliveries(selection.repos, selection);
    const events = initial.deliveries.slice(0, selection.limit);
    json(res, 200, {
      schema: "burnlist-oven-event-feed@1",
      generatedAt: new Date().toISOString(),
      cursor: encodeOvenEventReplayCursor(scopedWatermarks(
        selection.watermarks, initial.streamKeys, events, initial.startWatermarks,
      )),
      total: events.length,
      truncated: events.length < initial.deliveries.length,
      events,
      warnings: initial.warnings,
      resets: initial.resets ?? [],
    });
    return;
  }
  eventObserver.prepare();
  if (!eventObserver.canSubscribe()) throw requestError("Too many Oven event subscribers.", 429);
  let closed = false;
  let subscription = null;
  let lastKeepAlive = Date.now();

  const cleanup = () => {
    if (closed) return;
    closed = true;
    subscription?.unsubscribe();
    res.off?.("close", cleanup);
    res.off?.("error", cleanup);
    res.off?.("finish", cleanup);
    req.off?.("aborted", cleanup);
    if (ownedObserver) eventObserver.close();
  };
  const closeStream = () => {
    cleanup();
    if (!res.destroyed) res.destroy?.();
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
    if (!res.write("retry: 1000\n\n")) {
      closeStream();
      return;
    }
    subscription = eventObserver.subscribe(selection, {
      onDelivery(item, watermarks) {
        if (closed) return false;
        try {
          const id = selection.tail ? undefined : encodeOvenEventReplayCursor(watermarks);
          const accepted = writeSse(res, "oven-event", item, id);
          if (!accepted) closeStream();
          return accepted;
        } catch { closeStream(); return false; }
      },
      onReset(item, watermarks) {
        if (closed) return false;
        try {
          const id = selection.tail ? undefined : encodeOvenEventReplayCursor(watermarks);
          const accepted = writeSse(res, "oven-reset", item, id);
          if (!accepted) closeStream();
          return accepted;
        } catch { closeStream(); return false; }
      },
      onWarning(item) {
        if (closed) return false;
        try {
          const accepted = writeSse(res, "observer-error", item);
          if (!accepted) closeStream();
          return accepted;
        } catch { closeStream(); return false; }
      },
      onIdle(at) {
        if (closed || at - lastKeepAlive < keepAliveMs) return !closed;
        lastKeepAlive = at;
        try {
          const accepted = res.write(`: keepalive ${at}\n\n`);
          if (!accepted) closeStream();
          return accepted;
        } catch { closeStream(); return false; }
      },
      onClose: closeStream,
    });
  } catch (error) {
    cleanup();
    if (res.headersSent) res.destroy?.();
    else throw error;
  }
}
