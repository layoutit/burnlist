import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { ovenId } from "../ovens/oven-contract.mjs";
import { containedJoin, withRepoStateLock } from "../server/repo-state.mjs";
import {
  assertOvenEvent,
  normalizeOvenEvent,
  OVEN_EVENT_MAX_BYTES,
  serializeOvenEvent,
} from "./oven-event-contract.mjs";

const eventIndexPattern = /^(\d{12})\.idx$/u;
const eventRecordPattern = /^(oe1-[a-f0-9]{64})\.json$/u;
const eventIdPattern = /^oe1-[a-f0-9]{64}$/u;
const EVENT_INDEX_BYTES = Buffer.byteLength(`${"oe1-"}${"0".repeat(64)}\n`);
const MAX_SEQUENCE = 999_999_999_999;
export const OVEN_EVENT_MAX_READ_EVENTS = 1_000;
export const OVEN_EVENT_MAX_READ_STREAMS = 64;
export const OVEN_EVENT_MAX_SEQUENCE_SCANS = 4_096;
export const OVEN_EVENT_MAX_DISCOVERY_SCANS = 256;

function fsyncDirectory(path) {
  const descriptor = openSync(path, constants.O_RDONLY);
  try { fsyncSync(descriptor); } finally { closeSync(descriptor); }
}

function atomicWrite(path, contents) {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  let descriptor;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(descriptor, contents);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    fsyncDirectory(dirname(path));
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
  }
}

function readEventFile(path) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size < 2 || stat.size > OVEN_EVENT_MAX_BYTES) {
    throw Object.assign(new Error("Oven event file is invalid or too large."), { code: "ECORRUPT" });
  }
  const text = readFileSync(path, "utf8");
  let event;
  try { event = assertOvenEvent(JSON.parse(text)); }
  catch (error) {
    throw Object.assign(new Error(`Oven event file is corrupt: ${error.message}`), { code: "ECORRUPT", cause: error });
  }
  if (text !== serializeOvenEvent(event)) {
    throw Object.assign(new Error("Oven event file is not canonical."), { code: "ECORRUPT" });
  }
  return event;
}

export function ovenEventsDir(repoRoot) {
  return containedJoin(repoRoot, "events");
}

function counterPath(repoRoot, id) {
  return containedJoin(repoRoot, "events", id, "sequence.txt");
}

function parseCounter(value, id) {
  if (!/^\d{1,12}\n$/u.test(value) || Number(value) > MAX_SEQUENCE) {
    throw Object.assign(new Error(`Oven ${id} event sequence is corrupt.`), { code: "ECORRUPT" });
  }
  return Number(value);
}

function readCounter(repoRoot, id) {
  const path = counterPath(repoRoot, id);
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.size < 2 || stat.size > 13) {
    throw Object.assign(new Error(`Oven ${id} event sequence is corrupt.`), { code: "ECORRUPT" });
  }
  return readFileSync(path, "utf8");
}

function openDirectoryIfPresent(path) {
  try { return opendirSync(path); }
  catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function recoveryScanLimitError(id) {
  return Object.assign(
    new Error(`Oven ${id} sequence recovery exceeded its ${OVEN_EVENT_MAX_SEQUENCE_SCANS} scan limit; restore sequence.txt.`),
    { code: "ESCANLIMIT" },
  );
}

function recoverHighestSequence(repoRoot, id) {
  let highest = 0;
  const sequenceDir = containedJoin(repoRoot, "events", id, "sequence");
  const recordsDir = containedJoin(repoRoot, "events", id, "records");
  {
    const directory = openDirectoryIfPresent(sequenceDir);
    if (directory) {
      let scanned = 0;
      try {
        for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
          scanned += 1;
          if (scanned > OVEN_EVENT_MAX_SEQUENCE_SCANS) throw recoveryScanLimitError(id);
          const match = entry.isFile() ? entry.name.match(eventIndexPattern) : null;
          if (match) highest = Math.max(highest, Number(match[1]));
        }
      } finally { directory.closeSync(); }
    }
  }
  {
    const directory = openDirectoryIfPresent(recordsDir);
    if (directory) {
      let scanned = 0;
      try {
        for (let entry = directory.readSync(); entry; entry = directory.readSync()) {
          scanned += 1;
          if (scanned > OVEN_EVENT_MAX_SEQUENCE_SCANS) throw recoveryScanLimitError(id);
          if (!entry.isFile() || !eventRecordPattern.test(entry.name)) continue;
          const path = containedJoin(repoRoot, "events", id, "records", entry.name);
          try {
            const event = readEventFile(path);
            if (event.ovenId === id && `${event.eventId}.json` === entry.name && event.sequence <= MAX_SEQUENCE) {
              highest = Math.max(highest, event.sequence);
            }
          } catch (error) {
            if (!["ECORRUPT", "ENOENT"].includes(error?.code)) throw error;
            // Corrupt records do not prevent recovery from valid reservations.
          }
        }
      } finally { directory.closeSync(); }
    }
  }
  atomicWrite(counterPath(repoRoot, id), `${highest}\n`);
  return highest;
}

function currentSequence(repoRoot, id) {
  try { return parseCounter(readCounter(repoRoot, id), id); }
  catch (error) {
    if (["ECORRUPT", "ENOENT"].includes(error?.code)) return recoverHighestSequence(repoRoot, id);
    throw error;
  }
}

function readHighestSequence(repoRoot, id) {
  return parseCounter(readCounter(repoRoot, id), id);
}

