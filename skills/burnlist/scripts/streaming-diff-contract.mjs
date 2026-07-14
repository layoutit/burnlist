export const STREAMING_DIFF_SCHEMA = "burnlist-streaming-diff-data@2";
export const STREAMING_DIFF_MAX_LINES = 10_000;
export const STREAMING_DIFF_MAX_CHANGES = 30;

function lines(value) {
  if (typeof value !== "string") throw new Error("Streaming Diff source must be text.");
  if (!value) return [];
  const result = value.replaceAll("\r\n", "\n").split("\n");
  if (result.at(-1) === "") result.pop();
  if (result.length > STREAMING_DIFF_MAX_LINES) {
    throw new Error(`Streaming Diff supports at most ${STREAMING_DIFF_MAX_LINES} lines per file.`);
  }
  return result;
}

function changedMiddle(before, after) {
  if (!before.length) return after.map((text) => ({ kind: "addition", text }));
  if (!after.length) return before.map((text) => ({ kind: "deletion", text }));
  if (before.length * after.length > 1_000_000) {
    return [
      ...before.map((text) => ({ kind: "deletion", text })),
      ...after.map((text) => ({ kind: "addition", text })),
    ];
  }
  const matrix = Array.from({ length: before.length + 1 }, () => new Uint32Array(after.length + 1));
  for (let oldIndex = 1; oldIndex <= before.length; oldIndex += 1) {
    for (let newIndex = 1; newIndex <= after.length; newIndex += 1) {
      matrix[oldIndex][newIndex] = before[oldIndex - 1] === after[newIndex - 1]
        ? matrix[oldIndex - 1][newIndex - 1] + 1
        : Math.max(matrix[oldIndex - 1][newIndex], matrix[oldIndex][newIndex - 1]);
    }
  }
  const reversed = [];
  let oldIndex = before.length;
  let newIndex = after.length;
  while (oldIndex > 0 || newIndex > 0) {
    if (oldIndex > 0 && newIndex > 0 && before[oldIndex - 1] === after[newIndex - 1]) {
      reversed.push({ kind: "context", text: before[oldIndex - 1] });
      oldIndex -= 1;
      newIndex -= 1;
    } else if (newIndex > 0 && (oldIndex === 0 || matrix[oldIndex][newIndex - 1] >= matrix[oldIndex - 1][newIndex])) {
      reversed.push({ kind: "addition", text: after[newIndex - 1] });
      newIndex -= 1;
    } else {
      reversed.push({ kind: "deletion", text: before[oldIndex - 1] });
      oldIndex -= 1;
    }
  }
  return reversed.reverse();
}

export function diffStreamingText(beforeText, afterText) {
  const before = lines(beforeText);
  const after = lines(afterText);
  let prefixLength = 0;
  while (prefixLength < before.length && prefixLength < after.length && before[prefixLength] === after[prefixLength]) {
    prefixLength += 1;
  }
  let suffixLength = 0;
  while (
    suffixLength < before.length - prefixLength
    && suffixLength < after.length - prefixLength
    && before[before.length - suffixLength - 1] === after[after.length - suffixLength - 1]
  ) suffixLength += 1;
  const prefix = before.slice(0, prefixLength).map((text) => ({ kind: "context", text }));
  const beforeEnd = suffixLength ? before.length - suffixLength : before.length;
  const afterEnd = suffixLength ? after.length - suffixLength : after.length;
  const middle = changedMiddle(before.slice(prefixLength, beforeEnd), after.slice(prefixLength, afterEnd));
  const suffix = before.slice(beforeEnd).map((text) => ({ kind: "context", text }));
  let oldNumber = 1;
  let newNumber = 1;
  return [...prefix, ...middle, ...suffix].map((line) => {
    const numbered = {
      ...line,
      oldNumber: line.kind === "addition" ? null : oldNumber,
      newNumber: line.kind === "deletion" ? null : newNumber,
    };
    if (line.kind !== "addition") oldNumber += 1;
    if (line.kind !== "deletion") newNumber += 1;
    return numbered;
  });
}

export function compactStreamingDiffLines(diffLines, contextLines = 2) {
  if (!Array.isArray(diffLines)) throw new Error("Streaming Diff lines must be an array.");
  if (!Number.isSafeInteger(contextLines) || contextLines < 0 || contextLines > 10) {
    throw new Error("Streaming Diff context lines must be between 0 and 10.");
  }
  const changed = diffLines.map((line, index) => line.kind === "context" ? -1 : index).filter((index) => index >= 0);
  if (!changed.length) return diffLines;
  const keep = new Set();
  for (const index of changed) {
    for (let candidate = Math.max(0, index - contextLines); candidate <= Math.min(diffLines.length - 1, index + contextLines); candidate += 1) {
      keep.add(candidate);
    }
  }
  const compact = [];
  let previous = -1;
  for (let index = 0; index < diffLines.length; index += 1) {
    if (!keep.has(index)) continue;
    if (previous >= 0 && index > previous + 1) compact.push({ kind: "omission", oldNumber: null, newNumber: null, text: "" });
    compact.push(diffLines[index]);
    previous = index;
  }
  const trimmed = [];
  let hunk = [];
  const flushHunk = () => {
    while (hunk[0]?.kind === "context" && !hunk[0].text.trim()) hunk.shift();
    while (hunk.at(-1)?.kind === "context" && !hunk.at(-1).text.trim()) hunk.pop();
    if (!hunk.length) return;
    if (trimmed.length) trimmed.push({ kind: "omission", oldNumber: null, newNumber: null, text: "" });
    trimmed.push(...hunk);
    hunk = [];
  };
  for (const line of compact) {
    if (line.kind === "omission") flushHunk();
    else hunk.push(line);
  }
  flushHunk();
  return trimmed;
}

