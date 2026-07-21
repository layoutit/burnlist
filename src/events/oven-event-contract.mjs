import { createHash } from "node:crypto";
import { ovenId } from "../ovens/oven-contract.mjs";

export const OVEN_EVENT_SCHEMA = "burnlist-oven-event@1";
export const OVEN_EVENT_AUTHORITY = "observational";
export const OVEN_EVENT_MAX_BYTES = 32 * 1024;

const eventIdPattern = /^oe1-[a-f0-9]{64}$/u;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

function plainObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function exactKeys(value, keys, label) {
  if (!plainObject(value)) throw new Error(`${label} must be an object.`);
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) throw new Error(`${label} contains unsupported field "${key}".`);
  }
}

function boundedText(value, label, maxLength) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label} is required.`);
  if (value !== value.trim() || value.length > maxLength || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`${label} must be trimmed printable text no longer than ${maxLength} characters.`);
  }
  return value;
}

function slug(value, label) {
  const normalized = boundedText(value, label, 48);
  if (!slugPattern.test(normalized)) throw new Error(`${label} must be a lowercase slug.`);
  return normalized;
}

function timestamp(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)) {
    throw new Error("Oven event occurredAt must be an ISO timestamp.");
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("Oven event occurredAt must be an ISO timestamp.");
  return new Date(parsed).toISOString();
}

function jsonValue(value, label, depth = 0) {
  if (depth > 8) throw new Error(`${label} is nested too deeply.`);
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} contains a non-finite number.`);
    return value;
  }
  if (typeof value === "string") {
    if (value.length > 4_096) throw new Error(`${label} contains text longer than 4096 characters.`);
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 128) throw new Error(`${label} contains more than 128 array entries.`);
    return value.map((entry, index) => jsonValue(entry, `${label}[${index}]`, depth + 1));
  }
  if (!plainObject(value)) throw new Error(`${label} must contain JSON values only.`);
  const entries = Object.entries(value);
  if (entries.length > 64) throw new Error(`${label} contains more than 64 fields.`);
  const normalizedEntries = [];
  for (const [key, entry] of entries) {
    if (!key || key.length > 80 || /[\u0000-\u001f\u007f]/u.test(key)) throw new Error(`${label} contains an invalid field name.`);
    normalizedEntries.push([key, jsonValue(entry, `${label}.${key}`, depth + 1)]);
  }
  return Object.fromEntries(normalizedEntries);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (plainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function serializeOvenEvent(value) {
  return `${JSON.stringify(value)}\n`;
}

function assertSerializedSize(value, suffix = "") {
  if (Buffer.byteLength(serializeOvenEvent(value)) > OVEN_EVENT_MAX_BYTES) {
    throw new Error(`Oven event is larger than ${OVEN_EVENT_MAX_BYTES} bytes${suffix}.`);
  }
}

export function ovenEventId(value) {
  const identity = canonicalJson({
    schema: OVEN_EVENT_SCHEMA,
    ovenId: ovenId(value.ovenId),
    subjectId: boundedText(value.subjectId, "Oven event subjectId", 160),
    kind: slug(value.kind, "Oven event kind"),
    phase: slug(value.phase, "Oven event phase"),
    cursor: boundedText(value.cursor, "Oven event cursor", 200),
  });
  return `oe1-${createHash("sha256").update(identity).digest("hex")}`;
}

export function normalizeOvenEvent(value, { now = () => new Date().toISOString() } = {}) {
  exactKeys(value, new Set(["ovenId", "subjectId", "kind", "phase", "cursor", "occurredAt", "payload"]), "Oven event input");
  const event = {
    schema: OVEN_EVENT_SCHEMA,
    authority: OVEN_EVENT_AUTHORITY,
    eventId: ovenEventId(value),
    ovenId: ovenId(value.ovenId),
    subjectId: boundedText(value.subjectId, "Oven event subjectId", 160),
    kind: slug(value.kind, "Oven event kind"),
    phase: slug(value.phase, "Oven event phase"),
    cursor: boundedText(value.cursor, "Oven event cursor", 200),
    occurredAt: timestamp(value.occurredAt ?? now()),
    payload: (() => {
      const payload = value.payload ?? {};
      if (!plainObject(payload)) throw new Error("Oven event payload must be an object.");
      return jsonValue(payload, "Oven event payload");
    })(),
  };
  assertSerializedSize(event);
  return event;
}

export function assertOvenEvent(value) {
  exactKeys(value, new Set([
    "schema", "authority", "eventId", "sequence", "ovenId", "subjectId", "kind", "phase", "cursor", "occurredAt", "payload",
  ]), "Oven event");
  if (value.schema !== OVEN_EVENT_SCHEMA || value.authority !== OVEN_EVENT_AUTHORITY || !eventIdPattern.test(value.eventId ?? "")) {
    throw new Error("Oven event schema, authority, or eventId is invalid.");
  }
  if (!Number.isSafeInteger(value.sequence) || value.sequence < 1) throw new Error("Oven event sequence must be a positive integer.");
  const normalized = { ...normalizeOvenEvent({
    ovenId: value.ovenId,
    subjectId: value.subjectId,
    kind: value.kind,
    phase: value.phase,
    cursor: value.cursor,
    occurredAt: value.occurredAt,
    payload: value.payload,
  }, { now: () => value.occurredAt }), sequence: value.sequence };
  assertSerializedSize(normalized, " after sequencing");
  if (normalized.eventId !== value.eventId || canonicalJson(normalized) !== canonicalJson(value)) {
    throw new Error("Oven event does not match its canonical identity.");
  }
  return normalized;
}
