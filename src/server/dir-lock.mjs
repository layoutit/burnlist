import { randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { basename, dirname, join } from "node:path";

export const LOCK_MAX_AGE_MS = 15 * 60_000;
export const MAX_ATTEMPTS = 100;
export const RETRY_DELAY_MS = 20;
export const CANDIDATE_GC_AGE_MS = 2 * LOCK_MAX_AGE_MS;
export const CANDIDATE_CREATE_MAX_TRIES = 3;

const ownerName = (token) => `owner-${token}.json`;
const tokenPattern = /^[0-9a-f]{64}$/u;
const legacyTokenPattern = /^[0-9a-f]{24}$/u;
const safePid = (value) => Number.isSafeInteger(value) && value > 0;
const safeTime = (value) => Number.isFinite(value) && Number.isInteger(value) && value >= 0;
const sleepSync = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
const defaultFs = { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readdirSync, renameSync, rmdirSync, unlinkSync, writeSync };

export function processStartIdentity(pid, { exec = execFileSync, environment = process.env } = {}) {
  try {
    const value = exec("ps", ["-o", "lstart=", "-p", String(pid)],
      { encoding: "utf8", timeout: 1000, maxBuffer: 4096, env: { ...environment, LC_ALL: "C", LANG: "C" } }).trim().replace(/\s+/gu, " ");
    return value || null;
  } catch { return null; }
}

function ignored(error) {
  return error?.code === "ENOENT";
}

function harmlessRmdir(error) {
  return ignored(error) || error?.code === "ENOTEMPTY" || error?.code === "EEXIST";
}

function log(logger, error) {
  try { logger(error); } catch { /* logging must not alter lock behavior */ }
}

function fsyncDirectory(fs, path) {
  const fd = fs.openSync(path, constants.O_RDONLY);
  let primary;
  try { fs.fsyncSync(fd); } catch (error) { primary = error; }
  try { fs.closeSync(fd); } catch (error) { if (!primary) primary = error; }
  if (primary) throw primary;
}

function removeCandidate(fs, path, { logger, afterOwnerUnlink } = {}) {
  let entries;
  try { entries = fs.readdirSync(path, { withFileTypes: true }); } catch (error) {
    if (!ignored(error)) log(logger, error);
    return;
  }
  for (const entry of entries) {
    try { fs.unlinkSync(join(path, entry.name)); } catch (error) {
      if (!ignored(error)) log(logger, error);
    }
  }
  try { afterOwnerUnlink?.(); } catch (error) { log(logger, error); }
  try { fs.rmdirSync(path); } catch (error) {
    if (!ignored(error) && error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") log(logger, error);
  }
}

function parseRecord(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch { return null; }
}

function validV2(record, token) {
  return [1, 2].includes(record?.version) && safePid(record.pid) && typeof record.hostname === "string" && record.hostname !== ""
    && tokenPattern.test(record.token) && record.token === token && safeTime(record.createdAt)
    && (record.version === 1 || record.startedAt === null || typeof record.startedAt === "string" && record.startedAt.length > 0 && record.startedAt.length <= 128);
}

function legacyRecord(record) {
  if (!record || Object.hasOwn(record, "version") || !safePid(record.pid) || !legacyTokenPattern.test(record.token)
    || !safeTime(record.createdAt)) return null;
  // §7/2.3: v0.0.2 used a same-machine link()-based regular-file lock. Its
  // complete record is { pid, token, createdAt }; hostname was never stored.
  return !Object.hasOwn(record, "hostname") ? record : null;
}

function stale(record, now, hostname, pidProbe, reclaimLiveAfterAge, processIdentity) {
  if (record.hostname !== hostname) return false;
  return staleSameHost(record, now, pidProbe, reclaimLiveAfterAge, processIdentity);
}

function staleSameHost(record, now, pidProbe, reclaimLiveAfterAge = true, processIdentity = () => null) {
  let live = true;
  try { pidProbe(record.pid); } catch (error) { live = error?.code !== "ESRCH"; }
  if (!live) return true;
  if (record.version === 2 && record.startedAt !== null) {
    let identity = null; try { identity = processIdentity(record.pid); } catch { return false; }
    if (identity !== null && identity !== record.startedAt) return true;
  }
  return reclaimLiveAfterAge && now - record.createdAt >= LOCK_MAX_AGE_MS;
}

function inspectCanonical(fs, lockPath, { now, hostname, pidProbe, readFile, reclaimLiveAfterAge, processIdentity }) {
  const inspectionNow = now();
  let stat;
  try { stat = fs.lstatSync(lockPath); } catch (error) {
    if (ignored(error)) return { kind: "missing" };
    throw error;
  }
  if (stat.isSymbolicLink()) return { kind: "corrupt" };
  if (stat.isDirectory()) {
    let entries;
    try { entries = fs.readdirSync(lockPath, { withFileTypes: true }); } catch (error) {
      if (ignored(error)) return { kind: "missing" };
      throw error;
    }
    if (entries.length === 0) return { kind: "empty" };
    if (entries.length !== 1) return { kind: "corrupt" };
    const match = /^owner-([0-9a-f]{64})\.json$/u.exec(entries[0].name);
    if (!match) return { kind: "corrupt" };
    const path = join(lockPath, entries[0].name);
    let ownerStat;
    try { ownerStat = fs.lstatSync(path); } catch (error) {
      if (ignored(error)) return { kind: "missing" };
      throw error;
    }
    if (!ownerStat.isFile()) return { kind: "corrupt" };
    let record;
    try { record = parseRecord(readFile(path, "utf8")); } catch (error) {
      if (ignored(error)) return { kind: "missing" };
      throw error;
    }
    if (!validV2(record, match[1])) return { kind: "corrupt" };
    return { kind: "v2", record, token: match[1], stale: stale(record, inspectionNow, hostname, pidProbe, reclaimLiveAfterAge, processIdentity) };
  }
  if (!stat.isFile()) return { kind: "corrupt" };
  let text;
  try { text = readFile(lockPath, "utf8"); } catch (error) {
    if (ignored(error)) return { kind: "missing" };
    throw error;
  }
  const record = legacyRecord(parseRecord(text));
  if (!record) return { kind: "corrupt" };
  // Only v2 directory records use hostname as a cross-host safety boundary.
  return { kind: "legacy", record, text, stale: staleSameHost(record, inspectionNow, pidProbe, reclaimLiveAfterAge) };
}

function buildCandidate(fs, lockPath, context) {
  const { hostname, now, token, logger, hooks } = context;
  const parent = dirname(lockPath);
  fs.mkdirSync(parent, { recursive: true });
  let candidate;
  let lastError;
  for (let count = 0; count < CANDIDATE_CREATE_MAX_TRIES; count += 1) {
    const value = token();
    const createdAt = now();
    candidate = `${lockPath}.candidate.${value}`;
    try { fs.mkdirSync(candidate, { mode: 0o700 }); } catch (error) {
      lastError = error;
      if (error?.code === "EEXIST") continue;
      throw error;
    }
    try {
      hooks.afterCandidateDirectory?.({ candidate, token: value });
      const path = join(candidate, ownerName(value));
      const record = `${JSON.stringify({ version: 2, pid: process.pid, hostname, token: value, createdAt, startedAt: context.processIdentity(process.pid) })}\n`;
      const bytes = Buffer.from(record, "utf8");
      const fd = fs.openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
      let primary;
      try {
        let offset = 0;
        while (offset < bytes.length) {
          const written = fs.writeSync(fd, bytes, offset, bytes.length - offset);
          if (!Number.isSafeInteger(written) || written <= 0) throw new Error("Could not write complete lock owner record.");
          offset += written;
        }
        fs.fsyncSync(fd);
      } catch (error) { primary = error; }
      try { fs.closeSync(fd); } catch (error) { if (!primary) primary = error; }
      if (primary) throw primary;
      hooks.afterCandidateOwner?.({ candidate, token: value });
      fsyncDirectory(fs, candidate);
      return { candidate, token: value };
    } catch (error) {
      removeCandidate(fs, candidate, { logger });
      throw error;
    }
  }
  throw lastError;
}

function release(fs, lockPath, token, { logger, hooks }) {
  try { hooks.beforeReleaseUnlink?.({ token }); } catch (error) { log(logger, error); }
  let unlinkWorked = false;
  try { fs.unlinkSync(join(lockPath, ownerName(token))); unlinkWorked = true; } catch (error) {
    if (!ignored(error)) { log(logger, error); return; }
  }
  if (unlinkWorked) {
    try { hooks.betweenReleaseUnlinkAndRmdir?.({ token }); } catch (error) { log(logger, error); }
  }
  try { fs.rmdirSync(lockPath); } catch (error) { if (!harmlessRmdir(error)) log(logger, error); }
}

function reclaimLegacy(fs, lockPath, { record, text }, readFile) {
  let stat;
  try { stat = fs.lstatSync(lockPath); } catch (error) { if (ignored(error)) return; throw error; }
  if (!stat.isFile()) return;
  let current;
  try { current = readFile(lockPath, "utf8"); } catch (error) { if (ignored(error)) return; throw error; }
  const currentRecord = legacyRecord(parseRecord(current));
  if (current !== text || !currentRecord || currentRecord.token !== record.token) return;
  try { fs.unlinkSync(lockPath); } catch (error) {
    if (ignored(error) || error?.code === "EISDIR") return;
    if (error?.code !== "EPERM") throw error;
    let stat;
    try { stat = fs.lstatSync(lockPath); } catch (again) { if (ignored(again)) return; throw again; }
    if (stat.isDirectory() || stat.isSymbolicLink() || !stat.isFile()) return;
    throw error;
  }
}

function gc(fs, lockPath, context) {
  const parent = dirname(lockPath);
  const candidatePrefix = `${basename(lockPath)}.candidate.`;
  let entries;
  try { entries = fs.readdirSync(parent, { withFileTypes: true }); } catch (error) { log(context.logger, error); return; }
  const gcNow = context.now();
  for (const entry of entries) {
    const suffix = entry.name.slice(candidatePrefix.length);
    if (entry.name.length !== candidatePrefix.length + 64 || !entry.name.startsWith(candidatePrefix) || !tokenPattern.test(suffix)) continue;
    const path = join(parent, entry.name);
    try {
      const stat = fs.lstatSync(path);
      if (!stat.isDirectory() || gcNow - stat.mtimeMs < CANDIDATE_GC_AGE_MS) continue;
      removeCandidate(fs, path, { logger: context.logger, afterOwnerUnlink: () => context.hooks.afterGcOwnerUnlink?.({ candidate: path }) });
    } catch (error) { log(context.logger, error); }
  }
}

/** Test seams are deliberately optional; production callers use only lockPath, fn, and errorFactory. */
export function withDirectoryLock({ lockPath, fn, errorFactory, adapters = {}, hooks = {}, reclaimLiveAfterAge = true }) {
  const fs = { ...defaultFs, ...adapters.fs };
  const context = {
    hostname: adapters.hostname?.() ?? os.hostname(), now: adapters.now ?? Date.now,
    pidProbe: adapters.pidProbe ?? ((pid) => process.kill(pid, 0)), sleep: adapters.sleep ?? sleepSync,
    processIdentity: adapters.processIdentity ?? processStartIdentity,
    token: adapters.token ?? (() => randomBytes(32).toString("hex")), logger: adapters.logger ?? (() => {}),
    readFile: adapters.readFileSync ?? readFileSync, hooks, reclaimLiveAfterAge,
  };
  if (typeof context.hostname !== "string" || context.hostname === "") throw new Error("Cannot create a lock without a hostname.");
  fs.mkdirSync(dirname(lockPath), { recursive: true });
  gc(fs, lockPath, context);
  let candidate = buildCandidate(fs, lockPath, context);
  let holderPid = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try { hooks.beforePublication?.({ attempt, ...candidate }); } catch (error) { removeCandidate(fs, candidate.candidate, context); throw error; }
    let renameError;
    try {
      fs.renameSync(candidate.candidate, lockPath);
    } catch (error) { renameError = error; }
    if (!renameError) {
      const mine = candidate;
      candidate = null;
      try { hooks.afterPublication?.({ attempt, ...mine }); } catch (error) { release(fs, lockPath, mine.token, context); throw error; }
      let owner;
      try { owner = fs.lstatSync(join(lockPath, ownerName(mine.token))); } catch (error) {
        if (!ignored(error)) { release(fs, lockPath, mine.token, context); throw error; }
        try { fs.rmdirSync(lockPath); } catch (rmdirError) { if (!harmlessRmdir(rmdirError)) log(context.logger, rmdirError); }
        candidate = buildCandidate(fs, lockPath, context);
        if (attempt < MAX_ATTEMPTS) context.sleep(RETRY_DELAY_MS);
        continue;
      }
      if (!owner.isFile()) { release(fs, lockPath, mine.token, context); throw new Error(`Lock owner is corrupt: ${lockPath}`); }
      try { fsyncDirectory(fs, dirname(lockPath)); } catch (error) { release(fs, lockPath, mine.token, context); throw error; }
      try { hooks.afterSelfCheck?.({ attempt, ...mine }); } catch (error) { release(fs, lockPath, mine.token, context); throw error; }
      let result;
      let callbackError;
      try { result = fn(); } catch (error) { callbackError = error; }
      release(fs, lockPath, mine.token, context);
      if (callbackError) throw callbackError;
      return result;
    }
    if (renameError?.code !== "EEXIST" && renameError?.code !== "ENOTEMPTY" && renameError?.code !== "ENOTDIR" && renameError?.code !== "ENOENT") {
      removeCandidate(fs, candidate.candidate, context);
      throw renameError;
    }
    if (renameError?.code === "ENOENT") {
      let source;
      try { source = fs.lstatSync(candidate.candidate); } catch (sourceError) {
        if (!ignored(sourceError)) { removeCandidate(fs, candidate.candidate, context); throw sourceError; }
        candidate = buildCandidate(fs, lockPath, context);
        if (attempt < MAX_ATTEMPTS) context.sleep(RETRY_DELAY_MS);
        continue;
      }
      if (!source.isDirectory()) { removeCandidate(fs, candidate.candidate, context); throw new Error(`Lock candidate is corrupt: ${candidate.candidate}`); }
      fs.mkdirSync(dirname(lockPath), { recursive: true });
      if (attempt < MAX_ATTEMPTS) context.sleep(RETRY_DELAY_MS);
      continue;
    }
    const observed = inspectCanonical(fs, lockPath, context);
    holderPid = observed.record?.pid ?? holderPid;
    if ((observed.kind === "v2" || observed.kind === "legacy") && observed.stale) {
      try { hooks.afterStaleJudgment?.({ attempt, token: observed.token, legacy: observed.kind === "legacy" }); } catch (hookError) { removeCandidate(fs, candidate.candidate, context); throw hookError; }
      if (observed.kind === "v2") {
        try { fs.unlinkSync(join(lockPath, ownerName(observed.token))); } catch (unlinkError) { if (!ignored(unlinkError)) { removeCandidate(fs, candidate.candidate, context); throw unlinkError; } }
        try { hooks.afterStaleOwnerUnlink?.({ attempt, token: observed.token }); } catch (hookError) { removeCandidate(fs, candidate.candidate, context); throw hookError; }
        try { fs.rmdirSync(lockPath); } catch (rmdirError) { if (!harmlessRmdir(rmdirError)) { removeCandidate(fs, candidate.candidate, context); throw rmdirError; } }
      } else reclaimLegacy(fs, lockPath, observed, context.readFile);
    }
    if (attempt < MAX_ATTEMPTS) context.sleep(RETRY_DELAY_MS);
  }
  if (candidate) removeCandidate(fs, candidate.candidate, context);
  throw errorFactory({ holderPid, lockPath });
}
