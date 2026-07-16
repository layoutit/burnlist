import { realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { withDirectoryLock } from "./dir-lock.mjs";

export function repoStateDir(repoRoot) {
  return join(resolve(repoRoot), ".local", "burnlist");
}

function nearestRealPath(path) {
  const suffix = [];
  let current = resolve(path);
  while (true) {
    try {
      return resolve(realpathSync(current), ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = dirname(current);
      if (parent === current) throw error;
      suffix.push(basename(current));
      current = parent;
    }
  }
}

function isWithin(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === ""
    || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent));
}

export function containedJoin(repoRoot, ...segments) {
  const repo = nearestRealPath(resolve(repoRoot));
  const state = repoStateDir(repoRoot);
  const target = join(state, ...segments);
  if (!isWithin(state, target)) {
    throw new Error(`Repo state path escapes ${state}: ${target}`);
  }
  const realState = nearestRealPath(state);
  const realTarget = nearestRealPath(target);
  if (!isWithin(repo, realState) || !isWithin(realState, realTarget)) {
    throw new Error(`Repo state path escapes ${state}: ${target}`);
  }
  return target;
}

export function withRepoStateLock(repoRoot, fn) {
  const lock = containedJoin(repoRoot, ".lock");
  return withDirectoryLock({
    lockPath: lock,
    fn,
    errorFactory: ({ holderPid, lockPath }) => {
      const error = new Error(`Repo state is locked by pid ${holderPid ?? "unknown"}: ${lockPath}`);
      error.code = "ELOCKED";
      return error;
    },
  });
}
