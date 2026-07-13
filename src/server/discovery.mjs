import { readdirSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import { join, resolve } from "node:path";
import { readRegistry } from "./registry.mjs";

function directory(path) {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function repoRoot(path) {
  if (!directory(join(path, "notes", "burnlists"))) return null;
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function rootsAtAndBelow(path) {
  if (!directory(path)) return [];
  const roots = [repoRoot(path)].filter(Boolean);
  let entries = [];
  try {
    entries = readdirSync(path, { withFileTypes: true });
  } catch {
    return roots;
  }
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const root = repoRoot(join(path, entry.name));
    if (root) roots.push(root);
  }
  return roots;
}

function sortedUnique(roots) {
  return [...new Set(roots)].sort((left, right) => left.localeCompare(right));
}

function scanRoots(scanRoot) {
  return typeof scanRoot === "string"
    ? scanRoot.split(",").map((root) => root.trim()).filter(Boolean)
    : [];
}

export function observerRepoRoots({ cwd = process.cwd(), home = os.homedir(), scanRoot } = {}) {
  const root = resolve(cwd);
  const explicitRoots = scanRoots(scanRoot);
  if (explicitRoots.length) {
    return sortedUnique(explicitRoots.flatMap((entry) => rootsAtAndBelow(resolve(root, entry))));
  }

  const roots = [];
  try {
    for (const entry of readRegistry({ home }).roots) {
      const registered = repoRoot(entry.root);
      if (registered) roots.push(registered);
    }
  } catch {
    // A corrupt registry must not prevent ordinary cwd and ~/fed discovery.
  }
  roots.push(...rootsAtAndBelow(root));
  roots.push(...rootsAtAndBelow(join(home, "fed")));
  return sortedUnique(roots);
}

export function mutatorRepoRoots({ cwd = process.cwd(), scanRoot } = {}) {
  const root = resolve(cwd);
  const explicitRoots = scanRoots(scanRoot);
  if (explicitRoots.length) {
    return sortedUnique(explicitRoots.flatMap((entry) => rootsAtAndBelow(resolve(root, entry))));
  }

  let current = root;
  while (true) {
    const candidate = repoRoot(current);
    if (candidate) return [candidate];
    const parent = resolve(current, "..");
    if (parent === current) return [];
    current = parent;
  }
}
