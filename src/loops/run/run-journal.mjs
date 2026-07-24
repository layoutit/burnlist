import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, linkSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const MAX_JOURNAL_RECORDS = 256;
const MAX_RECORDS = MAX_JOURNAL_RECORDS, MAX_BYTES = 4 * 1024 * 1024, MAX_RECORD = 131072;
const TYPES = new Set(["run-created", "lease-acquired", "lease-released", "lease-revoked", "state-changed", "node-started", "invocation-started", "invocation-result", "candidate-bound", "system-outcome", "terminal-node-committed", "failure-routed", "edge-taken"]);
const names = { "run-created": ["schema", "runId", "itemRef", "graph", "authorityRequired"], "lease-acquired": ["generation", "token"], "lease-released": ["generation", "token"], "lease-revoked": ["generation", "token"], "state-changed": ["from", "to", "cause"], "node-started": ["nodeId", "attempt"], "invocation-started": ["nodeId", "attempt", "invocationId"], "system-outcome": ["kind", "summary"], "terminal-node-committed": ["kind", "summary", "from", "to", "nodeId", "attempt"], "invocation-result": ["invocationId", "kind", "summary", "outputBytes", "candidateId"], "candidate-bound": ["candidateId", "candidateContext"], "failure-routed": ["from", "kind", "to"], "edge-taken": ["from", "on", "to"] };
const fileName = (sequence) => `${String(sequence).padStart(16, "0")}.json`;
const tempName = /^\.append-[a-f0-9]{16}\.tmp$/u;
const fail = (message, code = "EJOURNAL") => { throw Object.assign(new Error(`Run journal: ${message}`), { code }); };
const exact = (value, keys) => Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

export function validateJournalEvent(type, payload) { if (!TYPES.has(type) || !exact(payload, names[type])) fail("event payload is not closed"); return payload; }
export function createJournalRecord({ sequence, prevDigest, at, type, payload }) {
  if (!Number.isSafeInteger(sequence) || sequence < 1 || !Number.isSafeInteger(at) || at < 0 || !(prevDigest === null || /^sha256:[a-f0-9]{64}$/u.test(prevDigest))) fail("invalid record header");
  validateJournalEvent(type, payload);
  const value = { schema: "burnlist-loop-m2-journal@1", sequence, prevDigest, at, type, payload }, bytes = Buffer.from(`${JSON.stringify(value)}\n`);
  if (bytes.length > MAX_RECORD || !exact(value, ["schema", "sequence", "prevDigest", "at", "type", "payload"])) fail("record exceeds bounds");
  return Object.freeze({ value: Object.freeze(value), bytes, digest: digest(bytes) });
}
export function parseJournalRecord(bytes) {
  let value; try { value = JSON.parse(Buffer.from(bytes).toString("utf8")); } catch { fail("record is not JSON"); }
  if (!exact(value, ["schema", "sequence", "prevDigest", "at", "type", "payload"]) || value.schema !== "burnlist-loop-m2-journal@1") fail("record is not closed");
  const record = createJournalRecord(value); if (!record.bytes.equals(bytes)) fail("record is not canonical"); return record;
}
export function readJournal(directory) {
  const entries = readdirSync(directory, { withFileTypes: true }); if (entries.length > MAX_RECORDS + 1) fail("too many journal entries");
  const records = []; let temporary = 0, aggregate = 0;
  for (const entry of entries) {
    const path = join(directory, entry.name), stat = lstatSync(path);
    if (tempName.test(entry.name)) { if (!entry.isFile() || entry.isSymbolicLink() || stat.size > MAX_RECORD || ++temporary > 1) fail("invalid temporary tail"); continue; }
    const match = /^(\d{16})\.json$/u.exec(entry.name); if (!match || !entry.isFile() || entry.isSymbolicLink()) fail("invalid journal entry");
    aggregate += stat.size; if (stat.size < 2 || stat.size > MAX_RECORD || aggregate > MAX_BYTES) fail("journal exceeds bounds");
    records.push({ sequence: Number(match[1]), bytes: readFileSync(path) });
  }
  if (!records.length || records.length > MAX_RECORDS) fail("journal is empty or too large"); records.sort((a, b) => a.sequence - b.sequence);
  return Object.freeze(records.map((entry, index) => { if (entry.sequence !== index + 1) fail("sequence is discontinuous"); const record = parseJournalRecord(entry.bytes), prior = records[index - 1]?.record; if (record.value.sequence !== entry.sequence || record.value.prevDigest !== (prior?.digest ?? null)) fail("sequence or hash chain is invalid"); entry.record = record; return record; }));
}
function durableCreate(path, bytes) { let fd; try { fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); writeFileSync(fd, bytes); fsyncSync(fd); } finally { if (fd !== undefined) closeSync(fd); } }
function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY); try { fsyncSync(fd); } finally { closeSync(fd); } }
export function writeInitialJournal({ runDirectory, payload, at }) { const directory = join(runDirectory, "journal"); mkdirSync(directory, { mode: 0o700 }); const record = createJournalRecord({ sequence: 1, prevDigest: null, at, type: "run-created", payload }); durableCreate(join(directory, fileName(1)), record.bytes); syncDirectory(directory); return record; }
export function appendJournalRecord({ journalDirectory, record, hooks = {} }) {
  const existing = readJournal(journalDirectory), prior = existing.at(-1), aggregate = existing.reduce((total, item) => total + item.bytes.length, 0);
  if (existing.length >= MAX_RECORDS || aggregate + record.bytes.length > MAX_BYTES) fail("prospective journal exceeds bounds");
  if (record.value.sequence !== prior.value.sequence + 1 || record.value.prevDigest !== prior.digest) fail("append precondition failed", "ESTALE");
  const temporary = join(journalDirectory, `.append-${randomBytes(8).toString("hex")}.tmp`), target = join(journalDirectory, fileName(record.value.sequence));
  try { durableCreate(temporary, record.bytes); hooks.beforePublish?.({ record, target }); linkSync(temporary, target); unlinkSync(temporary); syncDirectory(journalDirectory); return record; } finally { rmSync(temporary, { force: true }); }
}
/** Preflights the whole contiguous batch before publishing any member. */
