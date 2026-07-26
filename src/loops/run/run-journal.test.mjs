import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import { appendJournalRecord, createJournalRecord, readJournal, writeInitialJournal } from "./run-journal.mjs";
import { created } from "./m2-test-fixtures.mjs";

test("journal accepts one exact writer tail and rejects malformed storage", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m2-journal-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeInitialJournal({ runDirectory: root, at: 0, payload: created() }); const directory = join(root, "journal");
  writeFileSync(join(directory, ".append-0123456789abcdef.tmp"), "partial"); assert.equal(readJournal(directory).length, 1);
  writeFileSync(join(directory, ".other.tmp"), "partial"); assert.throws(() => readJournal(directory), /invalid journal entry/u);
  rmSync(join(directory, ".other.tmp")); writeFileSync(join(directory, ".append-fedcba9876543210.tmp"), "partial"); assert.throws(() => readJournal(directory), /temporary tail/u);
});
test("journal bounds records before publication and retains a valid old tail", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m2-journal-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeInitialJournal({ runDirectory: root, at: 0, payload: created() }); const directory = join(root, "journal"), prior = readJournal(directory).at(-1);
  const record = createJournalRecord({ sequence: 2, prevDigest: prior.digest, at: 1, type: "state-changed", payload: { from: "prepared", to: "running", cause: "control" } });
  assert.throws(() => appendJournalRecord({ journalDirectory: directory, record: { ...record, value: { ...record.value, sequence: 9 } } }), /append precondition/u);
  assert.equal(readJournal(directory).length, 1);
});
test("a canonical record whose sequence disagrees with its filename is rejected", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m2-journal-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeInitialJournal({ runDirectory: root, at: 0, payload: created() }); const directory = join(root, "journal");
  const first = readJournal(directory)[0];
  writeFileSync(join(directory, "0000000000000002.json"), first.bytes);
  assert.throws(() => readJournal(directory), /sequence or hash chain/u);
  rmSync(join(directory, "0000000000000002.json"));
  assert.equal(readJournal(directory).length, 1);
});
test("the 256th record remains replayable and the 257th is rejected before link", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m2-journal-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeInitialJournal({ runDirectory: root, at: 0, payload: created() }); const directory = join(root, "journal");
  for (let sequence = 2; sequence <= 256; sequence += 1) {
    const prior = readJournal(directory).at(-1);
    appendJournalRecord({ journalDirectory: directory, record: createJournalRecord({ sequence, prevDigest: prior.digest, at: sequence, type: "state-changed", payload: { from: "prepared", to: "running", cause: "control" } }) });
  }
  assert.equal(readJournal(directory).length, 256);
  const prior = readJournal(directory).at(-1);
  assert.throws(() => appendJournalRecord({ journalDirectory: directory, record: createJournalRecord({ sequence: 257, prevDigest: prior.digest, at: 257, type: "state-changed", payload: { from: "prepared", to: "running", cause: "control" } }) }), /prospective journal/u);
  assert.equal(readJournal(directory).length, 256);
});
test("the final journal slot atomically retains a complete terminal outcome", (t) => {
  const root = mkdtempSync(join(os.tmpdir(), "m2-journal-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  writeInitialJournal({ runDirectory: root, at: 0, payload: created() }); const directory = join(root, "journal");
  for (let sequence = 2; sequence <= 255; sequence += 1) { const prior = readJournal(directory).at(-1); appendJournalRecord({ journalDirectory: directory, record: createJournalRecord({ sequence, prevDigest: prior.digest, at: sequence, type: "state-changed", payload: { from: "prepared", to: "running", cause: "control" } }) }); }
  const prior = readJournal(directory).at(-1), terminal = createJournalRecord({ sequence: 256, prevDigest: prior.digest, at: 256, type: "terminal-node-committed", payload: { kind: "exhausted", summary: "minutes", from: "running", to: "budget-exhausted", nodeId: "exhausted", attempt: 1 } });
  appendJournalRecord({ journalDirectory: directory, record: terminal }); assert.equal(readJournal(directory).length, 256); assert.equal(readJournal(directory).at(-1).value.type, "terminal-node-committed");
});
