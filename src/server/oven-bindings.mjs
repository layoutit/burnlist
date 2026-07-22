// Persisted bindings remain scoped to their repository; explicit --oven-data
// bindings are global defaults. Persisted relative paths resolve per read.
import { randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  ovenBindingChangedInput,
  publishCanonicalMutation,
} from "../events/oven-canonical-mutations.mjs";
import { ovenId } from "../ovens/oven-contract.mjs";
import { repoKey } from "./registry.mjs";
import { withRepoStateLock } from "./repo-state.mjs";

export const BINDING_SCHEMA_VERSION = 1;

export function bindingStoreDir(repoRoot) {
  return join(repoRoot, ".local", "burnlist");
}

export function bindingStorePath(repoRoot) {
  return join(bindingStoreDir(repoRoot), "bindings.json");
}

function emptyStore() {
  return { schemaVersion: BINDING_SCHEMA_VERSION, bindings: {} };
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function isTimestamp(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
    && !Number.isNaN(Date.parse(value));
}

function validateStore(store) {
  if (!isPlainObject(store) || store.schemaVersion !== BINDING_SCHEMA_VERSION || !isPlainObject(store.bindings)) return false;
  return Object.entries(store.bindings).every(([id, binding]) => {
    try {
      ovenId(id);
    } catch {
      return false;
    }
    return isPlainObject(binding)
      && typeof binding.path === "string"
      && binding.path.length > 0
      && isTimestamp(binding.boundAt);
  });
}

function corruptStore(path) {
  console.warn(`Ignoring corrupt Oven binding store: ${path}`);
  return emptyStore();
}

function storedBindingStore(repoRoot) {
  const path = bindingStorePath(repoRoot);
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return { state: "missing", store: emptyStore() };
    throw error;
  }
  try {
    const store = JSON.parse(text);
    return validateStore(store) ? { state: "valid", store } : { state: "malformed", store: null };
  } catch {
    return { state: "malformed", store: null };
  }
}

export function readBindingStore(repoRoot) {
  const result = storedBindingStore(repoRoot);
  return result.state === "malformed" ? corruptStore(bindingStorePath(repoRoot)) : result.store;
}

function mutableBindingStore(repoRoot) {
  const result = storedBindingStore(repoRoot);
  if (result.state === "malformed") {
    throw new Error(`Refusing to modify malformed Oven binding store: ${bindingStorePath(repoRoot)}`);
  }
  return result.store;
}

function writeStore(repoRoot, store, { beforeRename, afterRename } = {}) {
  const dir = bindingStoreDir(repoRoot);
  const path = bindingStorePath(repoRoot);
  const temporary = join(dir, `.bindings.json.${randomBytes(12).toString("hex")}`);
  mkdirSync(dir, { recursive: true });
  try {
    const fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify(store, null, 2)}\n`);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    beforeRename?.();
    renameSync(temporary, path);
    afterRename?.();
    const directory = openSync(dir, constants.O_RDONLY);
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

// Transactional callers may compose a data-file publication with this write
// while already holding withRepoStateLock. Ordinary callers use writeBinding.
export function writeBindingWithinRepoStateLock(repoRoot, id, logicalPath, boundAt, options) {
  const safeId = ovenId(id);
  if (typeof logicalPath !== "string" || logicalPath.length === 0) throw new Error("Oven binding path must be a non-empty string.");
  if (!isTimestamp(boundAt)) throw new Error("Oven binding timestamp must be a valid ISO timestamp.");
  const store = mutableBindingStore(repoRoot);
  store.bindings[safeId] = { path: logicalPath, boundAt };
  writeStore(repoRoot, store, options);
  return { path: bindingStorePath(repoRoot), binding: store.bindings[safeId] };
}

export function writeBinding(repoRoot, id, logicalPath, boundAt, eventOptions = {}) {
  const result = withRepoStateLock(repoRoot, () => writeBindingWithinRepoStateLock(repoRoot, id, logicalPath, boundAt));
  const event = publishCanonicalMutation(repoRoot, ovenBindingChangedInput({
    ovenId: id, action: "bound", path: logicalPath, occurredAt: result.binding.boundAt,
  }), eventOptions);
  return { ...result, event };
}

// Producers that establish a durable discovery root must not silently replace a
// user-selected binding. This keeps first-run setup idempotent while preserving
// the ordinary CLI's explicit replacement behavior above.
export function writeBindingIfAbsent(repoRoot, id, logicalPath, boundAt, eventOptions = {}) {
  const safeId = ovenId(id);
  if (typeof logicalPath !== "string" || logicalPath.length === 0) throw new Error("Oven binding path must be a non-empty string.");
  if (!isTimestamp(boundAt)) throw new Error("Oven binding timestamp must be a valid ISO timestamp.");
  const result = withRepoStateLock(repoRoot, () => {
    const store = mutableBindingStore(repoRoot);
    if (Object.hasOwn(store.bindings, safeId)) {
      return { created: false, path: bindingStorePath(repoRoot), binding: store.bindings[safeId] };
    }
    store.bindings[safeId] = { path: logicalPath, boundAt };
    writeStore(repoRoot, store);
    return { created: true, path: bindingStorePath(repoRoot), binding: store.bindings[safeId] };
  });
  if (!result.created) return result;
  const event = publishCanonicalMutation(repoRoot, ovenBindingChangedInput({
    ovenId: safeId, action: "bound", path: logicalPath, occurredAt: result.binding.boundAt,
  }), eventOptions);
  return { ...result, event };
}

export function removeBinding(repoRoot, id, {
  occurredAt = new Date().toISOString(),
  ...eventOptions
} = {}) {
  const safeId = ovenId(id);
  const removed = withRepoStateLock(repoRoot, () => {
    const store = mutableBindingStore(repoRoot);
    if (!Object.hasOwn(store.bindings, safeId)) return null;
    const binding = store.bindings[safeId];
    delete store.bindings[safeId];
    writeStore(repoRoot, store);
    return binding;
  });
  if (!removed) return false;
  publishCanonicalMutation(repoRoot, ovenBindingChangedInput({
    ovenId: safeId, action: "unbound", path: removed.path, occurredAt,
  }), eventOptions);
  return true;
}

const cachedStores = new Map();

function statSignature(path, stat) {
  try {
    const value = stat(path);
    return [value.dev, value.ino, value.size, value.mtimeMs, value.ctimeMs].join(":");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function cachedStore(repoRoot, stat) {
  const path = bindingStorePath(repoRoot);
  const signature = statSignature(path, stat);
  const cached = cachedStores.get(path);
  if (cached && cached.signature === signature) return cached.store;
  const store = readBindingStore(repoRoot);
  cachedStores.set(path, { signature, store });
  return store;
}

export function effectiveBindings({ repoRoots = [], override = new Map(), statFn = statSync } = {}) {
  const bindings = new Map();
  for (const repoRoot of [...new Set(repoRoots)].sort((left, right) => left.localeCompare(right))) {
    try {
      for (const [id, binding] of Object.entries(cachedStore(repoRoot, statFn).bindings)) {
        const entries = bindings.get(id) ?? [];
        entries.push({ repoKey: repoKey(repoRoot), repoRoot, path: resolve(repoRoot, binding.path) });
        bindings.set(id, entries);
      }
    } catch (error) {
      console.warn(`Ignoring unavailable Oven binding store: ${bindingStorePath(repoRoot)} (${error.message})`);
    }
  }
  for (const [id, path] of override) {
    const entries = bindings.get(id) ?? [];
    entries.push({ repoKey: null, repoRoot: null, path });
    bindings.set(id, entries);
  }
  return bindings;
}
