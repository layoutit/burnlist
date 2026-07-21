import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { ovenId } from "../ovens/oven-contract.mjs";
import { containedJoin, withRepoStateLock } from "../server/repo-state.mjs";
import { assertOvenEvent, normalizeOvenEvent, OVEN_EVENT_MAX_BYTES } from "./oven-event-contract.mjs";

const eventIndexPattern = /^(\d{12})-(oe1-[a-f0-9]{64})\.idx$/u;
const eventRecordPattern = /^(oe1-[a-f0-9]{64})\.json$/u;
const MAX_SEQUENCE = 999_999_999_999;

function readEventFile(path) {
  const stat = statSync(path);
  if (!stat.isFile() || stat.size > OVEN_EVENT_MAX_BYTES) throw new Error("Oven event file is invalid or too large.");
  return assertOvenEvent(JSON.parse(readFileSync(path, "utf8")));
}

function atomicWrite(path, contents) {
  const temporary = `${path}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  try {
    writeFileSync(temporary, contents, { flag: "wx", mode: 0o600 });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

export function ovenEventsDir(repoRoot) {
  return containedJoin(repoRoot, "events");
}

function recoverHighestSequence(repoRoot, id) {
  let highest = 0;
  const sequenceDir = containedJoin(repoRoot, "events", id, "sequence");
  const recordsDir = containedJoin(repoRoot, "events", id, "records");
  if (existsSync(sequenceDir)) {
    for (const entry of readdirSync(sequenceDir, { withFileTypes: true })) {
      const match = entry.isFile() ? entry.name.match(eventIndexPattern) : null;
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  }
  if (existsSync(recordsDir)) {
    for (const entry of readdirSync(recordsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !eventRecordPattern.test(entry.name)) continue;
      highest = Math.max(highest, readEventFile(containedJoin(repoRoot, "events", id, "records", entry.name)).sequence);
    }
  }
  const counter = containedJoin(repoRoot, "events", id, "sequence.txt");
  atomicWrite(counter, `${highest}\n`);
  return highest;
}

function currentSequence(repoRoot, id) {
  const counter = containedJoin(repoRoot, "events", id, "sequence.txt");
  if (!existsSync(counter)) return recoverHighestSequence(repoRoot, id);
  const value = readFileSync(counter, "utf8");
  if (!/^\d{1,12}\n$/u.test(value) || Number(value) > MAX_SEQUENCE) throw new Error(`Oven ${id} event sequence is corrupt.`);
  return Number(value);
}

function eventPaths(repoRoot, event) {
  const sequence = String(event.sequence).padStart(12, "0");
  return {
    record: containedJoin(repoRoot, "events", event.ovenId, "records", `${event.eventId}.json`),
    index: containedJoin(repoRoot, "events", event.ovenId, "sequence", `${sequence}-${event.eventId}.idx`),
  };
}

function ensureIndex(path) {
  if (!existsSync(path)) atomicWrite(path, "");
  else if (!statSync(path).isFile()) throw new Error(`Oven event index is invalid: ${path}`);
}

export function publishOvenEvent(repoRoot, input, options = {}) {
  const draft = normalizeOvenEvent(input, options);
  return withRepoStateLock(repoRoot, () => {
    const recordPath = containedJoin(repoRoot, "events", draft.ovenId, "records", `${draft.eventId}.json`);
    mkdirSync(dirname(recordPath), { recursive: true });
    mkdirSync(containedJoin(repoRoot, "events", draft.ovenId, "sequence"), { recursive: true });
    if (existsSync(recordPath)) {
      const event = readEventFile(recordPath);
      const paths = eventPaths(repoRoot, event);
      ensureIndex(paths.index);
      return { event, created: false, path: paths.record };
    }
    const sequence = currentSequence(repoRoot, draft.ovenId) + 1;
    if (sequence > MAX_SEQUENCE) throw new Error(`Oven ${draft.ovenId} event sequence is exhausted.`);
    atomicWrite(containedJoin(repoRoot, "events", draft.ovenId, "sequence.txt"), `${sequence}\n`);
    const event = { ...draft, sequence };
    if (Buffer.byteLength(JSON.stringify(event)) > OVEN_EVENT_MAX_BYTES) {
      throw new Error(`Oven event is larger than ${OVEN_EVENT_MAX_BYTES} bytes after sequencing.`);
    }
    const paths = eventPaths(repoRoot, event);
    atomicWrite(paths.record, `${JSON.stringify(event)}\n`);
    ensureIndex(paths.index);
    return { event, created: true, path: paths.record };
  });
}

function eventDirectories(repoRoot, ovenIds) {
  if (ovenIds?.length) return ovenIds.map((id) => ({ id: ovenId(id), path: containedJoin(repoRoot, "events", ovenId(id), "sequence") }));
  const root = ovenEventsDir(repoRoot);
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isDirectory()) return [];
    try { return [{ id: ovenId(entry.name), path: containedJoin(repoRoot, "events", entry.name, "sequence") }]; }
    catch { return []; }
  });
}

export function readOvenEvents(repoRoot, {
  ovenIds,
  afterSequences = {},
  limit,
  limitPerOven,
  onInvalid = () => {},
} = {}) {
  if (limitPerOven !== undefined && (!Number.isSafeInteger(limitPerOven) || limitPerOven < 1)) {
    throw new Error("Oven event per-Oven limit must be a positive integer.");
  }
  const events = [];
  for (const directory of eventDirectories(repoRoot, ovenIds)) {
    if (!existsSync(directory.path)) continue;
    let entries;
    try { entries = readdirSync(directory.path, { withFileTypes: true }); }
    catch (error) { onInvalid(error, directory.path); continue; }
    const indexes = entries.flatMap((entry) => {
      const match = entry.isFile() ? entry.name.match(eventIndexPattern) : null;
      return match ? [{ eventId: match[2], sequence: Number(match[1]) }] : [];
    }).filter((entry) => entry.sequence > (afterSequences[directory.id] ?? 0))
      .sort((left, right) => left.sequence - right.sequence || left.eventId.localeCompare(right.eventId));
    let accepted = 0;
    for (const index of indexes) {
      if (limitPerOven !== undefined && accepted >= limitPerOven) break;
      const fileSequence = index.sequence;
      const path = containedJoin(repoRoot, "events", directory.id, "records", `${index.eventId}.json`);
      try {
        const event = readEventFile(path);
        if (event.ovenId !== directory.id || event.sequence !== fileSequence || event.eventId !== index.eventId) {
          throw new Error("Oven event index does not match its record.");
        }
        events.push(event);
        accepted += 1;
      } catch (error) { onInvalid(error, path); }
    }
  }
  events.sort((left, right) => left.ovenId.localeCompare(right.ovenId) || left.sequence - right.sequence);
  if (limit === undefined) return events;
  if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("Oven event limit must be a positive integer.");
  return events.slice(0, limit);
}
