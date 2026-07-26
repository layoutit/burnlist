import { createHash, randomBytes } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

import { gitProbe, resolveUmbrella } from "../../../src/cli/umbrella.mjs";
import { publishOvenDataPublishedEvent } from "../../../src/events/oven-data-events.mjs";
import { repoKey } from "../../../src/server/registry.mjs";
import { writeBindingIfAbsent } from "../../../src/server/oven-bindings.mjs";
import { withDirectoryLock } from "../../../src/server/dir-lock.mjs";
import { containedJoin, withRepoStateLock } from "../../../src/server/repo-state.mjs";
import {
  AGENT_MONITOR_FEED_CONTRACT,
  AGENT_MONITOR_LIMITS,
  AGENT_MONITOR_OVEN_ID,
  assertAgentMonitorCursor,
  assertAgentMonitorIdentity,
  assertAgentMonitorManifest,
  assertAgentMonitorSnapshot,
} from "./agent-monitor-data-contract.mjs";

const keyPattern = /^[a-f0-9]{12}$/u;
const sessionPathPattern = /^[a-f0-9]{32}$/u;
export const AGENT_MONITOR_FEED_VERSION = "v1";

function sessionIdentifier(value) {
  if (typeof value !== "string" || !value.trim() || value !== value.trim()
      || Buffer.byteLength(value, "utf8") > AGENT_MONITOR_LIMITS.maxSessionBytes
      || /[\u0000-\u001f\u007f]/u.test(value)) {
    throw new Error(`Agent Monitor session must be printable text of at most ${AGENT_MONITOR_LIMITS.maxSessionBytes} UTF-8 bytes`);
  }
  return value;
}

export function agentMonitorSessionPath(value) {
  return createHash("sha256").update(sessionIdentifier(value), "utf8").digest("hex").slice(0, 32);
}

function worktreeRoot(cwd) {
  const root = gitProbe(cwd, ["rev-parse", "--show-toplevel"]);
  if (!root) throw new Error(`Agent Monitor requires a Git worktree: ${cwd}`);
  return realpathSync(root);
}

export function resolveAgentMonitorIdentity({ cwd = process.cwd(), session } = {}) {
  const logicalRepoRoot = realpathSync(resolveUmbrella(cwd));
  const root = worktreeRoot(cwd);
  const safeSession = sessionIdentifier(session);
  const identity = assertAgentMonitorIdentity({
    logicalRepoKey: repoKey(logicalRepoRoot),
    worktreeKey: repoKey(root),
    session: safeSession,
  });
  const feedRoot = containedJoin(logicalRepoRoot, AGENT_MONITOR_OVEN_ID, AGENT_MONITOR_FEED_VERSION);
  const feedDir = containedJoin(
    logicalRepoRoot,
    AGENT_MONITOR_OVEN_ID,
    AGENT_MONITOR_FEED_VERSION,
    identity.logicalRepoKey,
    identity.worktreeKey,
    agentMonitorSessionPath(identity.session),
  );
  return { identity, logicalRepoRoot, worktreeRoot: root, feedRoot, feedDir };
}

export function agentMonitorBindingPath(value) {
  const path = relative(value.logicalRepoRoot, value.feedRoot);
  if (!path || path.startsWith("..")) throw new Error("Agent Monitor feed root is not contained in its repository");
  return path;
}

export function ensureAgentMonitorFeedRoot(logicalRepoRoot, now = () => new Date().toISOString()) {
  const root = realpathSync(resolveUmbrella(logicalRepoRoot));
  const feedRoot = containedJoin(root, AGENT_MONITOR_OVEN_ID, AGENT_MONITOR_FEED_VERSION);
  withRepoStateLock(root, () => mkdirSync(feedRoot, { recursive: true }));
  const logicalPath = relative(root, feedRoot);
  const binding = writeBindingIfAbsent(
    root,
    AGENT_MONITOR_OVEN_ID,
    logicalPath,
    now(),
  );
  if (binding.binding.path !== logicalPath) {
    throw new Error(`Agent Monitor binding must point to ${logicalPath}; found ${binding.binding.path}`);
  }
  return { logicalRepoRoot: root, feedRoot, binding };
}

