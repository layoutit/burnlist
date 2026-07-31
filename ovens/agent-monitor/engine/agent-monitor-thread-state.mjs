import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";

const TAIL_ALIGNMENT_BYTES = 64 * 1024;
const LIFECYCLE_SCAN_BYTES = 1024 * 1024;
const MAX_CARRY_BYTES = 8 * 1024 * 1024;

export function foldCodexTurnOpen(events, initial = false) {
  let turnOpen = initial;
  for (const event of events) {
    const subtype = String(event?.eventType ?? "").split("/").at(-1);
    if (subtype === "task_started") turnOpen = true;
    else if (subtype === "task_complete") turnOpen = false;
  }
  return turnOpen;
}

function lifecycleState(line) {
  if (!line.trim()) return null;
  try {
    const record = JSON.parse(line);
    if (record?.payload?.type === "task_started") return true;
    if (record?.payload?.type === "task_complete") return false;
  } catch { /* Invalid or partial records cannot establish lifecycle state. */ }
  return null;
}

function scanCodexTurnOpen(path, endOffset, maxFileBytes) {
  if (!Number.isSafeInteger(endOffset) || endOffset < 0 || endOffset > maxFileBytes) {
    throw new Error("Agent session lifecycle scan is out of bounds");
  }
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maxFileBytes || endOffset > before.size) {
      throw new Error("Agent session lifecycle scan is not a bounded regular file");
    }
    const block = Buffer.alloc(Math.min(LIFECYCLE_SCAN_BYTES, Math.max(1, endOffset)));
    let carry = "";
    let found = null;
    let offset = endOffset;
    while (offset > 0) {
      const requested = Math.min(block.length, offset);
      const start = offset - requested;
      const bytes = readSync(fd, block, 0, requested, start);
      if (bytes !== requested) throw new Error("Agent session lifecycle scan ended early");
      const lines = `${block.subarray(0, bytes).toString("utf8")}${carry}`.split("\n");
      carry = lines.shift() ?? "";
      for (let index = lines.length - 1; index >= 0; index -= 1) {
        const state = lifecycleState(lines[index]);
        if (state !== null) {
          found = state;
          break;
        }
      }
      if (found !== null) break;
      if (Buffer.byteLength(carry, "utf8") > MAX_CARRY_BYTES) carry = "";
      offset = start;
    }
    const initial = found === null ? lifecycleState(carry) : null;
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || after.size < before.size) {
      throw new Error("Agent session changed identity during lifecycle scan");
    }
    return found ?? initial ?? false;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function countNewlines(fd, endOffset) {
  const block = Buffer.alloc(4 * 1024 * 1024);
  let offset = 0;
  let lines = 0;
  while (offset < endOffset) {
    const requested = Math.min(block.length, endOffset - offset);
    const bytes = readSync(fd, block, 0, requested, offset);
    if (!bytes) throw new Error("Agent session line count ended early");
    for (let index = 0; index < bytes; index += 1) {
      if (block[index] === 0x0a) lines += 1;
    }
    offset += bytes;
  }
  return lines;
}

export function agentMonitorTailPosition(path, stat, chunkBytes, maxFileBytes) {
  if (stat.size <= chunkBytes) return { offset: 0, line: 0, fastForwarded: false };
  if (stat.size > maxFileBytes) throw new Error("Agent session exceeds the bounded source limit");
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd);
    if (!before.isFile() || before.dev !== stat.dev || before.ino !== stat.ino || before.size !== stat.size) {
      throw new Error("Agent session changed before tail alignment");
    }
    let offset = stat.size - chunkBytes;
    const block = Buffer.alloc(Math.min(TAIL_ALIGNMENT_BYTES, chunkBytes));
    while (offset < stat.size) {
      const bytes = readSync(fd, block, 0, Math.min(block.length, stat.size - offset), offset);
      if (!bytes) break;
      const newline = block.subarray(0, bytes).indexOf(0x0a);
      offset += newline < 0 ? bytes : newline + 1;
      if (newline >= 0) break;
    }
    const line = countNewlines(fd, offset);
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || after.size < before.size) {
      throw new Error("Agent session changed during tail alignment");
    }
    return { offset, line, fastForwarded: true };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function priorCodexTurnOpen(prior, candidate, cursor, limits, forceScan = false) {
  if (candidate.provider !== "codex") return null;
  const retained = prior?.snapshot?.monitor?.thread?.turnOpen;
  return !forceScan && typeof retained === "boolean"
    ? retained
    : scanCodexTurnOpen(candidate.path, cursor.offset, limits.maxFileBytes);
}

export function agentMonitorThreadMetadata(candidate, turnOpen, caughtUp) {
  return {
    provider: candidate.provider,
    threadSource: candidate.threadSource,
    topLevel: candidate.topLevel,
    turnOpen: candidate.provider === "codex" ? Boolean(turnOpen) : null,
    caughtUp,
  };
}

export function sameAgentMonitorThreadMetadata(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right);
}
