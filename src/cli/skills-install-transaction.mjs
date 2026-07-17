import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";

function lstatOrNull(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function targetIdentity(path) {
  const stat = lstatSync(path);
  return { ino: stat.ino, dev: stat.dev };
}

function hasTargetIdentity(path, identity) {
  const stat = lstatOrNull(path);
  return Boolean(stat && stat.ino === identity.ino && stat.dev === identity.dev);
}

function ensureDirectory(path, created) {
  const missing = [];
  let current = path;
  while (!lstatOrNull(current)) {
    missing.push(current);
    const parent = dirname(current);
    if (parent === current) throw new Error(`could not create skill directory: ${path}`);
    current = parent;
  }
  for (const directory of missing.reverse()) {
    mkdirSync(directory);
    created.push(directory);
  }
}

function removeCreatedDirectories(created, failures) {
  for (const directory of created.reverse()) {
    try { rmdirSync(directory); } catch (error) {
      if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY") failures.push(`could not remove ${directory}: ${error.message}`);
    }
  }
}

function cleanBackups(changes) {
  const failures = [];
  for (const { transaction } of changes) {
    if (!transaction) continue;
    try { rmSync(transaction, { recursive: true, force: true }); } catch (error) {
      failures.push(`could not remove committed backup ${transaction}: ${error.message}`);
    }
  }
  if (failures.length) throw new Error(`install committed, but backup cleanup failed: ${failures.join("; ")}`);
}

function rollback(changes, createdDirectories, exclude) {
  const failures = [];
  for (const { registration, backup, createdIdentity, transaction } of changes.reverse()) {
    try {
      // A newly-created target has no backup. Only remove it when it is still
      // the exact filesystem object this transaction published; a replacement
      // entry belongs to somebody else.
      if (backup || (createdIdentity && hasTargetIdentity(registration.target, createdIdentity))) {
        rmSync(registration.target, { recursive: true, force: true });
      }
      if (backup) renameSync(backup, registration.target);
    } catch (error) {
      failures.push(`could not restore ${registration.target}: ${error.message}`);
      continue;
    }
    if (transaction) {
      try { rmSync(transaction, { recursive: true, force: true }); } catch (error) {
        failures.push(`could not remove rollback backup ${transaction}: ${error.message}`);
      }
    }
  }
  try { exclude?.restore?.(); } catch (error) {
    failures.push(`could not restore exclude file: ${error.message}`);
  }
  removeCreatedDirectories(createdDirectories, failures);
  return failures;
}

// Target replacements are reversible renames until all targets and the exclude
// update have committed. create() must publish new targets atomically and call
// onCreated immediately after publishing a missing target, before its dir fsync.
export function runInstallTransaction({ planned, revalidate, create, exclude, beforeMutation }) {
  const changes = [];
  const createdDirectories = [];
  try {
    for (const registration of planned) {
      if (registration.action === "keep") continue;
      ensureDirectory(registration.targetRoot, createdDirectories);
      beforeMutation?.(registration);
      Object.assign(registration, revalidate(registration));
      if (registration.action === "keep") continue;
      if (registration.state !== "missing") {
        const transaction = mkdtempSync(join(registration.targetRoot, ".burnlist-skill-transaction-"));
        const backup = join(transaction, "previous");
        try {
          // Recheck after making the backup container and immediately before the rename.
          Object.assign(registration, revalidate(registration));
          if (registration.action === "keep") {
            rmSync(transaction, { recursive: true, force: true });
          } else if (registration.state === "missing") {
            rmSync(transaction, { recursive: true, force: true });
            let recorded = false;
            const onCreated = () => {
              if (!recorded) {
                changes.push({ registration, createdIdentity: targetIdentity(registration.target) });
                recorded = true;
              }
            };
            create(registration, onCreated);
            onCreated();
          } else {
            renameSync(registration.target, backup);
            changes.push({ registration, transaction, backup });
            create(registration);
          }
        } catch (error) {
          if (!changes.some((change) => change.transaction === transaction)) {
            try { rmSync(transaction, { recursive: true, force: true }); } catch (cleanupError) {
              throw new AggregateError([error, cleanupError], `install failed: ${error.message}; could not remove transaction backup ${transaction}: ${cleanupError.message}`);
            }
          }
          throw error;
        }
      } else {
        let recorded = false;
        const onCreated = () => {
          if (!recorded) {
            changes.push({ registration, createdIdentity: targetIdentity(registration.target) });
            recorded = true;
          }
        };
        create(registration, onCreated);
        onCreated();
      }
    }
    if (exclude?.changed) exclude.write();
    exclude?.afterWrite?.();
  } catch (error) {
    const failures = rollback(changes, createdDirectories, exclude);
    if (failures.length) {
      throw new AggregateError([error], `install failed: ${error.message}; rollback incomplete: ${failures.join("; ")}`);
    }
    throw error;
  }
  // Backups are disposable only after the full transaction, including exclude write, commits.
  cleanBackups(changes);
}
