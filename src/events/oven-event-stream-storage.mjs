import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname } from "node:path";
import { containedJoin } from "../server/repo-state.mjs";
import {
  assertOvenEvent,
  OVEN_EVENT_MAX_BYTES,
  serializeOvenEvent,
} from "./oven-event-contract.mjs";

const STREAM_STATE_SCHEMA = "burnlist-oven-event-stream@1";
const PENDING_SCHEMA = "burnlist-oven-event-pending@1";
const PRUNE_SCHEMA = "burnlist-oven-event-prune@1";
const eventIdPattern = /^oe1-[a-f0-9]{64}$/u;
const EVENT_INDEX_BYTES = Buffer.byteLength(`${"oe1-"}${"0".repeat(64)}\n`);
export const OVEN_EVENT_MAX_SEQUENCE = 999_999_999_999;
export const OVEN_EVENT_MAX_RETAINED_EVENTS = 4_096;

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

function removeDurably(path) {
  try { rmSync(path); }
  catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  fsyncDirectory(dirname(path));
  return true;
}

function regularText(path, maxBytes, label) {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size < 2 || stat.size > maxBytes) {
    throw Object.assign(new Error(`${label} is invalid.`), { code: "ECORRUPT" });
  }
  return readFileSync(path, "utf8");
}

function canonicalJson(path, schema, keys, label) {
  let value;
  try { value = JSON.parse(regularText(path, 1_024, label)); }
  catch (error) {
    if (error?.code === "ENOENT") throw error;
    throw Object.assign(new Error(`${label} is corrupt: ${error.message}`), { code: "ECORRUPT", cause: error });
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.schema !== schema || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) {
    throw Object.assign(new Error(`${label} is corrupt.`), { code: "ECORRUPT" });
  }
  return value;
}

function streamPath(repoRoot, id, ...segments) {
  return containedJoin(repoRoot, "events", id, ...segments);
}

function statePath(repoRoot, id) {
  return streamPath(repoRoot, id, "state.json");
}

function legacyCounterPath(repoRoot, id) {
  return streamPath(repoRoot, id, "sequence.txt");
}

function pendingPath(repoRoot, id) {
  return streamPath(repoRoot, id, "pending.json");
}

function prunePath(repoRoot, id) {
  return streamPath(repoRoot, id, "prune.json");
}

export function eventIndexPath(repoRoot, id, sequence) {
  return streamPath(repoRoot, id, "sequence", `${String(sequence).padStart(12, "0")}.idx`);
}

function eventRecordPath(repoRoot, id, eventId) {
  return streamPath(repoRoot, id, "records", `${eventId}.json`);
}

function validSequence(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= OVEN_EVENT_MAX_SEQUENCE;
}

function assertState(value, id) {
  if (!validSequence(value.baseSequence) || value.baseSequence < 1
      || !validSequence(value.committedSequence)
      || value.baseSequence > value.committedSequence + 1) {
    throw Object.assign(new Error(`Oven ${id} event stream state is corrupt.`), { code: "ECORRUPT" });
  }
  return value;
}

function parseLegacyCounter(repoRoot, id) {
  let text;
  try { text = regularText(legacyCounterPath(repoRoot, id), 13, `Oven ${id} event sequence`); }
  catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw error;
  }
  if (!/^\d{1,12}\n$/u.test(text) || Number(text) > OVEN_EVENT_MAX_SEQUENCE) {
    throw Object.assign(new Error(`Oven ${id} event sequence is corrupt.`), { code: "ECORRUPT" });
  }
  return Number(text);
}

function legacyState(repoRoot, id) {
  const committedSequence = parseLegacyCounter(repoRoot, id);
  if (committedSequence === 0) return { schema: STREAM_STATE_SCHEMA, baseSequence: 1, committedSequence: 0 };
  if (!existsSync(eventIndexPath(repoRoot, id, committedSequence))) {
    return { schema: STREAM_STATE_SCHEMA, baseSequence: committedSequence + 1, committedSequence };
  }
  let baseSequence = committedSequence;
  const floor = Math.max(1, committedSequence - OVEN_EVENT_MAX_RETAINED_EVENTS + 1);
  while (baseSequence > floor && existsSync(eventIndexPath(repoRoot, id, baseSequence - 1))) baseSequence -= 1;
  return { schema: STREAM_STATE_SCHEMA, baseSequence, committedSequence };
}

export function readOvenEventStreamState(repoRoot, id) {
  let value;
  try {
    value = canonicalJson(
      statePath(repoRoot, id),
      STREAM_STATE_SCHEMA,
      ["schema", "baseSequence", "committedSequence"],
      `Oven ${id} event stream state`,
    );
  } catch (error) {
    if (error?.code === "ENOENT") return legacyState(repoRoot, id);
    throw error;
  }
  return assertState(value, id);
}

