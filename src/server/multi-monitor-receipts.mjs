import { createHash, randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  opendirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join } from "node:path";

import { containedJoin, withRepoStateLock } from "./repo-state.mjs";

export const MULTI_MONITOR_MESSAGE_CONTRACT = "burnlist-multi-monitor-message@1";
const receiptNamePattern = /^[0-9a-f-]{36}\.json$/u;
const MAX_RECEIPTS = 512;
const MAX_RECEIPT_SCAN = 2_048;
const RECEIPT_TTL_MS = 7 * 24 * 60 * 60_000;

function receiptError(code, message, status = 409, definite = true) {
  return Object.assign(new Error(message), { code, status, definite });
}

function atomicWrite(path, value) {
  const directory = dirname(path);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const temporary = join(directory, `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  let descriptor;
  try {
    descriptor = openSync(
      temporary,
      constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL,
      0o600,
    );
    writeFileSync(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    const directoryDescriptor = openSync(directory, constants.O_RDONLY);
    try {
      fsyncSync(directoryDescriptor);
    } finally {
      closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    rmSync(temporary, { force: true });
    throw error;
  }
}

function receiptPath(repoRoot, requestId) {
  return containedJoin(repoRoot, "multi-monitor-messages", `${requestId}.json`);
}

function readReceipt(path) {
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value?.contract === MULTI_MONITOR_MESSAGE_CONTRACT ? value : null;
  } catch {
    throw receiptError("RECEIPT_CORRUPT", "The stored delivery receipt is invalid.");
  }
}

function pruneReceiptStore(repoRoot, nowMs = Date.now()) {
  const directory = containedJoin(repoRoot, "multi-monitor-messages");
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const entries = opendirSync(directory);
  let retained = 0;
  let scanned = 0;
  try {
    let entry = entries.readSync();
    while (entry) {
      if (entry.isFile() && receiptNamePattern.test(entry.name)) {
        scanned += 1;
        if (scanned > MAX_RECEIPT_SCAN) {
          throw receiptError(
            "RECEIPT_STORE_LIMIT",
            "The delivery receipt store needs maintenance before accepting more messages.",
            429,
          );
        }
        const path = join(directory, entry.name);
        try {
          if (nowMs - statSync(path).mtimeMs >= RECEIPT_TTL_MS) rmSync(path, { force: true });
          else retained += 1;
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
      entry = entries.readSync();
    }
  } finally {
    entries.closeSync();
  }
  if (retained >= MAX_RECEIPTS) {
    throw receiptError(
      "RECEIPT_STORE_LIMIT",
      "Too many recent delivery receipts. Try again after the idempotency window expires.",
      429,
    );
  }
}

export function messageDigest(message) {
  return createHash("sha256").update(message, "utf8").digest("hex");
}

export function sameMessageRequest(receipt, prepared) {
  return receipt.threadId === prepared.threadId
    && receipt.messageDigest === prepared.messageDigest
    && receipt.requestId === prepared.requestId;
}

export function prepareMessageReceipt(repoRoot, prepared) {
  return withRepoStateLock(repoRoot, () => {
    const path = receiptPath(repoRoot, prepared.requestId);
    const prior = readReceipt(path);
    if (prior && !sameMessageRequest(prior, prepared)) {
      throw receiptError("REQUEST_ID_REUSED", "This delivery id is already bound to another message.");
    }
    if (prior?.status === "accepted") return prior;
    if (prior?.status === "prepared") {
      throw receiptError(
        "DELIVERY_UNCERTAIN",
        "Delivery may already have been accepted. Inspect the Codex task before sending a new message.",
        409,
        false,
      );
    }
    pruneReceiptStore(repoRoot);
    atomicWrite(path, prepared);
    return null;
  });
}

export function finishMessageReceipt(repoRoot, receipt) {
  return withRepoStateLock(repoRoot, () => {
    const path = receiptPath(repoRoot, receipt.requestId);
    const prior = readReceipt(path);
    if (!prior || !sameMessageRequest(prior, receipt)) {
      throw receiptError(
        "RECEIPT_CHANGED",
        "The delivery receipt changed while the message was being sent.",
      );
    }
    atomicWrite(path, receipt);
    return receipt;
  });
}