function eventPaths(repoRoot, event) {
  const sequence = String(event.sequence).padStart(12, "0");
  return {
    record: containedJoin(repoRoot, "events", event.ovenId, "records", `${event.eventId}.json`),
    index: containedJoin(repoRoot, "events", event.ovenId, "sequence", `${sequence}.idx`),
  };
}

function ensureIndex(path, eventId) {
  const contents = `${eventId}\n`;
  if (!existsSync(path)) atomicWrite(path, contents);
  else {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.size !== Buffer.byteLength(contents) || readFileSync(path, "utf8") !== contents) {
      throw new Error(`Oven event index is invalid: ${path}`);
    }
  }
}

export function publishOvenEvent(repoRoot, input, options = {}) {
  const draft = normalizeOvenEvent(input, options);
  return withRepoStateLock(repoRoot, () => {
    const recordPath = containedJoin(repoRoot, "events", draft.ovenId, "records", `${draft.eventId}.json`);
    mkdirSync(dirname(recordPath), { recursive: true });
    mkdirSync(containedJoin(repoRoot, "events", draft.ovenId, "sequence"), { recursive: true });
    if (existsSync(recordPath)) {
      const event = readEventFile(recordPath);
      if (event.eventId !== draft.eventId || event.ovenId !== draft.ovenId) {
        throw Object.assign(new Error("Oven event record does not match its deterministic filename."), { code: "ECORRUPT" });
      }
      const paths = eventPaths(repoRoot, event);
      ensureIndex(paths.index, event.eventId);
      if (currentSequence(repoRoot, draft.ovenId) < event.sequence) recoverHighestSequence(repoRoot, draft.ovenId);
      return { event, created: false, path: paths.record };
    }
    const sequence = currentSequence(repoRoot, draft.ovenId) + 1;
    if (sequence > MAX_SEQUENCE) throw new Error(`Oven ${draft.ovenId} event sequence is exhausted.`);
    const event = assertOvenEvent({ ...draft, sequence });
    const serialized = serializeOvenEvent(event);
    atomicWrite(counterPath(repoRoot, draft.ovenId), `${sequence}\n`);
    const paths = eventPaths(repoRoot, event);
    atomicWrite(paths.record, serialized);
    ensureIndex(paths.index, event.eventId);
    return { event, created: true, path: paths.record };
  });
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
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > MAX_SEQUENCE) {
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

export function openOvenEventStreams(repoRoot, {
  ovenIds,
  afterSequences = {},
  maxStreams = OVEN_EVENT_MAX_READ_STREAMS,
  maxSequenceScans = OVEN_EVENT_MAX_SEQUENCE_SCANS,
  onInvalid = () => {},
} = {}) {
  if (typeof onInvalid !== "function") throw new Error("Oven event onInvalid must be a function.");
  if (!Number.isSafeInteger(maxSequenceScans) || maxSequenceScans < 1 || maxSequenceScans > OVEN_EVENT_MAX_SEQUENCE_SCANS) {
    throw new Error(`Oven event sequence scan limit must be from 1 to ${OVEN_EVENT_MAX_SEQUENCE_SCANS}.`);
  }
  const after = normalizedAfterSequences(afterSequences);
  return eventDirectories(repoRoot, ovenIds, maxStreams).flatMap((stream) => {
    if (!existsSync(stream.path)) return [];
    let highest;
    try { highest = readHighestSequence(repoRoot, stream.id); }
    catch (error) { onInvalid(error, counterPath(repoRoot, stream.id)); return []; }
    let sequence = (after[stream.id] ?? 0) + 1;
    let scans = 0;
    let blocked = false;
    return [{
      ovenId: stream.id,
      next() {
        if (blocked) return null;
        while (sequence <= highest && scans < maxSequenceScans) {
          const current = sequence;
          sequence += 1;
          scans += 1;
          const indexPath = containedJoin(repoRoot, "events", stream.id, "sequence", `${String(current).padStart(12, "0")}.idx`);
          let stat;
          try { stat = lstatSync(indexPath); }
          catch (error) {
            if (error?.code === "ENOENT") continue;
            blocked = true;
            onInvalid(error, indexPath);
            return null;
          }
          try {
            if (!stat.isFile() || stat.size !== EVENT_INDEX_BYTES) throw new Error("Oven event index is invalid.");
            const indexText = readFileSync(indexPath, "utf8");
            const indexedId = indexText.slice(0, -1);
            if (indexText !== `${indexedId}\n` || !eventIdPattern.test(indexedId)) throw new Error("Oven event index is invalid.");
            const path = containedJoin(repoRoot, "events", stream.id, "records", `${indexedId}.json`);
            const event = readEventFile(path);
            if (event.ovenId !== stream.id || event.sequence !== current || event.eventId !== indexedId) {
              throw new Error("Oven event index does not match its record.");
            }
            return event;
          } catch (error) {
            blocked = true;
            onInvalid(error, indexPath);
            return null;
          }
        }
        if (sequence <= highest) {
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
} = {}) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > OVEN_EVENT_MAX_READ_EVENTS) {
    throw new Error(`Oven event limit must be from 1 to ${OVEN_EVENT_MAX_READ_EVENTS}.`);
  }
  if (!Number.isSafeInteger(limitPerOven) || limitPerOven < 1 || limitPerOven > OVEN_EVENT_MAX_READ_EVENTS) {
    throw new Error(`Oven event per-Oven limit must be from 1 to ${OVEN_EVENT_MAX_READ_EVENTS}.`);
  }
  const events = [];
  for (const stream of openOvenEventStreams(repoRoot, { ovenIds, afterSequences, maxStreams, maxSequenceScans, onInvalid })) {
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
