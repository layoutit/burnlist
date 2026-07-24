import { randomBytes } from "node:crypto";
import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { rawSha256 } from "../dsl/hash.mjs";
import { RUN_REF } from "./run-ref.mjs";

// A 128-bit ULID has two unused high bits in its 26-character base32 form.
// Reject noncanonical overflow spellings rather than giving them a path.
export const RUN_ID = RUN_REF;
export const ARTIFACT = /^artifact:sha256:[a-f0-9]{64}$/u;
export const RAW_DIGEST = /^sha256:[a-f0-9]{64}$/u;
export const MAX_ARTIFACT_BYTES = 1024 * 1024;
export const MAX_RECORD_BYTES = 64 * 1024;
export const MAX_RECORDS = 256;
export const MAX_RUN_JOURNAL_BYTES = 4 * 1024 * 1024;
export const MAX_RUN_ARTIFACT_BYTES = 8 * 1024 * 1024;
export const MAX_RUN_ARTIFACTS = 128;
export const MAX_RUNS = 128;
export const MAX_CATALOG_JOURNAL_BYTES = 32 * 1024 * 1024;
export const MAX_GLOBAL_ARTIFACTS = 1024;
export const MAX_GLOBAL_ARTIFACT_BYTES = 64 * 1024 * 1024;

const BASE32 = "0123456789abcdefghjkmnpqrstvwxyz";
const SCHEMA = /^[a-z][a-z0-9-]{0,95}@[1-9][0-9]*$/u;
const TYPE = /^[a-z][a-z0-9-]{0,63}$/u;

export function fail(message, code = "ELOOP_RUN_STORE") {
  throw Object.assign(new Error(`Loop Run store: ${message}`), { code });
}

export function exact(value, keys) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key, index) => Object.keys(value)[index] === key);
}

export function validateRunId(value) {
  if (!RUN_ID.test(value)) fail("invalid RunRef");
  return value;
}

export function artifactDigest(bytes) {
  return `artifact:${rawSha256(bytes)}`;
}

export function artifactFileName(digest) {
  if (!ARTIFACT.test(digest)) fail("invalid artifact digest");
  return digest.slice("artifact:sha256:".length);
}

export function runDirectoryName(runId) { return validateRunId(runId).slice(4); }

export function newRunId({ now = Date.now, random = randomBytes } = {}) {
  const milliseconds = now();
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds >= 2 ** 48) fail("invalid RunRef clock");
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(milliseconds, 0, 6);
  const entropy = Buffer.from(random(10));
  if (entropy.length !== 10) fail("invalid RunRef entropy");
  entropy.copy(bytes, 6);
  let value = 0n;
  for (const byte of bytes) value = (value << 8n) | BigInt(byte);
  let encoded = "";
  for (let index = 0; index < 26; index += 1) { encoded = BASE32[Number(value & 31n)] + encoded; value >>= 5n; }
  return `run:${encoded}`;
}

function canonicalValue(value, depth = 0) {
  if (depth > 8) fail("journal payload exceeds depth");
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number") { if (!Number.isSafeInteger(value) || value < 0) fail("journal payload has invalid number"); return value; }
  if (Array.isArray(value)) {
    if (value.length > 256) fail("journal payload has too many array values");
    return value.map((item) => canonicalValue(item, depth + 1));
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) fail("journal payload is not JSON data");
  const keys = Object.keys(value).sort((left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right)));
  if (keys.length > 128 || keys.some((key) => !key || Buffer.byteLength(key) > 128 || /[\0\r\n]/u.test(key))) fail("journal payload has invalid key");
  return Object.fromEntries(keys.map((key) => [key, canonicalValue(value[key], depth + 1)]));
}

export function canonicalPayload(value) {
  const canonical = canonicalValue(value);
  const bytes = Buffer.from(JSON.stringify(canonical), "utf8");
  if (bytes.length > 32 * 1024) fail("journal payload exceeds bounds");
  return canonical;
}

