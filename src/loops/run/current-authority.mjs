import { closeSync, constants, fstatSync, fsyncSync, lstatSync, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { isRunRef } from "./run-ref.mjs";

const MAX_BYTES = 65_536, MAX_ITEMS = 128;
const ITEM = /^item:[0-9]{6}-[0-9]{3}#[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const ASSIGNMENT = /^as1-sha256:[a-f0-9]{64}$/u;
const fail = (message) => { throw Object.assign(new Error(`Current Run authority: ${message}`), { code: "ECURRENT" }); };
const same = (left, right) => left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mode === right.mode;

function ancestors(root, base) {
  const canonicalRoot = resolve(root), canonicalBase = resolve(base), tail = relative(canonicalRoot, canonicalBase);
  if (tail === ".." || tail.startsWith(`..${sep}`)) fail("authority root escapes repository");
  const paths = [canonicalRoot]; let current = canonicalRoot;
  for (const part of tail ? tail.split(sep) : []) { current = join(current, part); paths.push(current); }
  return paths.map((path) => { const stat = lstatSync(path); if (!stat.isDirectory() || stat.isSymbolicLink()) fail("authority ancestor is unsafe"); return { path, dev: stat.dev, ino: stat.ino }; });
}
function assertAncestors(values) {
  for (const expected of values) { const stat = lstatSync(expected.path); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== expected.dev || stat.ino !== expected.ino) fail("authority ancestor changed"); }
}
function parse(bytes) {
  let value; try { value = JSON.parse(bytes); } catch { fail("authority is not JSON"); }
  if (!value || Object.keys(value).length !== 2 || value.schema !== "burnlist-loop-current-runs@1" || !Array.isArray(value.items) || value.items.length > MAX_ITEMS || !Buffer.from(`${JSON.stringify(value)}\n`).equals(bytes)) fail("authority is not canonical");
  const items = value.items.map((entry) => {
    if (!entry || Object.keys(entry).length !== 3 || !ITEM.test(entry.itemRef) || !isRunRef(entry.runId) || !ASSIGNMENT.test(entry.assignmentId)) fail("authority item is invalid");
    return Object.freeze({ itemRef: entry.itemRef, runId: entry.runId, assignmentId: entry.assignmentId });
  });
  if (new Set(items.map((item) => item.itemRef)).size !== items.length || items.some((item, index) => index && items[index - 1].itemRef >= item.itemRef)) fail("authority items are unordered or duplicate");
  return Object.freeze(items);
}

export function currentRunAuthority({ root, base, random }) {
  const target = join(base, "current-runs.json");
  function read() {
    const anchored = ancestors(root, base); let fd;
    try {
      let leaf; try { leaf = lstatSync(target); } catch (error) { if (error?.code === "ENOENT") return Object.freeze([]); throw error; }
      if (!leaf.isFile() || leaf.isSymbolicLink() || (leaf.mode & 0o777) !== 0o600 || leaf.size < 2 || leaf.size > MAX_BYTES) fail("authority file is unsafe");
      fd = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0)); const before = fstatSync(fd);
      if (!before.isFile() || !same(leaf, before) || (before.mode & 0o777) !== 0o600 || before.size > MAX_BYTES) fail("authority changed while opening");
      const bytes = Buffer.alloc(before.size); if (readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) fail("authority changed while reading");
      const after = fstatSync(fd), linked = lstatSync(target); if (!same(before, after) || !same(before, linked) || linked.isSymbolicLink()) fail("authority changed while reading");
      assertAncestors(anchored); return parse(bytes);
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  function write(items) {
    const anchored = ancestors(root, base), ordered = [...items].sort((a, b) => a.itemRef.localeCompare(b.itemRef));
    const checked = parse(Buffer.from(`${JSON.stringify({ schema: "burnlist-loop-current-runs@1", items: ordered })}\n`));
    const bytes = Buffer.from(`${JSON.stringify({ schema: "burnlist-loop-current-runs@1", items: checked })}\n`), temporary = join(base, `.current-runs.${random(8).toString("hex")}.tmp`); let fd;
    try {
      fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
      assertAncestors(anchored); renameSync(temporary, target); const directory = openSync(base, constants.O_RDONLY); try { fsyncSync(directory); } finally { closeSync(directory); }
    } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
  }
  return Object.freeze({ read, write, target });
}
