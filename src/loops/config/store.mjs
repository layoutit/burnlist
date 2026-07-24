import { randomBytes } from "node:crypto";
import { closeSync, constants, fchmodSync, fsyncSync, lstatSync, mkdirSync, openSync, renameSync, rmdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { withDirectoryLock } from "../../server/dir-lock.mjs";
import { checkSnapshot, readSnapshotBytes, snapshotTarget } from "../capabilities/snapshot.mjs";
import { rawSha256 } from "../dsl/hash.mjs";

const NAME = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u;
export const MAX_LOCAL_RECORD_BYTES = 65536;

function fail(message, code = "ELOOP_CONFIG") { throw Object.assign(new Error(`Loop local config: ${message}`), { code }); }
function sync(path) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function exact(value, keys) { return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key, index) => Object.keys(value)[index] === key); }
function boundedName(value, label) { if (typeof value !== "string" || !NAME.test(value) || Buffer.byteLength(value) > 128) fail(`invalid ${label}`); return value; }

export const LOOP_CONFIG_SCHEMA = "burnlist-loop-local-config@1";
export const configRoot = (repoRoot) => join(resolve(repoRoot), ".local", "burnlist", "loop", "config-v1");

/** Shared ancestors may use normal repository permissions; config-v1 and descendants are private. */
function secureDirectory(repoRoot, path) {
  const root = resolve(repoRoot), target = resolve(path), rel = relative(root, target);
  if (rel === "" || isAbsolute(rel) || rel.split(sep).includes("..")) fail("config directory escapes repository");
  let current = root, privateZone = false;
  for (const part of rel.split(sep)) {
    current = join(current, part); privateZone ||= part === "config-v1";
    try {
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (privateZone && (stat.mode & 0o777) !== 0o700)) fail(`unsafe config directory ${current}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      mkdirSync(current, { mode: privateZone ? 0o700 : 0o755 });
      const stat = lstatSync(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || (privateZone && (stat.mode & 0o777) !== 0o700)) fail(`unsafe config directory ${current}`);
      try { sync(dirname(current)); } catch { /* directory fsync is unsupported on some platforms */ }
    }
  }
  return snapshotTarget({ root, path: target, kind: "directory" });
}

/** Read-side counterpart to secureDirectory: inspect only, never create. */
function assertPrivateConfigRoot(repoRoot) {
  const root = resolve(repoRoot), target = configRoot(root), rel = relative(root, target);
  if (rel === "" || isAbsolute(rel) || rel.split(sep).includes("..")) fail("config directory escapes repository");
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (part === "config-v1" && (stat.mode & 0o777) !== 0o700)) fail(`unsafe config directory ${current}`);
  }
}

function filePath(repoRoot, collection, name) {
  boundedName(collection, "collection"); boundedName(name, "record name");
  return join(configRoot(repoRoot), `${collection}--${name}.json`);
}
function privateFile(path, stat) {
  // readSnapshotBytes already proved a no-follow regular file; its identity is plain data.
  if (!stat || (stat.mode & 0o077) !== 0) fail(`unsafe config record ${path}`);
}
function canonicalBytes(value, validate) {
  const canonical = Buffer.from(`${JSON.stringify(validate(value))}\n`, "utf8");
  if (canonical.length > MAX_LOCAL_RECORD_BYTES) fail("record exceeds byte limit");
  return canonical;
}
function checkSameDirectory(snapshot) {
  const stat = lstatSync(snapshot.path);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== snapshot.identity.dev || stat.ino !== snapshot.identity.ino || stat.mode !== snapshot.identity.mode) fail(`directory identity changed ${snapshot.path}`);
}

export function localRecordPath(repoRoot, collection, name) { return filePath(repoRoot, collection, name); }

export function readLocalRecord({ repoRoot, collection, name, validate }) {
  const path = filePath(repoRoot, collection, name); let read;
  try { assertPrivateConfigRoot(repoRoot); read = readSnapshotBytes({ root: resolve(repoRoot), path, maximum: MAX_LOCAL_RECORD_BYTES }); }
  catch (error) {
    if (error?.code === "ENOENT") throw Object.assign(new Error(`Loop local config: ${collection}/${name} is missing`), { code: "ELOOP_CONFIG_MISSING" });
    throw error;
  }
  privateFile(path, read.identity);
  let parsed; try { parsed = JSON.parse(read.bytes.toString("utf8")); } catch { fail(`${collection}/${name} is not JSON`); }
  const value = validate(parsed), canonical = canonicalBytes(value, validate);
  if (!canonical.equals(read.bytes)) fail(`${collection}/${name} is not canonical`);
  return value;
}

/** Copy a configured executable into the fixed private config directory before launch. */
export function createPrivateExecutableSnapshot({ repoRoot, sourcePath, expectedDigest }) {
  const root = resolve(repoRoot), config = configRoot(root); secureDirectory(root, config);
  return withDirectoryLock({ lockPath: join(config, ".config.lock"), errorFactory: () => fail("configuration lock unavailable"), fn() {
    const parent = secureDirectory(root, config);
    const source = readSnapshotBytes({ root: dirname(resolve(sourcePath)), path: sourcePath, maximum: 64 * 1024 * 1024 });
    const digest = rawSha256(source.bytes);
    if (digest !== expectedDigest) fail("configured executable changed before private snapshot", "ELOOP_CONFIG_QUARANTINED");
    const token = randomBytes(12).toString("hex"), staging = join(config, `.controller-${token}`), temporary = join(staging, "controller.tmp"), path = join(staging, "controller.exec"); let fd, published = false;
    try {
      mkdirSync(staging, { mode: 0o700 }); checkSameDirectory(parent);
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o700);
      writeFileSync(fd, source.bytes); fchmodSync(fd, 0o500); fsyncSync(fd); closeSync(fd); fd = undefined;
      renameSync(temporary, path); published = true; sync(staging); checkSameDirectory(parent); sync(config);
      const snapshot = snapshotTarget({ root: staging, path, maximum: 64 * 1024 * 1024 });
      if (snapshot.digest !== digest || (snapshot.identity.mode & 0o777) !== 0o500) fail("private executable snapshot postcondition failed", "ELOOP_CONFIG_QUARANTINED");
      return { path, digest, snapshot, staging };
    } catch (error) {
      if (published) fail(`private executable snapshot is quarantined: ${error.message}`, "ELOOP_CONFIG_QUARANTINED");
      throw error;
    } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); if (!published) rmSync(staging, { recursive: true, force: true }); }
  } });
}

export function removePrivateExecutableSnapshot(snapshot) {
  try {
    checkSnapshot(snapshot);
    const staging = dirname(snapshot.path);
    unlinkSync(snapshot.path); sync(staging); rmdirSync(staging); sync(dirname(staging));
  } catch (error) { fail(`private executable snapshot is quarantined: ${error.message}`, "ELOOP_CONFIG_QUARANTINED"); }
}


/**
 * All records share one fixed private directory. Cooperating writers are
 * serialized by its identity-bound lock; hostile same-user replacement still
 * requires OS isolation and is only detected at boundaries.
 */
export function writeLocalRecord({ repoRoot, collection, name, value, validate, hooks = {}, replaceInvalidCodes = [] }) {
  const root = resolve(repoRoot), path = filePath(root, collection, name), canonical = canonicalBytes(value, validate);
  const config = configRoot(root); secureDirectory(root, config);
  return withDirectoryLock({ lockPath: join(config, ".config.lock"), errorFactory: () => fail("configuration lock unavailable"), fn() {
    const targetParent = secureDirectory(root, config);
    try {
      const current = readLocalRecord({ repoRoot: root, collection, name, validate });
      if (canonicalBytes(current, validate).equals(canonical)) return current;
    } catch (error) { if (error?.code !== "ELOOP_CONFIG_MISSING" && !replaceInvalidCodes.includes(error?.code)) throw error; }
    const token = randomBytes(12).toString("hex"), temporary = join(config, `.${collection}--${name}.${token}.tmp`); let fd, published = false;
    try {
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
      writeFileSync(fd, canonical); fsyncSync(fd); closeSync(fd); fd = undefined;
      if ((lstatSync(temporary).mode & 0o077) !== 0) fail("temporary config record is not private");
      hooks.beforePublish?.({ path, temporary });
      checkSameDirectory(targetParent);
      hooks.beforeRename?.({ path, temporary });
      checkSameDirectory(targetParent);
      renameSync(temporary, path); published = true;
      hooks.afterPublish?.({ path });
      checkSameDirectory(targetParent);
      const current = readLocalRecord({ repoRoot: root, collection, name, validate });
      if (!canonicalBytes(current, validate).equals(canonical)) fail("published record postcondition failed");
      sync(dirname(path)); return current;
    } catch (error) {
      if (published) fail(`publication postcondition failed; configuration is quarantined: ${error.message}`, "ELOOP_CONFIG_QUARANTINED");
      throw error;
    } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
  } });
}

export function isClosedObject(value, keys) { return exact(value, keys); }
