import { randomBytes } from "node:crypto";
import {
  appendFileSync, chmodSync, closeSync, constants, fchmodSync, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync,
  readFileSync, readSync, readdirSync, renameSync, writeFileSync,
} from "node:fs";
import { join } from "node:path";

function fail(message) { throw new Error(`Assignment artifact: ${message}`); }
function identity(stat) { return `${stat.dev}:${stat.ino}`; }
const authority = [];
function marker(stat) { return `${stat.ctimeMs}:${stat.mtimeMs}`; }
function remember(path, stat) { authority.push({ path, identity: identity(stat), marker: marker(stat), mode: stat.mode & 0o777 }); }
function refreshParent() {
  if (!authority.length) return;
  const stat = lstatSync(".."), parent = authority.at(-1);
  if (identity(stat) !== parent.identity) fail("ancestor authority changed");
  parent.marker = marker(stat);
}
function validateAuthority() {
  for (let index = 0; index < authority.length; index += 1) {
    const expected = authority[index], stat = lstatSync(expected.path);
    if (stat.isSymbolicLink() || !stat.isDirectory() || identity(stat) !== expected.identity || (stat.mode & 0o777) !== expected.mode) fail("ancestor authority changed");
    if (marker(stat) !== expected.marker) fail(`ancestor authority mutation detected ${expected.path}`);
  }
}
function refreshCurrent() {
  const current = authority.at(-1), stat = lstatSync(".");
  if (identity(stat) !== current.identity || (stat.mode & 0o777) !== current.mode) fail("current authority changed");
  current.marker = marker(stat);
}
function regular(path, limit) {
  const before = lstatSync(path);
  if (before.isSymbolicLink() || !before.isFile() || (before.mode & 0o777) !== 0o600 || before.size > limit) fail(`${path} is not a bounded private regular file`);
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const opened = fstatSync(fd);
    if (!opened.isFile() || identity(opened) !== identity(before) || opened.size !== before.size || (opened.mode & 0o777) !== 0o600) fail(`${path} changed while opening`);
    if (testCut === `grow:${path}`) appendFileSync(path, "x");
    const bounded = Buffer.alloc(limit + 1); let offset = 0, count;
    do { count = readSync(fd, bounded, offset, bounded.length - offset, null); offset += count; } while (count && offset < bounded.length);
    const after = fstatSync(fd);
    if (offset !== opened.size || offset > limit || after.size !== opened.size || identity(after) !== identity(opened) || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) fail(`${path} changed while reading`);
    return bounded.subarray(0, offset);
  } finally { if (fd !== undefined) closeSync(fd); }
}
function cwd(expected, mode) {
  const stat = lstatSync(".");
  if (!stat.isDirectory() || identity(stat) !== expected || (mode && (stat.mode & 0o777) !== mode)) fail("anchored directory authority changed");
}
function enter(name, create, mode) {
  validateAuthority();
  let before, created = false;
  try { before = lstatSync(name); } catch (error) {
    if (error?.code !== "ENOENT" || !create) throw error;
    mkdirSync(name, { mode: 0o700 }); chmodSync(name, 0o700); before = lstatSync(name); created = true;
  }
  if (before.isSymbolicLink() || !before.isDirectory() || (mode && (before.mode & 0o777) !== mode)) fail(`unsafe directory ${name}`);
  const path = join(authority.at(-1).path, name);
  process.chdir(name); cwd(identity(before), mode); if (created) refreshParent(); remember(path, before); validateAuthority();
}
function enterRoot(create) {
  for (const part of [".local", "burnlist", "loop", "v2"]) enter(part, create);
  enter("assignments", create, 0o700);
}
function durable(path, bytes) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), 0o600);
  try { fchmodSync(fd, 0o600); writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function members(allowedTemp = null) {
  const entries = readdirSync(".", { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === allowedTemp && entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (!/^[a-f0-9]{64}$/u.test(entry.name) || !entry.isDirectory() || entry.isSymbolicLink()) fail("assignment root contains an unexpected entry");
  }
  return entries.map((entry) => entry.name).sort();
}
function input() { return JSON.parse(readFileSync(0, "utf8")); }

const [command, expected, testCut] = process.argv.slice(2);
const payload = input();
cwd(expected); remember(process.cwd(), lstatSync("."));
if (command === "load") {
  const { name, outside } = payload; enterRoot(false); enter(name, false, 0o700);
  validateAuthority();
  const manifest = regular("manifest.json", 16 * 1024);
  if (testCut === "move-leaf-between-files") renameSync(`../${name}`, `${outside}/${name}.moved`);
  validateAuthority();
  const recipe = regular("recipe.frozen", 1024 * 1024);
  validateAuthority();
  process.stdout.write(JSON.stringify({ manifest: manifest.toString("base64"), recipe: recipe.toString("base64") }));
} else if (command === "save") {
  const { name, manifest, recipe, outside, root } = payload; enterRoot(true);
  validateAuthority();
  const rootIdentity = identity(lstatSync(".")), temp = `.${name}.${randomBytes(8).toString("hex")}.tmp`;
  const expectedManifest = Buffer.from(manifest, "base64"), expectedRecipe = Buffer.from(recipe, "base64");
  const collision = () => {
    enter(name, false, 0o700);
    validateAuthority();
    const actualManifest = regular("manifest.json", 16 * 1024);
    if (testCut === "move-collision-between-files") renameSync(`../${name}`, `${outside}/${name}.moved`);
    validateAuthority();
    const actualRecipe = regular("recipe.frozen", 1024 * 1024);
    validateAuthority();
    if (!actualManifest.equals(expectedManifest) || !actualRecipe.equals(expectedRecipe)) fail("assignment id collision");
    process.stdout.write(JSON.stringify({ status: "existing" }));
  };
  let existing = true;
  try { lstatSync(name); } catch (error) { if (error?.code === "ENOENT") existing = false; else throw error; }
  if (existing) { collision(); process.exit(0); }
  const beforeMembers = members();
  let tempStat;
  {
    enter(temp, true, 0o700); tempStat = lstatSync(".");
    if (testCut === "move-temp-before-recipe") renameSync(`../${temp}`, `${outside}/${temp}.moved`);
    validateAuthority(); if (identity(lstatSync("..")) !== rootIdentity) fail("temporary directory escaped assignment root");
    durable("recipe.frozen", expectedRecipe);
    refreshCurrent(); validateAuthority(); if (identity(lstatSync("..")) !== rootIdentity) fail("temporary directory escaped assignment root");
    durable("manifest.json", expectedManifest);
    refreshCurrent(); validateAuthority(); if (identity(lstatSync("..")) !== rootIdentity) fail("temporary directory escaped assignment root");
    const fd = openSync(".", constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); }
    validateAuthority(); process.chdir(".."); authority.pop(); cwd(rootIdentity, 0o700); validateAuthority();
    const withTemp = members(temp);
    if (withTemp.length !== beforeMembers.length + 1 || !withTemp.includes(temp) || beforeMembers.some((entry) => !withTemp.includes(entry))) fail("assignment root membership changed");
    if (testCut === "aba-before-rename") { renameSync(root, `${outside}/assignments.aba`); renameSync(`${outside}/assignments.aba`, root); }
    validateAuthority();
    if (testCut === "create-empty-target") mkdirSync(name, { mode: 0o700 });
    let reservation;
    try { mkdirSync(name, { mode: 0o700 }); chmodSync(name, 0o700); reservation = lstatSync(name); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      collision(); process.exit(0);
    }
    if (!reservation.isDirectory() || reservation.isSymbolicLink() || (reservation.mode & 0o777) !== 0o700
      || readdirSync(name).length !== 0) fail("target reservation changed");
    refreshCurrent(); validateAuthority();
    const reserved = lstatSync(name);
    if (identity(reserved) !== identity(reservation) || readdirSync(name).length !== 0) fail("target reservation changed");
    renameSync(temp, name);
    if (testCut === "aba-after-rename") {
      renameSync(root, `${outside}/assignments.aba`); renameSync(`${outside}/assignments.aba`, root); validateAuthority();
    }
    refreshCurrent(); validateAuthority();
    const afterMembers = members();
    if (afterMembers.length !== beforeMembers.length + 1 || !afterMembers.includes(name) || beforeMembers.some((entry) => !afterMembers.includes(entry))) fail("assignment root membership changed");
    const rootFd = openSync(".", constants.O_RDONLY); try { fsyncSync(rootFd); } finally { closeSync(rootFd); }
    validateAuthority(); enter(name, false, 0o700);
    if (identity(lstatSync(".")) !== identity(tempStat)) fail("published artifact is not the prepared temp");
    const publishedManifest = regular("manifest.json", 16 * 1024), publishedRecipe = regular("recipe.frozen", 1024 * 1024);
    validateAuthority();
    if (!publishedManifest.equals(expectedManifest) || !publishedRecipe.equals(expectedRecipe)) fail("published artifact bytes changed");
    process.stdout.write(JSON.stringify({ status: "created" }));
  }
} else fail("invalid worker operation");
