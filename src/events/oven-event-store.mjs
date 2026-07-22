import { existsSync, opendirSync } from "node:fs";
import { ovenId } from "../ovens/oven-contract.mjs";
import { containedJoin, withRepoStateLock } from "../server/repo-state.mjs";
import { normalizeOvenEvent } from "./oven-event-contract.mjs";
import {
  eventIndexPath,
  OVEN_EVENT_MAX_RETAINED_EVENTS,
  OVEN_EVENT_MAX_SEQUENCE,
  publishStoredOvenEvent,
  readIndexedOvenEvent,
  readOvenEventStreamState,
} from "./oven-event-stream-storage.mjs";

export const OVEN_EVENT_MAX_READ_EVENTS = 1_000;
export const OVEN_EVENT_MAX_READ_STREAMS = 64;
export const OVEN_EVENT_MAX_SEQUENCE_SCANS = 4_096;
export const OVEN_EVENT_MAX_DISCOVERY_SCANS = 256;
export const OVEN_EVENT_INTERNAL_PAGE_STREAMS = 64;
export const OVEN_EVENT_INTERNAL_MAX_STREAMS = 4_096;
export const OVEN_EVENT_INTERNAL_MAX_DISCOVERY_SCANS = 16_384;
export { OVEN_EVENT_MAX_RETAINED_EVENTS };

export function ovenEventsDir(repoRoot) {
  return containedJoin(repoRoot, "events");
}

export function* discoverOvenEventStreamPages(repoRoot, {
  pageSize = OVEN_EVENT_INTERNAL_PAGE_STREAMS,
  maxStreams = OVEN_EVENT_INTERNAL_MAX_STREAMS,
  maxDiscoveryScans = OVEN_EVENT_INTERNAL_MAX_DISCOVERY_SCANS,
} = {}) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > OVEN_EVENT_MAX_READ_STREAMS) {
    throw new Error(`Oven event internal page size must be from 1 to ${OVEN_EVENT_MAX_READ_STREAMS}.`);
  }
  if (!Number.isSafeInteger(maxStreams) || maxStreams < 1 || maxStreams > OVEN_EVENT_INTERNAL_MAX_STREAMS) {
    throw new Error(`Oven event internal stream limit must be from 1 to ${OVEN_EVENT_INTERNAL_MAX_STREAMS}.`);
  }
  if (!Number.isSafeInteger(maxDiscoveryScans) || maxDiscoveryScans < maxStreams
      || maxDiscoveryScans > OVEN_EVENT_INTERNAL_MAX_DISCOVERY_SCANS) {
    throw new Error(`Oven event internal discovery limit must be from ${maxStreams} to ${OVEN_EVENT_INTERNAL_MAX_DISCOVERY_SCANS}.`);
  }
  const root = ovenEventsDir(repoRoot);
  if (!existsSync(root)) return;
  const directory = opendirSync(root);
  const ids = [];
  let inspected = 0;
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      inspected += 1;
      if (inspected > maxDiscoveryScans) {
        throw streamLimitError(`Internal Oven event discovery exceeded ${maxDiscoveryScans} entries.`);
      }
      if (!entry.isDirectory()) continue;
      try { ids.push(ovenId(entry.name)); } catch { /* Ignore unrelated local state. */ }
      if (ids.length > maxStreams) throw streamLimitError(`Internal Oven event observation exceeds ${maxStreams} streams.`);
    }
  } finally { directory.closeSync(); }
  ids.sort();
  for (let offset = 0; offset < ids.length; offset += pageSize) yield ids.slice(offset, offset + pageSize);
}

export function publishOvenEvent(repoRoot, input, options = {}) {
  const draft = normalizeOvenEvent(input, options);
  return withRepoStateLock(repoRoot, () => publishStoredOvenEvent(repoRoot, draft, options));
}

