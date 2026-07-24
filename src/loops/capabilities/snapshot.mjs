import { closeSync, constants, fsyncSync, fstatSync, lstatSync, mkdtempSync, openSync, readSync, rmdirSync, unlinkSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const MAX_EXECUTABLE_BYTES = 256 * 1024 * 1024;
function fail(message) { throw Object.assign(new Error(`Loop capability launch: ${message}`), { code: "ELOOP_CAPABILITY_CHANGED" }); }
function identity(stat) { return { dev: stat.dev, ino: stat.ino, size: stat.size, mode: stat.mode, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs }; }
function same(left, right) { return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mode === right.mode && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs; }
function sameDirectory(left, right) { return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode; }
function nofollow(path, flags = constants.O_RDONLY, mode) {
  return mode === undefined
    ? openSync(path, flags | (Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0))
    : openSync(path, flags | (Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0), mode);
}
function regular(path, maximum) {
  const entry = lstatSync(path); if (!entry.isFile() || entry.isSymbolicLink() || entry.size > maximum) fail(`invalid regular file ${path}`);
  let fd; try { fd = nofollow(path); const opened = fstatSync(fd); if (!opened.isFile() || !same(identity(entry), identity(opened))) fail(`replaced file ${path}`); return { fd, stat: identity(opened) }; } catch (error) { if (error?.code === "ELOOP") fail(`symbolic link ${path}`); throw error; }
}
function ancestorSnapshots(root, target) {
  const rootPath = resolve(root); const parts = target.slice(rootPath.length).split("/").filter(Boolean); const snapshots = [];
  let current = rootPath;
  for (const part of [null, ...parts.slice(0, -1)]) {
    if (part) current = join(current, part);
    const entry = lstatSync(current); if (!entry.isDirectory() || entry.isSymbolicLink()) fail(`invalid directory ancestor ${current}`);
    snapshots.push({ path: current, identity: identity(entry) });
  }
  return snapshots;
}
function checkAncestors(snapshots) { for (const item of snapshots) { const entry = lstatSync(item.path); if (!entry.isDirectory() || entry.isSymbolicLink() || !sameDirectory(item.identity, identity(entry))) fail(`directory changed ${item.path}`); } }
function digestRead(fd, size, maximum) {
  if (size > maximum) fail("file exceeds launch snapshot limit"); const hash = createHash("sha256"); const buffer = Buffer.allocUnsafe(Math.min(65536, Math.max(1, size))); let offset = 0;
  while (offset < size) { const amount = readSync(fd, buffer, 0, Math.min(buffer.length, size - offset), offset); if (amount <= 0) fail("file changed while snapshotting"); hash.update(buffer.subarray(0, amount)); offset += amount; }
  return `sha256:${hash.digest("hex")}`;
}
function copyExact(source, target, size) {
  const buffer = Buffer.allocUnsafe(Math.min(65536, Math.max(1, size))); let offset = 0;
  while (offset < size) {
    const amount = readSync(source, buffer, 0, Math.min(buffer.length, size - offset), offset);
    if (amount <= 0) fail("file changed while sealing");
    let written = 0;
    while (written < amount) {
      const next = writeSync(target, buffer, written, amount - written);
      if (next <= 0) fail("failed to seal launch bytes");
      written += next;
    }
    offset += amount;
  }
}
function sealExact(opened, snapshot) {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-launch-seal-"));
  const path = join(directory, "bytes"); let target; let sealed;
  try {
    target = nofollow(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    copyExact(opened.fd, target, opened.stat.size); fsyncSync(target); closeSync(target); target = undefined;
    sealed = nofollow(path); const state = fstatSync(sealed);
    if (!state.isFile() || state.size !== opened.stat.size || digestRead(sealed, state.size, snapshot.maximum) !== snapshot.digest)
      fail("sealed launch bytes do not match snapshot");
    unlinkSync(path); rmdirSync(directory);
    return sealed;
  } catch (error) {
    if (sealed !== undefined) closeSync(sealed);
    throw error;
  } finally {
    if (target !== undefined) closeSync(target);
    try { unlinkSync(path); } catch (error) { if (error?.code !== "ENOENT") throw error; }
    try { rmdirSync(directory); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  }
}

/** Snapshot descriptor identities and bytes required to make a launch decision. */
export function snapshotTarget({ root, path, kind = "file", maximum = MAX_EXECUTABLE_BYTES }) {
  const target = resolve(path); const ancestors = ancestorSnapshots(root, target); checkAncestors(ancestors);
  if (kind === "directory") { const entry = lstatSync(target); if (!entry.isDirectory() || entry.isSymbolicLink()) fail(`invalid directory ${target}`); const snapshot = { root: resolve(root), path: target, kind, ancestors, identity: identity(entry) }; checkSnapshot(snapshot); return snapshot; }
  const opened = regular(target, maximum);
  try { const digest = digestRead(opened.fd, opened.stat.size, maximum); const snapshot = { root: resolve(root), path: target, kind, ancestors, identity: opened.stat, digest, maximum }; checkSnapshot(snapshot); return snapshot; }
  finally { closeSync(opened.fd); }
}
export function checkSnapshot(snapshot) {
  checkAncestors(snapshot.ancestors);
  if (snapshot.kind === "directory") { const entry = lstatSync(snapshot.path); if (!entry.isDirectory() || entry.isSymbolicLink() || !same(snapshot.identity, identity(entry))) fail(`directory changed ${snapshot.path}`); return snapshot; }
  const opened = regular(snapshot.path, snapshot.maximum);
  try { if (!same(snapshot.identity, opened.stat) || digestRead(opened.fd, opened.stat.size, snapshot.maximum) !== snapshot.digest) fail(`file changed ${snapshot.path}`); }
  finally { closeSync(opened.fd); }
  return snapshot;
}
/**
 * Seal verified bytes into an unlinked private file before an external atomic commit.
 * A retained descriptor for the source inode is not safe: an in-place writer can alter
 * it without replacing the inode. The returned descriptor has no pathname and cannot
 * be changed through a later source-path replacement or write.
 */
export function holdSnapshot(snapshot) {
  if (snapshot?.kind !== "file") fail("only file snapshots can be held");
  checkAncestors(snapshot.ancestors); const opened = regular(snapshot.path, snapshot.maximum);
  let descriptor;
  try {
    if (!same(snapshot.identity, opened.stat) || digestRead(opened.fd, opened.stat.size, snapshot.maximum) !== snapshot.digest)
      fail(`file changed ${snapshot.path}`);
    checkAncestors(snapshot.ancestors);
    descriptor = sealExact(opened, snapshot);
    if (!same(snapshot.identity, identity(fstatSync(opened.fd))) || digestRead(opened.fd, opened.stat.size, snapshot.maximum) !== snapshot.digest)
      fail(`file changed ${snapshot.path}`);
    checkAncestors(snapshot.ancestors);
    return Object.freeze({ sealedDescriptor: descriptor, snapshot });
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  } finally { closeSync(opened.fd); }
}
export function releaseSnapshot(held) {
  if (!held || !Number.isInteger(held.sealedDescriptor)) fail("invalid held snapshot");
  closeSync(held.sealedDescriptor);
}
/** Bounded descriptor read for private records; caller receives only verified bytes. */
export function readSnapshotBytes({ root, path, maximum = 65536 }) {
  const target = resolve(path); const ancestors = ancestorSnapshots(root, target); checkAncestors(ancestors); const opened = regular(target, maximum);
  try {
    const bytes = Buffer.allocUnsafe(opened.stat.size); let offset = 0;
    while (offset < bytes.length) { const amount = readSync(opened.fd, bytes, offset, bytes.length - offset, offset); if (amount <= 0) fail(`file changed while reading ${target}`); offset += amount; }
    checkAncestors(ancestors); const after = fstatSync(opened.fd); const pathAfter = lstatSync(target);
    if (!same(opened.stat, identity(after)) || !same(opened.stat, identity(pathAfter))) fail(`file changed while reading ${target}`);
    return { bytes, identity: opened.stat, ancestors };
  } finally { closeSync(opened.fd); }
}
export function repoTarget(repoRoot, value) {
  const root = resolve(repoRoot); if (value !== "." && (!value || value.startsWith("/") || value.split("/").some((part) => !part || part === "." || part === ".."))) fail("invalid repository target");
  const path = resolve(root, value); if (!(path === root || path.startsWith(`${root}/`))) fail("repository target escapes root"); return path;
}