function writeState(repoRoot, id, state) {
  assertState(state, id);
  atomicWrite(statePath(repoRoot, id), `${JSON.stringify(state)}\n`);
}

export function readStoredOvenEvent(repoRoot, id, eventId) {
  const path = eventRecordPath(repoRoot, id, eventId);
  let event;
  try { event = assertOvenEvent(JSON.parse(regularText(path, OVEN_EVENT_MAX_BYTES, "Oven event file"))); }
  catch (error) {
    if (error?.code === "ENOENT") throw error;
    throw Object.assign(new Error(`Oven event file is corrupt: ${error.message}`), { code: "ECORRUPT", cause: error });
  }
  if (readFileSync(path, "utf8") !== serializeOvenEvent(event)) {
    throw Object.assign(new Error("Oven event file is not canonical."), { code: "ECORRUPT" });
  }
  return event;
}

export function readIndexedOvenEvent(repoRoot, id, sequence) {
  const index = eventIndexPath(repoRoot, id, sequence);
  const text = regularText(index, EVENT_INDEX_BYTES, "Oven event index");
  const eventId = text.slice(0, -1);
  if (text !== `${eventId}\n` || !eventIdPattern.test(eventId) || Buffer.byteLength(text) !== EVENT_INDEX_BYTES) {
    throw Object.assign(new Error("Oven event index is invalid."), { code: "ECORRUPT" });
  }
  const event = readStoredOvenEvent(repoRoot, id, eventId);
  if (event.ovenId !== id || event.sequence !== sequence || event.eventId !== eventId) {
    throw Object.assign(new Error("Oven event index does not match its record."), { code: "ECORRUPT" });
  }
  return event;
}

function ensureIndex(repoRoot, event) {
  const path = eventIndexPath(repoRoot, event.ovenId, event.sequence);
  const contents = `${event.eventId}\n`;
  if (!existsSync(path)) atomicWrite(path, contents);
  else if (regularText(path, EVENT_INDEX_BYTES, "Oven event index") !== contents) {
    throw Object.assign(new Error(`Oven event index is invalid: ${path}`), { code: "ECORRUPT" });
  }
}

