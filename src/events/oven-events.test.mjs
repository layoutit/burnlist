import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  assertOvenEvent,
  normalizeOvenEvent,
  OVEN_EVENT_MAX_DISCOVERY_SCANS,
  OVEN_EVENT_MAX_BYTES,
  OVEN_EVENT_MAX_SEQUENCE_SCANS,
  publishOvenEvent,
  readOvenEvents,
} from "./oven-events.mjs";
import { serializeOvenEvent } from "./oven-event-contract.mjs";

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
    `${String(first.event.sequence).padStart(12, "0")}.idx`,
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
  writeFileSync(join(eventRoot, "sequence", "000000000002.idx"), `${brokenId}\n`);
  writeFileSync(join(eventRoot, "sequence.txt"), "2\n");
  const warnings = [];
  assert.deepEqual(readOvenEvents(repo, { ovenIds: ["other-oven"], onInvalid: (error) => warnings.push(error.message) }), [second.event]);
  assert.equal(warnings.length, 0);
  assert.deepEqual(readOvenEvents(repo, { onInvalid: (error) => warnings.push(error.message) }), [first.event, second.event]);
  assert.equal(warnings.length, 1);
});

test("Oven event reader limits preserve the oldest unread sequence", (t) => {
  const repo = fixture(t);
  const first = publishOvenEvent(repo, input({ cursor: "run-1" }));
  const second = publishOvenEvent(repo, input({ cursor: "run-2" }));
  const other = publishOvenEvent(repo, input({ ovenId: "other-oven", cursor: "other-run" }));
  assert.deepEqual(readOvenEvents(repo, { limit: 1 }), [first.event]);
  assert.deepEqual(readOvenEvents(repo, { limitPerOven: 1 }), [first.event, other.event]);
  assert.deepEqual(readOvenEvents(repo, { ovenIds: [] }), [first.event, second.event, other.event]);
  assert.throws(() => readOvenEvents(repo, { limit: 1_001 }), /from 1 to 1000/u);
});

test("Oven event size validation includes the exact newline written to disk", (t) => {
  const repo = fixture(t);
  const large = Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`field${index}`, "x".repeat(4_096)]));
  const draft = normalizeOvenEvent(input({ payload: { ...large, tail: "" } }));
  const baseBytes = Buffer.byteLength(serializeOvenEvent({ ...draft, sequence: 1 }));
  const tailLength = OVEN_EVENT_MAX_BYTES - baseBytes;
  assert.ok(tailLength > 0 && tailLength <= 4_096);
  const exact = publishOvenEvent(repo, input({ payload: { ...large, tail: "x".repeat(tailLength) } }));
  assert.equal(statSync(exact.path).size, OVEN_EVENT_MAX_BYTES);
  assert.deepEqual(readOvenEvents(repo), [exact.event]);

  const counter = join(dirname(dirname(exact.path)), "sequence.txt");
  assert.throws(
    () => publishOvenEvent(repo, input({ cursor: "too-large", payload: { ...large, tail: "x".repeat(tailLength + 1) } })),
    /larger than 32768 bytes after sequencing/u,
  );
  assert.equal(readFileSync(counter, "utf8"), "1\n");
});

test("Oven event sequence recovery ignores corrupt records but propagates containment failures", (t) => {
  const root = fixture(t);
  const repo = join(root, "repo");
  const outside = join(root, "outside-counter");
  mkdirSync(repo);
  writeFileSync(outside, "1\n");
  const first = publishOvenEvent(repo, input({ cursor: "run-1" }));
  const eventRoot = dirname(dirname(first.path));
  rmSync(join(eventRoot, "sequence.txt"));
  writeFileSync(join(eventRoot, "records", `oe1-${"e".repeat(64)}.json`), "{");
  const second = publishOvenEvent(repo, input({ cursor: "run-2" }));
  assert.equal(second.event.sequence, 2);

  rmSync(join(eventRoot, "sequence.txt"));
  symlinkSync(outside, join(eventRoot, "sequence.txt"));
  assert.throws(() => publishOvenEvent(repo, input({ cursor: "run-3" })), /escapes/u);
  rmSync(join(eventRoot, "sequence.txt"));
  writeFileSync(join(eventRoot, "sequence.txt"), "2\n");
  assert.deepEqual(readOvenEvents(repo).map((event) => event.sequence), [1, 2]);
});

test("Oven event sequence recovery bounds record-directory scans", (t) => {
  const repo = fixture(t);
  const first = publishOvenEvent(repo, input());
  const eventRoot = dirname(dirname(first.path));
  const recordsDir = join(eventRoot, "records");
  rmSync(join(eventRoot, "sequence.txt"));
  for (let index = 0; index <= OVEN_EVENT_MAX_SEQUENCE_SCANS; index += 1) {
    writeFileSync(join(recordsDir, `pad-${index}.txt`), "x");
  }
  assert.throws(
    () => publishOvenEvent(repo, input({ cursor: "after" })),
    /scan limit|recovery exceeded/u,
  );
  assert.equal(existsSync(join(eventRoot, "sequence.txt")), false);
});

test("Oven event counter-only crash gaps remain consumed reservations", (t) => {
  const repo = fixture(t);
  const first = publishOvenEvent(repo, input({ cursor: "run-1" }));
  const eventRoot = dirname(dirname(first.path));
  writeFileSync(join(eventRoot, "sequence.txt"), "3\n");
  const next = publishOvenEvent(repo, input({ cursor: "run-after-crash" }));
  assert.equal(next.event.sequence, 4);
  assert.deepEqual(readOvenEvents(repo).map((event) => event.sequence), [1, 4]);
});

test("Oven event reads bound cursor and stream-directory discovery work", (t) => {
  const repo = fixture(t);
  const eventsRoot = join(repo, ".local", "burnlist", "events");
  mkdirSync(eventsRoot, { recursive: true });
  for (let index = 0; index <= OVEN_EVENT_MAX_DISCOVERY_SCANS; index += 1) {
    writeFileSync(join(eventsRoot, `unrelated-${index}`), "x");
  }
  assert.throws(() => readOvenEvents(repo), /discovery is limited/u);
  const afterSequences = Object.fromEntries(Array.from({ length: 65 }, (_, index) => [`oven-${index}`, 0]));
  assert.throws(() => readOvenEvents(fixture(t), { afterSequences }), /afterSequences is limited to 64 streams/u);
});

test("Oven event corruption blocks only its own stream before later sequences", (t) => {
  const repo = fixture(t);
  const first = publishOvenEvent(repo, input({ cursor: "run-1" }));
  publishOvenEvent(repo, input({ cursor: "run-2" }));
  const healthy = publishOvenEvent(repo, input({ ovenId: "other-oven", cursor: "healthy" }));
  writeFileSync(first.path, "{");
  const warnings = [];
  assert.deepEqual(readOvenEvents(repo, { onInvalid: (error) => warnings.push(error.message) }), [healthy.event]);
  assert.equal(warnings.length, 1);
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
