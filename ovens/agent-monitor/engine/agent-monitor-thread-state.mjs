import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";

export function foldCodexTurnOpen(events, initial = false) {
  let turnOpen = initial;
  for (const event of events) {
    const subtype = String(event?.eventType ?? "").split("/").at(-1);
    if (subtype === "task_started") turnOpen = true;
    else if (subtype === "task_complete") turnOpen = false;
  }
  return turnOpen;
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
    const block = Buffer.alloc(Math.min(1024 * 1024, Math.max(1, endOffset)));
    let carry = Buffer.alloc(0);
    let offset = 0;
    let turnOpen = false;
    const inspect = (line) => {
      if (!line.length) return;
      try {
        const record = JSON.parse(line.toString("utf8"));
        if (record?.payload?.type === "task_started") turnOpen = true;
        else if (record?.payload?.type === "task_complete") turnOpen = false;
      } catch { /* Invalid or partial records cannot establish lifecycle state. */ }
    };
    while (offset < endOffset) {
      const requested = Math.min(block.length, endOffset - offset);
      const bytes = readSync(fd, block, 0, requested, offset);
      if (!bytes) break;
      offset += bytes;
      const source = carry.length
        ? Buffer.concat([carry, block.subarray(0, bytes)])
        : block.subarray(0, bytes);
      let start = 0;
      let newline = source.indexOf(0x0a, start);
      while (newline >= 0) {
        inspect(source.subarray(start, newline));
        start = newline + 1;
        newline = source.indexOf(0x0a, start);
      }
      carry = Buffer.from(source.subarray(start));
    }
    if (offset !== endOffset) throw new Error("Agent session lifecycle scan ended early");
    if (carry.length) inspect(carry);
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || after.size < before.size) {
      throw new Error("Agent session changed identity during lifecycle scan");
    }
    return turnOpen;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function priorCodexTurnOpen(prior, candidate, cursor, limits) {
  if (candidate.provider !== "codex") return null;
  const retained = prior?.snapshot?.monitor?.thread?.turnOpen;
  return typeof retained === "boolean"
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
