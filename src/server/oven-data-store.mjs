import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, posix, resolve } from "node:path";
import { publishOvenDataPublishedEvent } from "../events/oven-data-events.mjs";
import { ovenId } from "../ovens/oven-contract.mjs";
import {
  bindingStorePath,
  readBindingStore,
  writeBindingWithinRepoStateLock,
} from "./oven-bindings.mjs";
import { containedJoin, withRepoStateLock } from "./repo-state.mjs";

export const OVEN_DATA_MAX_BYTES = 64 * 1024 * 1024;

function canonicalLogicalPath(id) {
  return posix.join(".local", "burnlist", "data", `${ovenId(id)}.json`);
}

export function canonicalOvenDataPath(repoRoot, id) {
  return containedJoin(repoRoot, "data", `${ovenId(id)}.json`);
}

function isTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validatedBytes(serializedJson) {
  if (typeof serializedJson !== "string") throw new Error("Validated Oven data must be serialized JSON text.");
  const bytes = Buffer.from(serializedJson, "utf8");
  if (bytes.length > OVEN_DATA_MAX_BYTES) {
    throw new Error(`Validated Oven data exceeds the ${OVEN_DATA_MAX_BYTES} byte limit.`);
  }
  try {
    JSON.parse(serializedJson);
  } catch (error) {
    throw new Error(`Validated Oven data must be valid JSON: ${error.message}`);
  }
  return bytes;
}

function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function ensureDataDirectory(repoRoot, id) {
  const path = canonicalOvenDataPath(repoRoot, id);
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  canonicalOvenDataPath(repoRoot, id);
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`Canonical Oven data directory must be a real directory: ${directory}`);
  }
  return path;
}

function snapshot(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Transaction target must be a regular file: ${path}`);
    return { exists: true, bytes: readFileSync(path), mode: stat.mode & 0o777 };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

function publishFile(path, bytes, { mode = 0o600, beforeRename, afterRename } = {}) {
  const directory = dirname(path);
  const temporary = `${path}.${randomBytes(12).toString("hex")}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, mode);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    beforeRename?.();
    renameSync(temporary, path);
    afterRename?.();
    fsyncDirectory(directory);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
    throw error;
  }
}

function restore(path, prior) {
  if (prior.exists) {
    publishFile(path, prior.bytes, { mode: prior.mode });
    return;
  }
  rmSync(path, { force: true });
  fsyncDirectory(dirname(path));
}

function rollback(error, steps) {
  const failures = [];
  for (const step of steps) {
    try { step(); } catch (failure) { failures.push(failure); }
  }
  if (failures.length === 0) throw error;
  throw new AggregateError(
    [error, ...failures],
    `Oven data transaction failed and ${failures.length} rollback step(s) also failed.`,
  );
}

export function publishOvenData(repoRoot, id, serializedJson, boundAt, {
  hooks = {},
  commit,
  publishDataEvent = publishOvenDataPublishedEvent,
  onOvenEventError = () => {},
} = {}) {
  const safeId = ovenId(id);
  const bytes = validatedBytes(serializedJson);
  if (typeof publishDataEvent !== "function") throw new Error("Oven data event publisher must be a function.");
  if (typeof onOvenEventError !== "function") throw new Error("Oven data event error observer must be a function.");
  if (!isTimestamp(boundAt)) throw new Error("Oven binding timestamp must be a valid ISO timestamp.");
  const logicalPath = canonicalLogicalPath(safeId);
  const root = resolve(repoRoot);
  const contentDigest = createHash("sha256").update(bytes).digest("hex");

  const publication = withRepoStateLock(root, () => {
    const dataPath = ensureDataDirectory(root, safeId);
    const storePath = bindingStorePath(root);
    const priorData = snapshot(dataPath);
    const priorBindings = snapshot(storePath);
    const currentBinding = readBindingStore(root).bindings[safeId];
    if (priorData.exists && priorData.bytes.equals(bytes) && currentBinding?.path === logicalPath) {
      commit?.();
      return { changed: false, dataPath, bindingPath: storePath, binding: currentBinding };
    }

    let dataPublished = false;
    let bindingPublished = false;
    try {
      publishFile(dataPath, bytes, {
        beforeRename: hooks.beforeDataRename,
        afterRename() {
          dataPublished = true;
          hooks.afterDataRename?.();
        },
      });
      hooks.beforeBindingPublish?.();
      const bindingResult = writeBindingWithinRepoStateLock(root, safeId, logicalPath, boundAt, {
        afterRename() {
          bindingPublished = true;
          hooks.afterBindingRename?.();
        },
      });
      commit?.();
      return {
        changed: true,
        dataPath,
        bindingPath: bindingResult.path,
        binding: bindingResult.binding,
      };
    } catch (error) {
      const steps = [];
      if (bindingPublished) steps.push(() => restore(storePath, priorBindings));
      if (dataPublished) steps.push(() => restore(dataPath, priorData));
      return rollback(error, steps);
    }
  });
  const cursor = `sha256-${createHash("sha256")
    .update(contentDigest)
    .update("\0")
    .update(publication.binding.boundAt)
    .digest("hex")}`;
  let event = null;
  try {
    event = publishDataEvent(root, {
      ovenId: safeId,
      subjectId: safeId,
      cursor,
      occurredAt: publication.binding.boundAt,
      payload: {},
    });
    if (event && typeof event.then === "function") {
      void Promise.resolve(event).catch(() => {});
      throw new Error("Oven data event publisher must complete synchronously.");
    }
  } catch (error) {
    event = null;
    try { onOvenEventError(error, { ovenId: safeId, subjectId: safeId, cursor }); } catch {}
  }
  return { ...publication, cursor, event };
}
