import { spawnSync } from "node:child_process";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

import { captureCard, STREAMING_DIFF_ABSENT, STREAMING_DIFF_CAPTURE_LIMITS, STREAMING_DIFF_MISSING } from "./streaming-diff-capture.mjs";

export const STREAMING_DIFF_GIT_LIMITS = Object.freeze({ timeout: 2_000, maxBuffer: 8 * 1024 * 1024 });

function within(root, target) {
  const path = relative(root, target);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`));
}

function git(worktreeRoot, args, limits) {
  const result = spawnSync("git", args, { cwd: worktreeRoot, encoding: "buffer", shell: false, ...limits });
  if (result.error || result.status !== 0) throw result.error ?? new Error(result.stderr.toString("utf8").trim() || `git ${args[0]} failed`);
  return result.stdout;
}

export function readContainedFile(root, file, maxFileBytes, {
  close = closeSync,
  fstat = fstatSync,
  lstat = lstatSync,
  open = openSync,
  read = readSync,
  realpath = realpathSync,
} = {}) {
  let fd;
  try {
    const initial = lstat(file);
    if (!initial.isFile() || initial.isSymbolicLink() || !within(root, realpath(file))) return STREAMING_DIFF_ABSENT;
    fd = open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstat(fd);
    if (!opened.isFile() || opened.dev !== initial.dev || opened.ino !== initial.ino || !within(root, realpath(file))) return STREAMING_DIFF_ABSENT;
    const buffer = Buffer.allocUnsafe(maxFileBytes + 1);
    let bytes = 0;
    while (bytes < buffer.length) {
      const readNow = read(fd, buffer, bytes, buffer.length - bytes, null);
      if (readNow === 0) break;
      bytes += readNow;
    }
    const finished = fstat(fd);
    if (finished.dev !== opened.dev || finished.ino !== opened.ino || finished.size !== opened.size || finished.mtimeMs !== opened.mtimeMs) return STREAMING_DIFF_MISSING;
    if (bytes > maxFileBytes) return { truncated: true, bytes: finished.size };
    return buffer.subarray(0, bytes);
  } catch (error) {
    if (["ENOENT", "ELOOP", "ENOTDIR"].includes(error?.code)) return STREAMING_DIFF_ABSENT;
    throw error;
  } finally {
    if (fd !== undefined) close(fd);
  }
}

// captureCard creates its own bounded pre-to-post unified diff. It never calls
// `git diff`, so Git external diff drivers and text conversions cannot run.
export function createGitCaptureIo(worktreeRoot, limits = {}) {
  const root = realpathSync(worktreeRoot);
  const bounded = { ...STREAMING_DIFF_GIT_LIMITS, ...limits };
  const maxFileBytes = limits.maxFileBytes ?? STREAMING_DIFF_CAPTURE_LIMITS.maxFileBytes;
  const target = (path) => resolve(root, path);
  return {
    inspect(path) {
      const file = target(path);
      if (!within(root, file)) return { contained: false };
      try {
        const stat = lstatSync(file);
        if (!stat.isFile()) return { type: stat.isSymbolicLink() ? "symlink" : "other", contained: false };
        return { type: "file", contained: within(root, realpathSync(file)) };
      } catch (error) {
        if (error?.code === "ENOENT") return { type: "file", contained: true };
        throw error;
      }
    },
    readPost(path) {
      const file = target(path);
      if (!within(root, file)) return STREAMING_DIFF_ABSENT;
      return readContainedFile(root, file, maxFileBytes);
    },
    isIgnored(path) {
      const result = spawnSync("git", ["check-ignore", "--no-index", "--quiet", "--", path], { cwd: root, shell: false, ...bounded });
      if (result.error) throw result.error;
      if (result.status === 0) return true;
      if (result.status === 1) return false;
      throw new Error(result.stderr?.toString("utf8").trim() || `git check-ignore failed (${result.status ?? result.signal ?? "unknown"})`);
    },
    listUntracked(paths) {
      if (paths.length === 0) return [];
      return git(root, ["ls-files", "--others", "--exclude-standard", "-z", "--", ...paths], bounded)
        .toString("utf8").split("\0").filter(Boolean);
    },
  };
}

// The caller persists this exact map at pre-hook time. Entries that could not be
// read are MISSING, while an observed non-existent file is explicitly ABSENT.
export function snapshotGitPaths({ worktreeRoot, hintedPaths = [], policy = {} }) {
  const io = createGitCaptureIo(worktreeRoot, policy);
  const snapshot = new Map();
  for (const path of hintedPaths) {
    try {
      snapshot.set(path, io.readPost(path));
    } catch {
      snapshot.set(path, STREAMING_DIFF_MISSING);
    }
  }
  return snapshot;
}

export function captureGitCard({ worktreeRoot, policy, ...options }) {
  const io = createGitCaptureIo(worktreeRoot, policy);
  return captureCard({ ...options, policy, ...io });
}