export function agentMonitorFeedDir({ repoRoot, logicalRepoKey, worktreeKey, session }) {
  if (!keyPattern.test(logicalRepoKey ?? "") || !keyPattern.test(worktreeKey ?? "")) {
    throw new Error("Agent Monitor feed selection requires lowercase 12-character hexadecimal keys");
  }
  return containedJoin(
    repoRoot,
    AGENT_MONITOR_OVEN_ID,
    AGENT_MONITOR_FEED_VERSION,
    logicalRepoKey,
    worktreeKey,
    agentMonitorSessionPath(session),
  );
}

export function ensureAgentMonitorFeed(value, now = () => new Date().toISOString()) {
  withRepoStateLock(value.logicalRepoRoot, () => mkdirSync(value.feedDir, { recursive: true }));
  const binding = writeBindingIfAbsent(
    value.logicalRepoRoot,
    AGENT_MONITOR_OVEN_ID,
    agentMonitorBindingPath(value),
    now(),
  );
  return { ...value, binding };
}

function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeDurableAtomic(path, contents) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  let fd;
  let renamed = false;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    renamed = true;
    try { fsyncDirectory(dirname(path)); } catch { /* rename is the commit point */ }
  } finally {
    if (fd !== undefined) closeSync(fd);
    try { rmSync(temporary, { force: true }); } catch (error) { if (!renamed) throw error; }
  }
}