function requiredString(value, label, maximum = 160) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) throw new Error(`${label} is invalid.`);
  return value;
}

export function createStreamingDiffChange({ before, after, revision, sourcePath, threadId, turnId, toolName, timestamp = new Date().toISOString() }) {
  if (!Number.isSafeInteger(revision) || revision < 1) throw new Error("Streaming Diff revision must be a positive integer.");
  requiredString(sourcePath, "Streaming Diff source path", 4096);
  requiredString(threadId, "Streaming Diff thread id");
  requiredString(turnId, "Streaming Diff turn id");
  requiredString(toolName, "Streaming Diff tool name");
  if (!Number.isFinite(Date.parse(timestamp))) throw new Error("Streaming Diff timestamp must be ISO-8601.");
  const diffLines = diffStreamingText(before, after);
  const additions = diffLines.filter((line) => line.kind === "addition").length;
  const deletions = diffLines.filter((line) => line.kind === "deletion").length;
  return {
    id: `change-${String(revision).padStart(6, "0")}`,
    revision,
    timestamp,
    sourcePath,
    actor: { threadId, turnId, toolName },
    summary: { additions, deletions, changedLines: additions + deletions },
    lines: diffLines,
  };
}

export function createStreamingDiffPayload({
  threadId,
  turnId = null,
  label = `Thread ${String(threadId).slice(-8)}`,
  lastActiveAt = new Date().toISOString(),
  revision = 0,
  changes = [],
  generatedAt = new Date().toISOString(),
}) {
  return assertStreamingDiffData({
    schema: STREAMING_DIFF_SCHEMA,
    status: "streaming",
    generatedAt,
    revision,
    source: { path: ".", kind: "thread" },
    thread: { id: threadId, turnId, label, lastActiveAt },
    changes: changes.slice(0, STREAMING_DIFF_MAX_CHANGES),
  });
}

function object(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value;
}

function count(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a non-negative integer.`);
}

function containedPath(value) {
  return typeof value === "string" && value && !value.startsWith("/") && !value.split("/").includes("..");
}

export function assertStreamingDiffData(value) {
  const payload = object(value, "Streaming Diff payload");
  if (payload.schema !== STREAMING_DIFF_SCHEMA) throw new Error(`Streaming Diff schema must be ${STREAMING_DIFF_SCHEMA}.`);
  if (payload.status !== "streaming") throw new Error("Streaming Diff status must be streaming.");
  if (!Number.isFinite(Date.parse(payload.generatedAt))) throw new Error("Streaming Diff generatedAt must be ISO-8601.");
  count(payload.revision, "Streaming Diff revision");
  const source = object(payload.source, "Streaming Diff source");
  if (source.path !== "." || source.kind !== "thread") throw new Error("Streaming Diff source must be the selected thread tree.");
  const thread = object(payload.thread, "Streaming Diff thread");
  requiredString(thread.id, "Streaming Diff thread id");
  if (thread.turnId !== null) requiredString(thread.turnId, "Streaming Diff turn id");
  requiredString(thread.label, "Streaming Diff thread label", 120);
  if (!Number.isFinite(Date.parse(thread.lastActiveAt))) throw new Error("Streaming Diff lastActiveAt must be ISO-8601.");
  if (!Array.isArray(payload.changes) || payload.changes.length > STREAMING_DIFF_MAX_CHANGES) {
    throw new Error(`Streaming Diff changes must contain at most ${STREAMING_DIFF_MAX_CHANGES} entries.`);
  }
  let previousRevision = Number.POSITIVE_INFINITY;
  for (const change of payload.changes) {
    object(change, "Streaming Diff change");
    count(change.revision, "Streaming Diff change revision");
    if (change.revision < 1 || change.revision >= previousRevision) throw new Error("Streaming Diff changes must be newest-first with unique revisions.");
    previousRevision = change.revision;
    requiredString(change.id, "Streaming Diff change id");
    if (!Number.isFinite(Date.parse(change.timestamp))) throw new Error("Streaming Diff change timestamp must be ISO-8601.");
    if (!containedPath(change.sourcePath)) throw new Error("Streaming Diff change source path must be a contained relative path.");
    const actor = object(change.actor, "Streaming Diff actor");
    if (actor.threadId !== thread.id) throw new Error("Streaming Diff change belongs to another thread.");
    requiredString(actor.turnId, "Streaming Diff actor turn id");
    requiredString(actor.toolName, "Streaming Diff actor tool name");
    const summary = object(change.summary, "Streaming Diff change summary");
    count(summary.additions, "Streaming Diff additions");
    count(summary.deletions, "Streaming Diff deletions");
    count(summary.changedLines, "Streaming Diff changed lines");
    if (summary.changedLines !== summary.additions + summary.deletions) throw new Error("Streaming Diff changed-line summary does not reconcile.");
    if (!Array.isArray(change.lines)) throw new Error("Streaming Diff change lines must be an array.");
    for (const line of change.lines) {
      object(line, "Streaming Diff line");
      if (!["context", "addition", "deletion"].includes(line.kind)) throw new Error("Streaming Diff line kind is invalid.");
      if (typeof line.text !== "string") throw new Error("Streaming Diff line text must be a string.");
      for (const key of ["oldNumber", "newNumber"]) {
        if (line[key] !== null && (!Number.isSafeInteger(line[key]) || line[key] < 1)) throw new Error(`Streaming Diff ${key} is invalid.`);
      }
    }
  }
  if (payload.changes[0]?.revision > payload.revision) throw new Error("Streaming Diff change revision is ahead of the payload revision.");
  return payload;
}
