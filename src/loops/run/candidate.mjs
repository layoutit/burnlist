import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { prefixed } from "../dsl/hash.mjs";

const EXCLUDED = new Set([".git", ".local", "node_modules"]);
const MAX_FILES = 256, MAX_FILE_BYTES = 65_536, MAX_TOTAL_BYTES = 1_048_576;
const fail = (message) => { throw Object.assign(new Error(`Loop candidate: ${message}`), { code: "ECANDIDATE" }); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function fileRecord(root, path) {
  const before = lstatSync(path);
  if (!before.isFile() || before.isSymbolicLink() || before.size > MAX_FILE_BYTES) fail(`candidate file is unsafe or too large: ${relative(root, path)}`);
  const bytes = readFileSync(path), after = lstatSync(path);
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeMs !== after.mtimeMs || !bytes.length && before.size)
    fail(`candidate file changed while reading: ${relative(root, path)}`);
  return `${relative(root, path)}\t${bytes.length}\t${sha256(bytes)}`;
}

/** A bounded, git-free repository manifest.  This is detected-at-boundaries, not a hostile-writer claim. */
export function deriveCandidate({ repoRoot }) {
  const root = resolve(repoRoot), rootBefore = lstatSync(root);
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) fail("repository root is unsafe");
  const files = [], pending = [root]; let total = 0;
  while (pending.length) {
    const directory = pending.pop(), entries = readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (directory === root && EXCLUDED.has(entry.name)) continue;
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) fail(`candidate path is symbolic: ${relative(root, path)}`);
      if (entry.isDirectory()) { pending.push(path); continue; }
      if (!entry.isFile()) continue;
      const record = fileRecord(root, path), size = Number(record.split("\t")[1]);
      total += size;
      if (++files.length > MAX_FILES || total > MAX_TOTAL_BYTES) fail("candidate manifest exceeds bounds");
      files.push(record);
    }
  }
  files.sort();
  const rootAfter = lstatSync(root);
  if (!rootAfter.isDirectory() || rootAfter.isSymbolicLink() || rootBefore.dev !== rootAfter.dev || rootBefore.ino !== rootAfter.ino) fail("repository root changed while capturing candidate");
  const manifest = `candidate-manifest@1\n${files.join("\n")}\n`;
  const id = prefixed("cm1-sha256:", "stage1-repository-candidate-v1", [Buffer.from(manifest)]);
  return Object.freeze({ id, context: `candidate-summary@1\ncandidate=${id}\nfiles=${files.length}\n${files.join("\n")}\n` });
}
