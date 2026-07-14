#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import {
  STREAMING_DIFF_MAX_CHANGES,
  STREAMING_DIFF_MAX_LINES,
  assertStreamingDiffData,
  createStreamingDiffChange,
  createStreamingDiffPayload,
} from "./streaming-diff-contract.mjs";

const ignoredDirectories = new Set([
  ".git",
  ".local",
  ".playwright-cli",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "output",
]);

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

function repositoryRoot(cwd) {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, ".git"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

function ignored(relativePath) {
  return relativePath.split("/").some((part) => ignoredDirectories.has(part));
}

function textFile(path) {
  try {
    const stat = statSync(path);
    if (!stat.isFile() || stat.size > 512_000) return null;
    const buffer = readFileSync(path);
    if (buffer.includes(0)) return null;
    const text = buffer.toString("utf8");
    if (text.replaceAll("\r\n", "\n").split("\n").length > STREAMING_DIFF_MAX_LINES) return null;
    return text;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function repositorySnapshot(root) {
  const snapshot = new Map();
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).replaceAll("\\", "/");
      if (ignored(relativePath)) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile()) {
        const text = textFile(path);
        if (text !== null) snapshot.set(relativePath, text);
      }
    }
  };
  visit(root);
  return snapshot;
}

function safeIdentity(value, label) {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._-]{1,160}$/u.test(value)) throw new Error(`${label} is invalid.`);
  return value;
}

async function hookInput() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return {
    threadId: safeIdentity(value.session_id ?? process.env.CODEX_THREAD_ID, "Streaming Diff thread id"),
    turnId: value.turn_id == null ? null : safeIdentity(value.turn_id, "Streaming Diff turn id"),
    toolName: value.tool_name == null ? null : safeIdentity(value.tool_name, "Streaming Diff tool name"),
    prompt: typeof value.prompt === "string" ? value.prompt : null,
    root: repositoryRoot(value.cwd ?? process.cwd()),
  };
}

function streamRoot(root) {
  return resolve(process.env.BURNLIST_STREAMING_DIFF_DIR || join(root, ".local/burnlist/streaming-diff"));
}

function feedPath(root, threadId) {
  return join(streamRoot(root), "threads", threadId, "current.json");
}

function readFeed(root, threadId) {
  const path = feedPath(root, threadId);
  if (!existsSync(path)) return createStreamingDiffPayload({ threadId });
  const payload = assertStreamingDiffData(JSON.parse(readFileSync(path, "utf8")));
  if (payload.thread.id !== threadId) throw new Error("Streaming Diff feed thread does not match its directory.");
  return payload;
}

function wait(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}

function captureLock(root) {
  return join(streamRoot(root), "capture.lock");
}

function acquireLock(root) {
  const lock = captureLock(root);
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    try {
      mkdirSync(lock);
      return lock;
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 900_000) {
          rmSync(lock, { recursive: true, force: true });
          continue;
        }
      } catch (statError) {
        if (statError?.code !== "ENOENT") throw statError;
      }
      wait(50);
    }
  }
  throw new Error("Timed out waiting for the Streaming Diff capture lock.");
}

function promptLabel(prompt) {
  if (!prompt) return null;
  const label = prompt.replaceAll(/\s+/gu, " ").trim();
  return label ? label.slice(0, 120) : null;
}

function touchFeed(identity) {
  const path = feedPath(identity.root, identity.threadId);
  const existing = readFeed(identity.root, identity.threadId);
  atomicJson(path, createStreamingDiffPayload({
    threadId: identity.threadId,
    turnId: identity.turnId ?? existing.thread.turnId,
    label: promptLabel(identity.prompt) ?? existing.thread.label,
    lastActiveAt: new Date().toISOString(),
    revision: existing.revision,
    changes: existing.changes,
  }));
}

function beforeTool(identity) {
  const lock = acquireLock(identity.root);
  try {
    const baseline = {
      threadId: identity.threadId,
      turnId: identity.turnId,
      toolName: identity.toolName,
      capturedAt: new Date().toISOString(),
      files: [...repositorySnapshot(identity.root)],
    };
    atomicJson(join(lock, "baseline.json"), baseline);
    touchFeed(identity);
  } catch (error) {
    rmSync(lock, { recursive: true, force: true });
    throw error;
  }
}

function afterTool(identity) {
  const lock = captureLock(identity.root);
  try {
    const baseline = JSON.parse(readFileSync(join(lock, "baseline.json"), "utf8"));
    if (baseline.threadId !== identity.threadId) throw new Error("Streaming Diff capture lock belongs to another thread.");
    const before = new Map(baseline.files);
    const after = repositorySnapshot(identity.root);
    const changedPaths = [...new Set([...before.keys(), ...after.keys()])]
      .filter((path) => before.get(path) !== after.get(path))
      .sort();
    if (!changedPaths.length) return;
    const existing = readFeed(identity.root, identity.threadId);
    let revision = existing.revision;
    const captured = [];
    const turnId = identity.turnId ?? baseline.turnId ?? "unknown-turn";
    const toolName = identity.toolName ?? baseline.toolName ?? "unknown-tool";
    const timestamp = new Date().toISOString();
    for (const sourcePath of changedPaths) {
      revision += 1;
      const change = createStreamingDiffChange({
        before: before.get(sourcePath) ?? "",
        after: after.get(sourcePath) ?? "",
        revision,
        sourcePath,
        threadId: identity.threadId,
        turnId,
        toolName,
        timestamp,
      });
      if (change.summary.changedLines) captured.push(change);
    }
    if (!captured.length) return;
    atomicJson(feedPath(identity.root, identity.threadId), createStreamingDiffPayload({
      threadId: identity.threadId,
      turnId,
      label: existing.thread.label,
      lastActiveAt: timestamp,
      revision,
      changes: [...captured.reverse(), ...existing.changes].slice(0, STREAMING_DIFF_MAX_CHANGES),
    }));
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

const action = process.argv[2];
if (!["start", "prompt", "pre", "post"].includes(action)) throw new Error("Usage: streaming-diff-hook.mjs <start|prompt|pre|post>");
const identity = await hookInput();
if (action === "start" || action === "prompt") touchFeed(identity);
else if (action === "pre") beforeTool(identity);
else afterTool(identity);
