import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertOvenEvent,
  normalizeOvenEvent,
  publishOvenEvent,
  readOvenEvents,
} from "./oven-events.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-events-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function input(overrides = {}) {
  return {
    ovenId: "future-oven",
    subjectId: "subject-1",
    kind: "iteration",
    phase: "complete",
    cursor: "run-1",
    occurredAt: "2026-07-21T12:00:00.000Z",
    payload: { result: "advanced", count: 1 },
    ...overrides,
  };
}

test("Oven event identity is deterministic while occurrence and payload remain observational", () => {
  const first = normalizeOvenEvent(input());
  const later = normalizeOvenEvent(input({ occurredAt: "2026-07-21T12:01:00.000Z", payload: { result: "changed" } }));
  assert.equal(first.eventId, later.eventId);
  assert.equal(assertOvenEvent({ ...first, sequence: 1 }).authority, "observational");
  assert.throws(() => assertOvenEvent({ ...first, sequence: 1, cursor: "different" }), /canonical identity/u);
  assert.throws(() => normalizeOvenEvent({ ...input(), extra: true }), /unsupported field/u);
  assert.throws(() => normalizeOvenEvent(input({ payload: { value: Number.NaN } })), /non-finite/u);
});

test("Oven event store publishes atomically and keeps the first copy on retry", (t) => {
  const repo = fixture(t);
  const first = publishOvenEvent(repo, input());
  const retry = publishOvenEvent(repo, input({ occurredAt: "2026-07-21T12:05:00.000Z", payload: { result: "retry" } }));
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.event, first.event);
  assert.equal(readFileSync(first.path, "utf8"), `${JSON.stringify(first.event)}\n`);
  assert.deepEqual(readOvenEvents(repo), [first.event]);
});

test("Oven event retry repairs an interrupted record-before-index publication", (t) => {
  const repo = fixture(t);
  const first = publishOvenEvent(repo, input());
  const eventRoot = dirname(dirname(first.path));
  const index = join(
    eventRoot,
    "sequence",
    `${String(first.event.sequence).padStart(12, "0")}-${first.event.eventId}.idx`,
  );
  rmSync(index);
  assert.deepEqual(readOvenEvents(repo), []);

  const retry = publishOvenEvent(repo, input({ payload: { result: "retry" } }));
  assert.equal(retry.created, false);
  assert.deepEqual(retry.event, first.event);
  assert.deepEqual(readOvenEvents(repo), [first.event]);
});

test("Oven event reader filters Ovens and ignores corrupt or noncanonical files", (t) => {
  const repo = fixture(t);
  const first = publishOvenEvent(repo, input());
  const second = publishOvenEvent(repo, input({ ovenId: "other-oven", cursor: "run-2", occurredAt: "2026-07-21T12:01:00.000Z" }));
  const eventRoot = dirname(dirname(first.path));
  const brokenId = `oe1-${"f".repeat(64)}`;
  const broken = join(eventRoot, "records", `${brokenId}.json`);
  writeFileSync(broken, "{");
  writeFileSync(join(eventRoot, "sequence", `000000000003-${brokenId}.idx`), "");
  const warnings = [];
  assert.deepEqual(readOvenEvents(repo, { ovenIds: ["other-oven"], onInvalid: (error) => warnings.push(error.message) }), [second.event]);
  assert.equal(warnings.length, 0);
  assert.deepEqual(readOvenEvents(repo, { onInvalid: (error) => warnings.push(error.message) }), [first.event, second.event]);
  assert.equal(warnings.length, 1);
});

test("Oven event reader limits preserve the oldest unread sequence", (t) => {
  const repo = fixture(t);
  const first = publishOvenEvent(repo, input({ cursor: "run-1" }));
  publishOvenEvent(repo, input({ cursor: "run-2" }));
  assert.deepEqual(readOvenEvents(repo, { limit: 1 }), [first.event]);
  assert.deepEqual(readOvenEvents(repo, { limitPerOven: 1 }), [first.event]);
});

test("Oven event store rejects repo-state symlinks that escape the repository", (t) => {
  const root = fixture(t);
  const repo = join(root, "repo");
  const outside = join(root, "outside");
  mkdirSync(repo);
  mkdirSync(outside);
  mkdirSync(join(repo, ".local"));
  symlinkSync(outside, join(repo, ".local", "burnlist"), "dir");
  assert.throws(() => publishOvenEvent(repo, input()), /escapes/u);
});

test("Oven event store assigns unique monotonic sequences to concurrent producers", async (t) => {
  const repo = fixture(t);
  const moduleUrl = new URL("./oven-event-store.mjs", import.meta.url).href;
  const script = [
    `import { publishOvenEvent } from ${JSON.stringify(moduleUrl)};`,
    "publishOvenEvent(process.argv[1], {",
    "  ovenId: 'future-oven', subjectId: 'subject-1', kind: 'iteration', phase: 'complete',",
    "  cursor: process.argv[2], occurredAt: '2026-07-21T12:00:00.000Z', payload: {},",
    "});",
  ].join("\n");
  const children = Array.from({ length: 8 }, (_, index) => spawn(
    process.execPath,
    ["--input-type=module", "--eval", script, repo, `run-${index}`],
    { stdio: ["ignore", "ignore", "pipe"] },
  ));
  const results = await Promise.all(children.map((child) => new Promise((resolve) => {
    let error = "";
    child.stderr.on("data", (chunk) => { error += chunk; });
    child.once("close", (status) => resolve({ status, error }));
  })));
  assert.deepEqual(results.map((result) => result.status), Array(8).fill(0), results.map((result) => result.error).join("\n"));
  const events = readOvenEvents(repo);
  assert.equal(events.length, 8);
  assert.deepEqual(events.map((event) => event.sequence).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8]);
});
