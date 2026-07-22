import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";

function fileIdentity(entry) {
  return { dev: entry.dev, ino: entry.ino };
}

function sameFile(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

function regularFileError(path, label) {
  return new Error(`${label} must be a regular file (symbolic links are not allowed): ${path}`);
}

export function readTextFileWithLimit(path, maxBytes, label, { assertPath } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError("maxBytes must be a non-negative safe integer");
  assertPath?.();
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink()) throw regularFileError(path, label);
  let descriptor;
  try {
    const noFollow = Number.isInteger(constants.O_NOFOLLOW) ? constants.O_NOFOLLOW : 0;
    const nonBlocking = Number.isInteger(constants.O_NONBLOCK) ? constants.O_NONBLOCK : 0;
    assertPath?.();
    try {
      descriptor = openSync(path, constants.O_RDONLY | noFollow | nonBlocking);
    } catch (error) {
      if (error?.code === "ELOOP") throw regularFileError(path, label);
      if (!noFollow || !["EINVAL", "ENOTSUP", "EOPNOTSUPP"].includes(error?.code)) throw error;
      // Some platforms expose O_NOFOLLOW without accepting it for regular-file opens.
      // The before/after identity checks below are the portable fallback.
      assertPath?.();
      descriptor = openSync(path, constants.O_RDONLY | nonBlocking);
    }
    assertPath?.();
    const opened = fstatSync(descriptor);
    if (!opened.isFile()) throw regularFileError(path, label);
    const after = lstatSync(path);
    if (!after.isFile() || after.isSymbolicLink() || !sameFile(fileIdentity(opened), fileIdentity(after))) {
      throw regularFileError(path, label);
    }
    if (opened.size > maxBytes) {
      throw new Error(`${label} is ${opened.size} bytes, over the ${maxBytes} byte limit`);
    }
    const buffer = Buffer.allocUnsafe(maxBytes + 1);
    let total = 0;
    while (total < buffer.length) {
      const bytes = readSync(descriptor, buffer, total, buffer.length - total, null);
      if (bytes === 0) break;
      total += bytes;
    }
    assertPath?.();
    if (total > maxBytes) throw new Error(`${label} is over the ${maxBytes} byte limit`);
    const text = buffer.subarray(0, total).toString("utf8");
    assertPath?.();
    return text;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