function pendingValue(repoRoot, id) {
  let value;
  try {
    value = canonicalJson(
      pendingPath(repoRoot, id), PENDING_SCHEMA,
      ["schema", "eventId", "sequence"], `Oven ${id} pending event`,
    );
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
  if (!eventIdPattern.test(value.eventId) || !validSequence(value.sequence) || value.sequence < 1) {
    throw Object.assign(new Error(`Oven ${id} pending event is corrupt.`), { code: "ECORRUPT" });
  }
  return value;
}

function completePrune(repoRoot, id, state) {
  let value;
  try {
    value = canonicalJson(
      prunePath(repoRoot, id), PRUNE_SCHEMA,
      ["schema", "fromSequence", "toSequence"], `Oven ${id} event prune`,
    );
  } catch (error) {
    if (error?.code === "ENOENT") return state;
    throw error;
  }
  if (!validSequence(value.fromSequence) || !validSequence(value.toSequence)
      || value.fromSequence < 1 || value.toSequence < value.fromSequence) {
    throw Object.assign(new Error(`Oven ${id} event prune is corrupt.`), { code: "ECORRUPT" });
  }
  const next = { ...state, baseSequence: Math.max(state.baseSequence, value.toSequence + 1) };
  if (next.baseSequence > state.committedSequence + 1) next.baseSequence = state.committedSequence + 1;
  if (next.baseSequence !== state.baseSequence) writeState(repoRoot, id, next);
  for (let sequence = value.fromSequence; sequence <= value.toSequence; sequence += 1) {
    try {
      const event = readIndexedOvenEvent(repoRoot, id, sequence);
      removeDurably(eventIndexPath(repoRoot, id, sequence));
      removeDurably(eventRecordPath(repoRoot, id, event.eventId));
    } catch (error) {
      if (!['ENOENT', 'ECORRUPT'].includes(error?.code)) throw error;
      removeDurably(eventIndexPath(repoRoot, id, sequence));
    }
  }
  removeDurably(prunePath(repoRoot, id));
  return next;
}

function prune(repoRoot, id, state, retentionLimit) {
  const desiredBase = Math.max(state.baseSequence, state.committedSequence - retentionLimit + 1);
  if (desiredBase <= state.baseSequence) return state;
  atomicWrite(prunePath(repoRoot, id), `${JSON.stringify({
    schema: PRUNE_SCHEMA,
    fromSequence: state.baseSequence,
    toSequence: desiredBase - 1,
  })}\n`);
  return completePrune(repoRoot, id, state);
}

function recoverPending(repoRoot, id, state, retentionLimit) {
  const pending = pendingValue(repoRoot, id);
  if (!pending) return state;
  if (pending.sequence <= state.committedSequence) {
    removeDurably(pendingPath(repoRoot, id));
    return state;
  }
  if (pending.sequence !== state.committedSequence + 1) {
    throw Object.assign(new Error(`Oven ${id} pending sequence is not contiguous.`), { code: "ECORRUPT" });
  }
  let event;
  try { event = readStoredOvenEvent(repoRoot, id, pending.eventId); }
  catch (error) {
    if (error?.code !== "ENOENT") throw error;
    if (existsSync(eventIndexPath(repoRoot, id, pending.sequence))) {
      throw Object.assign(new Error(`Oven ${id} pending index has no record.`), { code: "ECORRUPT" });
    }
    removeDurably(pendingPath(repoRoot, id));
    return state;
  }
  if (event.sequence !== pending.sequence || event.eventId !== pending.eventId || event.ovenId !== id) {
    throw Object.assign(new Error(`Oven ${id} pending record does not match.`), { code: "ECORRUPT" });
  }
  ensureIndex(repoRoot, event);
  const committed = { ...state, committedSequence: event.sequence };
  writeState(repoRoot, id, committed);
  removeDurably(pendingPath(repoRoot, id));
  return prune(repoRoot, id, committed, retentionLimit);
}

function ensureDirectories(repoRoot, id) {
  mkdirSync(streamPath(repoRoot, id, "records"), { recursive: true, mode: 0o700 });
  mkdirSync(streamPath(repoRoot, id, "sequence"), { recursive: true, mode: 0o700 });
}

export function publishStoredOvenEvent(repoRoot, draft, {
  retentionLimit = OVEN_EVENT_MAX_RETAINED_EVENTS,
  hooks = {},
} = {}) {
  if (!Number.isSafeInteger(retentionLimit) || retentionLimit < 1 || retentionLimit > OVEN_EVENT_MAX_RETAINED_EVENTS) {
    throw new Error(`Oven event retention limit must be from 1 to ${OVEN_EVENT_MAX_RETAINED_EVENTS}.`);
  }
  const id = draft.ovenId;
  ensureDirectories(repoRoot, id);
  let state = readOvenEventStreamState(repoRoot, id);
  if (!existsSync(statePath(repoRoot, id))) writeState(repoRoot, id, state);
  state = completePrune(repoRoot, id, state);
  state = recoverPending(repoRoot, id, state, retentionLimit);
  const recordPath = eventRecordPath(repoRoot, id, draft.eventId);
  if (existsSync(recordPath)) {
    const existing = readStoredOvenEvent(repoRoot, id, draft.eventId);
    if (existing.sequence >= state.baseSequence && existing.sequence <= state.committedSequence) {
      ensureIndex(repoRoot, existing);
      if (readIndexedOvenEvent(repoRoot, id, existing.sequence).eventId !== existing.eventId) {
        throw Object.assign(new Error("Oven event record has an invalid committed index."), { code: "ECORRUPT" });
      }
      return { event: existing, created: false, path: recordPath };
    }
    if (existing.sequence === state.committedSequence + 1) {
      ensureIndex(repoRoot, existing);
      state = { ...state, committedSequence: existing.sequence };
      writeState(repoRoot, id, state);
      state = prune(repoRoot, id, state, retentionLimit);
      return { event: existing, created: false, path: recordPath };
    }
    if (existing.sequence >= state.baseSequence) {
      throw Object.assign(new Error("Oven event record is outside the contiguous committed tail."), { code: "ECORRUPT" });
    }
    removeDurably(recordPath);
  }
  const sequence = state.committedSequence + 1;
  if (sequence > OVEN_EVENT_MAX_SEQUENCE) throw new Error(`Oven ${id} event sequence is exhausted.`);
  const event = assertOvenEvent({ ...draft, sequence });
  atomicWrite(pendingPath(repoRoot, id), `${JSON.stringify({
    schema: PENDING_SCHEMA, eventId: event.eventId, sequence,
  })}\n`);
  hooks.afterPendingWrite?.(event);
  atomicWrite(recordPath, serializeOvenEvent(event));
  hooks.afterRecordWrite?.(event);
  ensureIndex(repoRoot, event);
  hooks.afterIndexWrite?.(event);
  state = { ...state, committedSequence: sequence };
  writeState(repoRoot, id, state);
  hooks.afterCommitWrite?.(event);
  removeDurably(pendingPath(repoRoot, id));
  state = prune(repoRoot, id, state, retentionLimit);
  return { event, created: true, path: recordPath, state };
}
