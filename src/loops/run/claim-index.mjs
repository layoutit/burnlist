import { closeSync, constants, fstatSync, fsyncSync, lstatSync, mkdirSync, openSync, readSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { withDirectoryLock } from "../../server/dir-lock.mjs";
import { isRunRef } from "./run-ref.mjs";

const CLAIM = /^cl1-sha256:[a-f0-9]{64}$/u;
const fail = (message, code = "EBOUNDS") => {
  throw Object.assign(new Error(`Claim index: ${message}`), { code });
};

function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Immutable O(1) ClaimRef hints; every consumer must still verify the Run journal. */
export function createClaimIndex({ base, random }) {
  const directory = join(base, "claims");
  const pathFor = (claimId) => {
    if (!CLAIM.test(claimId)) fail("invalid ClaimRef", "ECLAIM");
    return join(directory, `${claimId.slice("cl1-sha256:".length)}.json`);
  };
  function read(claimId) {
    const target = pathFor(claimId); let fd;
    try {
      const entry = lstatSync(target);
      if (!entry.isFile() || entry.isSymbolicLink() || (entry.mode & 0o777) !== 0o600
        || entry.size < 2 || entry.size > 512) fail("entry is corrupt");
      fd = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
      const before = fstatSync(fd), bytes = Buffer.alloc(before.size);
      if (!before.isFile() || before.dev !== entry.dev || before.ino !== entry.ino
        || before.size !== entry.size || (before.mode & 0o777) !== 0o600
        || readSync(fd, bytes, 0, bytes.length, 0) !== bytes.length) fail("entry changed while reading");
      const after = fstatSync(fd), linked = lstatSync(target);
      if (after.dev !== before.dev || after.ino !== before.ino || after.size !== before.size
        || linked.isSymbolicLink() || linked.dev !== before.dev || linked.ino !== before.ino
        || linked.size !== before.size) fail("entry changed while reading");
      let value; try { value = JSON.parse(bytes); } catch { fail("entry is corrupt"); }
      if (!value || Object.keys(value).length !== 3 || value.schema !== "burnlist-loop-claim-index@1"
        || value.claimId !== claimId || !isRunRef(value.runId)
        || !Buffer.from(`${JSON.stringify(value)}\n`).equals(bytes)) fail("entry is corrupt");
      return value;
    } catch (error) {
      if (error?.code === "ENOENT") return null;
      throw error;
    } finally { if (fd !== undefined) closeSync(fd); }
  }
  function write(runId, claimId) {
    if (!isRunRef(runId)) fail("invalid RunRef", "ECLAIM");
    const value = { schema: "burnlist-loop-claim-index@1", claimId, runId };
    const bytes = Buffer.from(`${JSON.stringify(value)}\n`), target = pathFor(claimId);
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    return withDirectoryLock({
      lockPath: join(base, ".claim-index.lock"),
      reclaimLiveAfterAge: false,
      errorFactory: () => fail("index is locked", "ELOCKED"),
      fn() {
        const existing = read(claimId);
        if (existing) {
          if (existing.runId !== runId) fail("entry conflicts", "ECLAIM");
          return;
        }
        const temporary = `${target}.${random(8).toString("hex")}.tmp`; let fd;
        try {
          fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
          writeFileSync(fd, bytes); fsyncSync(fd); closeSync(fd); fd = undefined;
          renameSync(temporary, target); syncDirectory(directory);
        } finally {
          if (fd !== undefined) closeSync(fd);
          rmSync(temporary, { force: true });
        }
      }
    });
  }
  return Object.freeze({ read, write });
}
