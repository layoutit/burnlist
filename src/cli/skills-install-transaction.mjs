import { lstatSync, mkdirSync, mkdtempSync, renameSync, rmSync, rmdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { filesystemIdentity, quarantineTarget, removeQuarantinedTarget } from "./atomic-quarantine.mjs";

function lstatOrNull(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
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

function targetVacantForRestore(target, transaction) {
  const occupied = quarantineTarget({
    target,
    quarantined: join(transaction, "rollback-occupant"),
    validate: () => false,
  });
  return occupied.status === "missing";
}

function rollback(changes, createdDirectories, exclude, beforeRestore) {
  const failures = [];
  for (const { registration, backup, createdIdentity, transaction } of changes.reverse()) {
    try {
      // A newly-created target has no backup. Only remove it when it is still
      // the exact filesystem object this transaction published; a replacement
      // entry belongs to somebody else.
      if (createdIdentity) {
        const outcome = removeQuarantinedTarget({ target: registration.target, identity: createdIdentity });
        if (outcome.status === "foreign") {
          failures.push(`${registration.target} occupied by a foreign object`);
          // TODO(follow-up): crash-recovery sweep of orphaned quarantine dirs.
          continue;
        }
      }
      if (backup) {
        beforeRestore?.(registration);
        if (!targetVacantForRestore(registration.target, transaction)) {
          failures.push(`${registration.target} occupied by a foreign object`);
          // TODO(follow-up): crash-recovery sweep of orphaned quarantine dirs.
          continue;
        }
        renameSync(backup, registration.target);
      }
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
export function runInstallTransaction({ planned, revalidate, create, exclude, beforeMutation, beforeRestore, validateQuarantined }) {
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
                changes.push({ registration, createdIdentity: filesystemIdentity(registration.target) });
                recorded = true;
              }
            };
            create(registration, onCreated);
            onCreated();
          } else {
            const quarantined = quarantineTarget({
              target: registration.target,
              quarantined: backup,
              validate: () => validateQuarantined?.(registration, backup) ?? targetStateAt(registration, backup),
            });
            if (quarantined.status !== "quarantined") {
              rmSync(transaction, { recursive: true, force: true });
              throw new Error(`${registration.target} changed before it could be replaced`);
            }
            changes.push({ registration, transaction, backup });
            create(registration, () => {
              const change = changes.at(-1);
              change.createdIdentity = filesystemIdentity(registration.target);
            });
            const change = changes.at(-1);
            if (!change.createdIdentity) change.createdIdentity = filesystemIdentity(registration.target);
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
            changes.push({ registration, createdIdentity: filesystemIdentity(registration.target) });
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
    const failures = rollback(changes, createdDirectories, exclude, beforeRestore);
    if (failures.length) {
      throw new AggregateError([error], `install failed: ${error.message}; rollback incomplete: ${failures.join("; ")}`);
    }
    throw error;
  }
  // Backups are disposable only after the full transaction, including exclude write, commits.
  cleanBackups(changes);
}

function targetStateAt(registration, path) {
  const stat = lstatOrNull(path);
  if (!stat) return "missing";
  if (stat.isSymbolicLink()) return registration.state === "link" ? "link" : "foreign-link";
  return registration.state === "copy" && stat.isDirectory() ? "copy" : "foreign";
}