function normalizedAfterSequences(afterSequences) {
  if (!afterSequences || typeof afterSequences !== "object" || Array.isArray(afterSequences)) {
    throw new Error("Oven event afterSequences must be an object.");
  }
  const entries = Object.entries(afterSequences);
  if (entries.length > OVEN_EVENT_MAX_READ_STREAMS) {
    throw new Error(`Oven event afterSequences is limited to ${OVEN_EVENT_MAX_READ_STREAMS} streams.`);
  }
  return Object.fromEntries(entries.map(([id, sequence]) => {
    const normalizedId = ovenId(id);
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > OVEN_EVENT_MAX_SEQUENCE) {
      throw new Error(`Oven ${normalizedId} replay sequence is invalid.`);
    }
    return [normalizedId, sequence];
  }));
}

function streamLimitError(message) {
  return Object.assign(new Error(message), { code: "ESTREAMLIMIT" });
}

function eventDirectories(repoRoot, ovenIds, maxStreams) {
  if (!Number.isSafeInteger(maxStreams) || maxStreams < 1 || maxStreams > OVEN_EVENT_MAX_READ_STREAMS) {
    throw new Error(`Oven event stream limit must be from 1 to ${OVEN_EVENT_MAX_READ_STREAMS}.`);
  }
  if (ovenIds !== undefined && !Array.isArray(ovenIds)) throw new Error("Oven event ovenIds must be an array.");
  if (ovenIds?.length) {
    const ids = [...new Set(ovenIds.map((id) => ovenId(id)))].sort();
    if (ids.length > maxStreams) throw streamLimitError(`Oven event reads are limited to ${maxStreams} streams.`);
    return ids.map((id) => ({ id, path: containedJoin(repoRoot, "events", id, "sequence") }));
  }
  const root = ovenEventsDir(repoRoot);
  if (!existsSync(root)) return [];
  const directory = opendirSync(root);
  const streams = [];
  let inspected = 0;
  try {
    for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
      inspected += 1;
      if (inspected > OVEN_EVENT_MAX_DISCOVERY_SCANS) {
        throw streamLimitError(`Oven event discovery is limited to ${OVEN_EVENT_MAX_DISCOVERY_SCANS} entries; filter by ovenId.`);
      }
      if (!entry.isDirectory()) continue;
      try { streams.push({ id: ovenId(entry.name), path: containedJoin(repoRoot, "events", entry.name, "sequence") }); }
      catch { /* Ignore unrelated local-state directories. */ }
      if (streams.length > maxStreams) throw streamLimitError(`Oven event reads are limited to ${maxStreams} streams; filter by ovenId.`);
    }
  } finally { directory.closeSync(); }
  return streams.sort((left, right) => left.id.localeCompare(right.id));
}

function resetError(id, requestedSequence, state) {
  const reason = requestedSequence > state.committedSequence ? "stream-regressed" : "retention-gap";
  return Object.assign(
    new Error(
      `Oven ${id} replay cursor ${requestedSequence} is outside retained sequences ${state.baseSequence}-${state.committedSequence}.`,
    ),
    {
      code: "EREPLAYRESET",
      reset: {
        ovenId: id,
        reason,
        requestedSequence,
        baseSequence: state.baseSequence,
        committedSequence: state.committedSequence,
      },
    },
  );
}

export function readOvenEventTail(repoRoot, {
  ovenIds,
  maxStreams = OVEN_EVENT_MAX_READ_STREAMS,
  onInvalid = () => {},
} = {}) {
  if (typeof onInvalid !== "function") throw new Error("Oven event onInvalid must be a function.");
  const sequences = {};
  for (const stream of eventDirectories(repoRoot, ovenIds, maxStreams)) {
    if (!existsSync(stream.path)) continue;
    try { sequences[stream.id] = readOvenEventStreamState(repoRoot, stream.id).committedSequence; }
    catch (error) { onInvalid(error, containedJoin(repoRoot, "events", stream.id, "state.json")); }
  }
  return sequences;
}

