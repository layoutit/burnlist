import { execFileSync } from "node:child_process";
import { lstatSync, realpathSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { freezeRecipe, loadFrozenRecipe } from "../dsl/frozen.mjs";
import { rawSha256 } from "../dsl/hash.mjs";

const ID = /^as1-sha256:[a-f0-9]{64}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const ITEM = /^item:[0-9]{6}-[0-9]{3}#[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/u;
const MANIFEST_KEYS = ["schema", "assignmentId", "itemRef", "selector", "executionRevision", "packageRevision", "sourceRevision", "unassignedItemDigest", "assignedItemDigest", "frozenRecipeDigest", "frozenRecipeSize"];

function fail(message) { throw new Error(`Assignment artifact: ${message}`); }
function name(id) { if (!ID.test(id)) fail("invalid assignment id"); return id.slice(11); }
function exact(value, keys) { return !!value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key, index) => Object.keys(value)[index] === key); }
function manifest(record, recipe) {
  const value = { schema: "burnlist-loop-assignment@1", assignmentId: record.assignmentId, itemRef: record.itemRef, selector: record.selector,
    executionRevision: record.executionRevision, packageRevision: record.packageRevision, sourceRevision: record.sourceRevision,
    unassignedItemDigest: record.unassignedItemDigest, assignedItemDigest: record.assignedItemDigest,
    frozenRecipeDigest: rawSha256(recipe), frozenRecipeSize: recipe.length };
  return Buffer.from(`${JSON.stringify(value)}\n`);
}
function parseManifest(bytes, id) {
  let value; try { value = JSON.parse(bytes.toString("utf8")); } catch { fail("manifest is not JSON"); }
  if (!exact(value, MANIFEST_KEYS) || !Buffer.from(`${JSON.stringify(value)}\n`).equals(bytes)) fail("manifest is not canonical");
  if (value.schema !== "burnlist-loop-assignment@1" || value.assignmentId !== id || !ITEM.test(value.itemRef) || !/^loop:builtin:[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value.selector) || !/^er1-sha256:[a-f0-9]{64}$/u.test(value.executionRevision) || !/^lp1-sha256:[a-f0-9]{64}$/u.test(value.packageRevision) || !/^ls1-sha256:[a-f0-9]{64}$/u.test(value.sourceRevision) || !/^id1-sha256:[a-f0-9]{64}$/u.test(value.unassignedItemDigest) || !/^id1-sha256:[a-f0-9]{64}$/u.test(value.assignedItemDigest) || !DIGEST.test(value.frozenRecipeDigest) || !Number.isSafeInteger(value.frozenRecipeSize) || value.frozenRecipeSize < 1) fail("manifest has invalid bindings");
  return value;
}

const worker = fileURLToPath(new URL("./store-worker.mjs", import.meta.url));
function stat(path) { const value = lstatSync(path); if (value.isSymbolicLink() || !value.isDirectory()) fail(`unsafe directory ${path}`); return `${value.dev}:${value.ino}`; }
function invoke(command, cwd, expected, value, testCut) {
  try {
    return execFileSync(process.execPath, [worker, command, expected, testCut || ""], {
      cwd, input: JSON.stringify(value || {}), encoding: "utf8", maxBuffer: 3 * 1024 * 1024,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = String(error?.stderr || "");
    if (/code: 'ENOENT'|ENOENT:/u.test(detail)) throw Object.assign(new Error("Assignment artifact: required artifact bytes are missing"), { code: "ENOENT" });
    const messages = detail.match(/Assignment artifact: [^\n]+/gu) || [];
    throw new Error(messages.findLast((message) => !message.includes("${")) || "Assignment artifact: anchored worker failed");
  }
}
function within(repo, path) { const value = relative(repo, path); return value === "" || (value !== ".." && !value.startsWith(`..${sep}`)); }

export function assignmentStore(repoRoot, options = {}) {
  const repository = realpathSync(resolve(repoRoot)), root = resolve(repository, ".local", "burnlist", "loop", "v2", "assignments");
  if (!within(repository, root)) fail("artifact root escapes repository");
  const repositoryIdentity = stat(repository);
  const cut = (name, detail = {}) => options.onCut?.(name, Object.freeze({ repository, root, ...detail }));
  const pathFor = (id) => join(root, name(id));
  const read = (id) => {
    const target = pathFor(id); cut("read", { target });
    const result = JSON.parse(invoke("load", repository, repositoryIdentity, { name: name(id), outside: options.workerOutside }, options.workerCut));
    const manifestBytes = Buffer.from(result.manifest, "base64"), recipe = Buffer.from(result.recipe, "base64");
    const value = parseManifest(manifestBytes, id);
    if (recipe.length !== value.frozenRecipeSize || rawSha256(recipe) !== value.frozenRecipeDigest) fail("recipe bytes do not match manifest");
    const frozen = loadFrozenRecipe(recipe);
    if (frozen.revisions.executable !== value.executionRevision || frozen.revisions.package !== value.packageRevision || frozen.revisions.source !== value.sourceRevision) fail("frozen recipe bindings do not match manifest");
    return { ...value, frozen, frozenRecipeBytes: Buffer.from(recipe), path: target };
  };
  return {
    pathFor,
    save(record, compiled) {
      const recipe = freezeRecipe(compiled), bytes = manifest(record, recipe), target = pathFor(record.assignmentId);
      cut("collision", { target }); cut("publication", { target });
      invoke("save", repository, repositoryIdentity, { name: name(record.assignmentId), manifest: bytes.toString("base64"), recipe: recipe.toString("base64"), outside: options.workerOutside, root }, options.workerCut);
      return target;
    },
    load: read,
    inspect(id) { return read(id); },
  };
}
