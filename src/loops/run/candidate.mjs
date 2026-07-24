import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { prefixed } from "../dsl/hash.mjs";

const MAX_FILES = 10_000, MAX_FILE_BYTES = 16_777_216, MAX_TOTAL_BYTES = 268_435_456;
const MAX_PATH_LIST_BYTES = 8_388_608;
const RUNTIME_ROOTS = new Set([".local", "node_modules"]);
const fail = (message) => { throw Object.assign(new Error(`Loop candidate: ${message}`), { code: "ECANDIDATE" }); };
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function repositoryPaths(root) {
  let bytes;
  try {
    bytes = execFileSync("git", ["-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z"], {
      encoding: "buffer", maxBuffer: MAX_PATH_LIST_BYTES,
    });
  } catch { fail("cannot enumerate the Git worktree"); }
  const paths = bytes.toString("utf8").split("\0");
  if (paths.pop() !== "" || new Set(paths).size !== paths.length
    || paths.some((path) => !path || path.startsWith("/") || path.split("/").some((part) => part === "..")))
    fail("worktree path list is invalid or exceeds bounds");
  const included = paths.filter((path) => !RUNTIME_ROOTS.has(path.split("/", 1)[0])).sort();
  if (included.length > MAX_FILES) fail("worktree path list exceeds bounds");
  return included;
}

function fileRecord(root, relativePath) {
  const path = join(root, relativePath);
  let before;
  try { before = lstatSync(path); } catch (error) {
    if (error?.code === "ENOENT") return `${relativePath}\tmissing\t0\t${sha256(Buffer.alloc(0))}`;
    throw error;
  }
  if (before.isSymbolicLink()) {
    const target = Buffer.from(readlinkSync(path, { encoding: "buffer" }));
    const after = lstatSync(path);
    if (!after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
      || before.mtimeMs !== after.mtimeMs || !target.equals(Buffer.from(readlinkSync(path, { encoding: "buffer" }))))
      fail(`candidate link changed while reading: ${relativePath}`);
    return `${relativePath}\tlink\t${target.length}\t${sha256(target)}`;
  }
  if (!before.isFile() || before.size > MAX_FILE_BYTES) fail(`candidate file is unsafe or too large: ${relativePath}`);
  const bytes = readFileSync(path), after = lstatSync(path);
  if (!after.isFile() || after.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
    || before.size !== after.size || before.mtimeMs !== after.mtimeMs || !bytes.length && before.size)
    fail(`candidate file changed while reading: ${relativePath}`);
  return `${relativePath}\tfile\t${bytes.length}\t${sha256(bytes)}`;
}

/** A bounded Git worktree manifest. This is boundary detection, not hostile-writer isolation. */
export function deriveCandidate({ repoRoot }) {
  const root = resolve(repoRoot), rootBefore = lstatSync(root);
  if (!rootBefore.isDirectory() || rootBefore.isSymbolicLink()) fail("repository root is unsafe");
  const paths = repositoryPaths(root), records = []; let total = 0;
  for (const path of paths) {
    const record = fileRecord(root, path), fields = record.split("\t");
    total += Number(fields[2]);
    if (total > MAX_TOTAL_BYTES) fail("candidate manifest exceeds bounds");
    records.push(record);
  }
  if (repositoryPaths(root).join("\0") !== paths.join("\0")) fail("worktree paths changed while capturing candidate");
  const rootAfter = lstatSync(root);
  if (!rootAfter.isDirectory() || rootAfter.isSymbolicLink() || rootBefore.dev !== rootAfter.dev || rootBefore.ino !== rootAfter.ino) fail("repository root changed while capturing candidate");
  const manifest = `candidate-manifest@2\n${records.join("\n")}\n`;
  const id = prefixed("cm1-sha256:", "stage1-repository-candidate-v1", [Buffer.from(manifest)]);
  return Object.freeze({ id, context: `candidate-summary@2\ncandidate=${id}\nfiles=${records.length}\nbytes=${total}\n` });
}
