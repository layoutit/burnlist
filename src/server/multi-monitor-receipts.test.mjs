import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  finishMessageReceipt,
  messageDigest,
  MULTI_MONITOR_MESSAGE_CONTRACT,
  prepareMessageReceipt,
} from "./multi-monitor-receipts.mjs";

function fixture(testBody) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-multi-monitor-receipts-"));
  return Promise.resolve().then(() => testBody(root)).finally(() => {
    rmSync(root, { recursive: true, force: true });
  });
}

function receipt(requestId) {
  return {
    contract: MULTI_MONITOR_MESSAGE_CONTRACT,
    requestId,
    threadId: "thread-1",
    messageDigest: messageDigest("Exact message."),
    status: "prepared",
    preparedAt: "2026-07-30T12:00:00.000Z",
  };
}

test("delivery receipts are private and atomically advance to accepted", () => fixture((root) => {
  const requestId = "019fb4c7-c14e-7600-8ef0-5f0736bc4e75";
  const prepared = receipt(requestId);
  assert.equal(prepareMessageReceipt(root, prepared), null);
  const directory = join(root, ".local", "burnlist", "multi-monitor-messages");
  const path = join(directory, `${requestId}.json`);
  assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  const accepted = finishMessageReceipt(root, {
    ...prepared,
    status: "accepted",
    acceptedAt: "2026-07-30T12:00:01.000Z",
    delivery: "started",
    turnId: "turn-1",
  });
  assert.equal(accepted.status, "accepted");
  assert.equal(JSON.parse(readFileSync(path, "utf8")).turnId, "turn-1");
}));

test("the recent receipt window has a hard aggregate quota", () => fixture((root) => {
  const directory = join(root, ".local", "burnlist", "multi-monitor-messages");
  mkdirSync(directory, { recursive: true });
  for (let index = 0; index < 512; index += 1) {
    const requestId = `${index.toString(16).padStart(8, "0")}-0000-7000-8000-000000000000`;
    writeFileSync(join(directory, `${requestId}.json`), JSON.stringify(receipt(requestId)));
  }
  assert.throws(
    () => prepareMessageReceipt(root, receipt("ffffffff-0000-7000-8000-000000000000")),
    (error) => error.code === "RECEIPT_STORE_LIMIT" && error.status === 429,
  );
}));

test("expired receipts are pruned before quota accounting", () => fixture((root) => {
  const directory = join(root, ".local", "burnlist", "multi-monitor-messages");
  const oldId = "00000000-0000-7000-8000-000000000000";
  const oldPath = join(directory, `${oldId}.json`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(oldPath, JSON.stringify(receipt(oldId)));
  utimesSync(oldPath, new Date(0), new Date(0));
  prepareMessageReceipt(root, receipt("ffffffff-0000-7000-8000-000000000000"));
  assert.equal(statSync(directory).isDirectory(), true);
  assert.throws(() => statSync(oldPath), (error) => error.code === "ENOENT");
}));