export function openOvenEventStreams(repoRoot, {
  ovenIds,
  afterSequences = {},
  maxStreams = OVEN_EVENT_MAX_READ_STREAMS,
  maxSequenceScans = OVEN_EVENT_MAX_SEQUENCE_SCANS,
  onInvalid = () => {},
  onReset = () => {},
} = {}) {
  if (typeof onInvalid !== "function") throw new Error("Oven event onInvalid must be a function.");
  if (typeof onReset !== "function") throw new Error("Oven event onReset must be a function.");
  if (!Number.isSafeInteger(maxSequenceScans) || maxSequenceScans < 1 || maxSequenceScans > OVEN_EVENT_MAX_SEQUENCE_SCANS) {
    throw new Error(`Oven event sequence scan limit must be from 1 to ${OVEN_EVENT_MAX_SEQUENCE_SCANS}.`);
  }
  const after = normalizedAfterSequences(afterSequences);
  return eventDirectories(repoRoot, ovenIds, maxStreams).flatMap((stream) => {
    if (!existsSync(stream.path)) return [];
    let state;
    try { state = readOvenEventStreamState(repoRoot, stream.id); }
    catch (error) {
      onInvalid(error, containedJoin(repoRoot, "events", stream.id, "state.json"));
      return [];
    }
    const requested = after[stream.id] ?? 0;
    const needsReset = requested < state.baseSequence - 1 || requested > state.committedSequence;
    if (needsReset) onReset(resetError(stream.id, requested, state));
    let sequence = needsReset ? state.baseSequence : requested + 1;
    let scans = 0;
    let blocked = false;
    return [{
      ovenId: stream.id,
      baseSequence: state.baseSequence,
      committedSequence: state.committedSequence,
      reset: needsReset,
      next() {
        if (blocked) return null;
        while (sequence <= state.committedSequence && scans < maxSequenceScans) {
          const current = sequence;
          sequence += 1;
          scans += 1;
          try { return readIndexedOvenEvent(repoRoot, stream.id, current); }
          catch (error) {
            blocked = true;
            onInvalid(error, eventIndexPath(repoRoot, stream.id, current));
            return null;
          }
        }
        if (sequence <= state.committedSequence) {
          blocked = true;
          const error = new Error(`Oven ${stream.id} replay exceeded its ${maxSequenceScans} sequence scan limit.`);
          error.code = "ESCANLIMIT";
          onInvalid(error, stream.path);
        }
        return null;
      },
    }];
  });
}

export function readOvenEvents(repoRoot, {
  ovenIds,
  afterSequences = {},
  limit = OVEN_EVENT_MAX_READ_EVENTS,
  limitPerOven = OVEN_EVENT_MAX_READ_EVENTS,
  maxStreams = OVEN_EVENT_MAX_READ_STREAMS,
  maxSequenceScans = OVEN_EVENT_MAX_SEQUENCE_SCANS,
  onInvalid = () => {},
  onReset = () => {},
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OVEN_EVENT_MAX_READ_EVENTS) {
    throw new Error(`Oven event limit must be from 1 to ${OVEN_EVENT_MAX_READ_EVENTS}.`);
  }
  if (!Number.isSafeInteger(limitPerOven) || limitPerOven < 1 || limitPerOven > OVEN_EVENT_MAX_READ_EVENTS) {
    throw new Error(`Oven event per-Oven limit must be from 1 to ${OVEN_EVENT_MAX_READ_EVENTS}.`);
  }
  const events = [];
  const streams = openOvenEventStreams(repoRoot, {
    ovenIds, afterSequences, maxStreams, maxSequenceScans, onInvalid, onReset,
  });
  for (const stream of streams) {
    let accepted = 0;
    while (accepted < limitPerOven && events.length < limit) {
      const event = stream.next();
      if (!event) break;
      events.push(event);
      accepted += 1;
    }
    if (events.length >= limit) break;
  }
  return events;
}
