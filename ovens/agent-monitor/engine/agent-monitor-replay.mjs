import {
  closeSync,
  constants,
  fstatSync,
  openSync,
  readSync,
} from "node:fs";

export function readAgentMonitorTail(path, end, limit, maxFileBytes) {
  let fd;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const before = fstatSync(fd);
    if (!before.isFile() || before.size > maxFileBytes || end < 0 || end > before.size) {
      throw new Error("Codex session tail is not a bounded regular-file range");
    }
    const start = Math.max(0, end - limit);
    const buffer = Buffer.alloc(end - start);
    let bytes = 0;
    while (bytes < buffer.length) {
      const count = readSync(fd, buffer, bytes, buffer.length - bytes, start + bytes);
      if (count === 0) break;
      bytes += count;
    }
    const after = fstatSync(fd);
    if (before.dev !== after.dev || before.ino !== after.ino || after.size < before.size) {
      throw new Error("Codex session changed identity during tail read");
    }
    let source = buffer.subarray(0, bytes);
    if (start > 0) {
      const newline = source.indexOf(0x0a);
      source = newline < 0 ? Buffer.alloc(0) : source.subarray(newline + 1);
    }
    const lineCount = source.length
      ? source.toString("utf8").split("\n").length - 1
      : 0;
    return { before, lineCount, source };
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