function writeDurableExclusive(path, contents) {
  const temporary = `${path}.${randomBytes(8).toString("hex")}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, contents);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    try { linkSync(temporary, path); } catch (error) {
      if (error?.code !== "EEXIST") throw error;
    }
    try { fsyncDirectory(dirname(path)); } catch { /* immutable bytes are already committed */ }
  } finally {
    if (fd !== undefined) closeSync(fd);
    rmSync(temporary, { force: true });
  }
}

function readBounded(path, maxBytes, label) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > maxBytes) {
      throw new Error(`${label} is not a bounded regular file`);
    }
    const result = Buffer.alloc(before.size);
    let offset = 0;
    while (offset < result.length) {
      const count = readSync(fd, result, offset, result.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const after = fstatSync(fd);
    if (offset !== result.length || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size) {
      throw new Error(`${label} changed during read`);
    }
    return result;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function readJson(path, maxBytes, label) {
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(readBounded(path, maxBytes, label)));
}

function manifestPath(feedDir) {
  return join(feedDir, "manifest.json");
}

export function readAgentMonitorManifest(feedDir) {
  return assertAgentMonitorManifest(readJson(
    manifestPath(feedDir),
    AGENT_MONITOR_LIMITS.maxManifestBytes,
    "Agent Monitor manifest",
  ));
}

export function loadAgentMonitorFeed(feedDir) {
  const manifest = readAgentMonitorManifest(feedDir);
  const snapshotPath = join(feedDir, manifest.snapshot);
  const source = readBounded(snapshotPath, AGENT_MONITOR_LIMITS.maxSnapshotBytes, "Agent Monitor snapshot");
  if (source.length !== manifest.bytes || createHash("sha256").update(source).digest("hex") !== manifest.digest) {
    throw new Error("Agent Monitor snapshot does not match its manifest");
  }
  const snapshot = assertAgentMonitorSnapshot(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(source)));
  if (JSON.stringify(snapshot.identity) !== JSON.stringify(manifest.identity)) {
    throw new Error("Agent Monitor snapshot identity does not match its manifest");
  }
  return { manifest, snapshot, snapshotPath };
}

function pruneSnapshots(feedDir, retained, keep = 3) {
  const snapshots = readdirSync(feedDir, { withFileTypes: true }).flatMap((entry) => {
    if (!entry.isFile() || !entry.name.startsWith("snapshot-") || !entry.name.endsWith(".json")) return [];
    try { return [{ name: entry.name, mtimeMs: statSync(join(feedDir, entry.name)).mtimeMs }]; } catch { return []; }
  }).sort((left, right) => right.mtimeMs - left.mtimeMs);
  const protectedNames = new Set([retained, ...snapshots.slice(0, keep).map((entry) => entry.name)]);
  for (const snapshot of snapshots) {
    if (!protectedNames.has(snapshot.name)) rmSync(join(feedDir, snapshot.name), { force: true });
  }
}

export function commitAgentMonitorSnapshot(value, snapshot, now = () => new Date().toISOString(), cursor = null) {
  assertAgentMonitorSnapshot(snapshot);
  ensureAgentMonitorFeed(value, now);
  const source = Buffer.from(JSON.stringify(snapshot));
  if (source.length > AGENT_MONITOR_LIMITS.maxSnapshotBytes) throw new Error("Agent Monitor snapshot exceeds its byte limit");
  const digest = createHash("sha256").update(source).digest("hex");
  const snapshotName = `snapshot-${digest}.json`;
  const manifest = assertAgentMonitorManifest({
    contract: AGENT_MONITOR_FEED_CONTRACT,
    identity: value.identity,
    updatedAt: now(),
    snapshot: snapshotName,
    bytes: source.length,
    digest,
    ...(cursor ? {
      cursor: assertAgentMonitorCursor(cursor),
      summary: {
        state: snapshot.monitor.summary.state,
        current: snapshot.current.title,
        lines: snapshot.monitor.counts.lines,
        failures: snapshot.monitor.counts.failures,
        updatedAt: snapshot.monitor.summary.updatedAt,
      },
    } : {}),
  });
  return withDirectoryLock({
    lockPath: join(value.feedDir, ".lock"),
    fn: () => {
      writeDurableExclusive(join(value.feedDir, snapshotName), source);
      writeDurableAtomic(manifestPath(value.feedDir), Buffer.from(JSON.stringify(manifest)));
      pruneSnapshots(value.feedDir, snapshotName);
      return manifest;
    },
    errorFactory: () => Object.assign(new Error(`${basename(value.feedDir)} is busy (locked)`), { code: "ELOCKED" }),
  });
}

export function publishAgentMonitorInvalidation(repoRoot, manifest) {
  try {
    return {
      event: publishOvenDataPublishedEvent(repoRoot, {
        ovenId: AGENT_MONITOR_OVEN_ID,
        subjectId: manifest.identity.session,
        cursor: `sha256-${manifest.digest}`,
        occurredAt: manifest.updatedAt,
        payload: {},
      }),
      error: null,
    };
  } catch (error) {
    return { event: null, error };
  }
}

export function agentMonitorProducerStatePath(value) {
  return join(value.feedDir, "producer.json");
}

export function agentMonitorPidPath(repoRoot) {
  return containedJoin(repoRoot, AGENT_MONITOR_OVEN_ID, AGENT_MONITOR_FEED_VERSION, "producer.pid.json");
}

export function writeAgentMonitorJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeDurableAtomic(path, Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
}

export function readAgentMonitorJson(path, fallback = null) {
  try { return JSON.parse(readFileSync(path, "utf8")); } catch { return fallback; }
}

export function verifiedAgentMonitorFeedRoot(repoRoot, bindingPath) {
  const expected = containedJoin(repoRoot, AGENT_MONITOR_OVEN_ID, AGENT_MONITOR_FEED_VERSION);
  const root = realpathSync(bindingPath);
  if (root !== realpathSync(expected) || !statSync(root).isDirectory()) {
    throw new Error("configured Agent Monitor feed root escapes its repository");
  }
  return root;
}

export function isAgentMonitorSessionPath(value) {
  return sessionPathPattern.test(value);
}