export function validateArtifactDescriptor(value) {
  if (!exact(value, ["role", "digest", "schema", "mediaType", "byteLength", "revision"])
    || typeof value.role !== "string" || Buffer.byteLength(value.role) > 128
    || !ARTIFACT.test(value.digest) || typeof value.schema !== "string" || !SCHEMA.test(value.schema)
    || typeof value.mediaType !== "string" || !/^[a-z][a-z0-9.+-]{0,63}\/[a-z0-9.+-]{1,127}$/u.test(value.mediaType)
    || !Number.isSafeInteger(value.byteLength) || value.byteLength < 0 || value.byteLength > MAX_ARTIFACT_BYTES
    || typeof value.revision !== "string" || !/^(?:(?:er1|bp1|iv1)-sha256|sha256):[a-f0-9]{64}$/u.test(value.revision)) fail("invalid artifact descriptor");
  return Object.freeze({ role: value.role, digest: value.digest, schema: value.schema, mediaType: value.mediaType, byteLength: value.byteLength, revision: value.revision });
}

export function canonicalArtifactDescriptors(values) {
  if (!Array.isArray(values) || values.length > 128) fail("invalid artifact descriptor list");
  const descriptors = values.map(validateArtifactDescriptor).sort((left, right) => Buffer.compare(Buffer.from(left.role), Buffer.from(right.role)));
  if (descriptors.some((item, index) => index && item.role === descriptors[index - 1].role)) fail("duplicate artifact role");
  return Object.freeze(descriptors);
}

export function validateRecordType(value) { if (typeof value !== "string" || !TYPE.test(value)) fail("invalid journal record type"); return value; }

export function assertContained(root, target) {
  const parent = resolve(root), child = resolve(target), path = relative(parent, child);
  if (path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path))) return child;
  fail("state path escapes the Loop store");
}

export function assertDirectory(path, label = "directory") {
  const entry = lstatSync(path);
  if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077) !== 0) fail(`${label} is not a private real directory`);
  return entry;
}

/** Descriptor-bound binary read with no-follow and stable identity checks. */
export function readBoundedFile(path, maximum, label) {
  if (!Number.isSafeInteger(maximum) || maximum < 0) fail("invalid byte limit");
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > maximum || (before.mode & 0o077) !== 0) fail(`${label} is not a private bounded regular file`);
  let fd;
  try {
    const noFollow = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;
    try { fd = openSync(path, constants.O_RDONLY | noFollow); }
    catch (error) {
      if (error?.code === "ELOOP") fail(`${label} is a symbolic link`);
      if (!noFollow || !["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error?.code)) throw error;
      fd = openSync(path, constants.O_RDONLY);
    }
    const opened = fstatSync(fd);
    if (!opened.isFile() || opened.size > maximum || opened.dev !== before.dev || opened.ino !== before.ino) fail(`${label} changed while opening`);
    const bytes = readFileSync(fd);
    const completed = fstatSync(fd), after = lstatSync(path);
    if (bytes.length > maximum || completed.dev !== opened.dev || completed.ino !== opened.ino || completed.size !== opened.size
      || after.isSymbolicLink() || after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) fail(`${label} changed while reading`);
    return bytes;
  } finally { if (fd !== undefined) closeSync(fd); }
}

export function fsyncFile(path) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function fsyncDirectory(path) { fsyncFile(path); }
export function journalName(sequence) { if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > MAX_RECORDS) fail("invalid journal sequence"); return `${String(sequence).padStart(16, "0")}.json`; }
export function journalSequence(name) { const match = /^(\d{16})\.json$/u.exec(name); if (!match) return null; const value = Number(match[1]); return value >= 1 && value <= MAX_RECORDS ? value : null; }
export function statePath(root, ...segments) { return assertContained(root, join(root, ...segments)); }
export function cleanTempName(name) { return /^\.[a-z0-9-]{1,96}\.[a-f0-9]{16,64}\.tmp$/u.test(name); }
export function parentPath(path) { return dirname(path); }
export function fileBase(path) { return basename(path); }
