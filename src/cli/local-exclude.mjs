import { randomBytes } from "node:crypto";
import { closeSync, constants, fsyncSync, mkdirSync, openSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { gitProbe } from "./git-ignore.mjs";

export function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

// A staged durable writer lets guarded callers validate immediately before swap.
export function stageAtomicText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  let fd;
  let staged = false;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, text); fsyncSync(fd); closeSync(fd); fd = undefined;
    staged = true;
    return {
      commit() { renameSync(temporary, path); fsyncDirectory(dirname(path)); },
      discard() { rmSync(temporary, { force: true }); },
    };
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (!staged) rmSync(temporary, { force: true });
  }
}

// A single durable writer is shared by all CLI users of .git/info/exclude.
export function writeAtomicText(path, text) {
  const staged = stageAtomicText(path, text);
  try { staged.commit(); } finally { staged.discard(); }
}

export function gitExcludePath(repoRoot) {
  const result = gitProbe(repoRoot, ["rev-parse", "--git-path", "info/exclude"]);
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || "could not locate .git/info/exclude");
  return resolve(repoRoot, result.stdout.trim());
}

export function localExcludeTarget(repoRoot, path) {
  return `/${relative(resolve(repoRoot), path).replace(/\\/gu, "/")}`;
}

export function addOwnedLocalExcludeText(content, target, marker) {
  if (content.split(/\r?\n/u).includes(target)) return;
  const prefix = content && !content.endsWith("\n") ? `${content}\n` : content;
  return `${prefix}# ${marker}\n${target}\n`;
}

export function removeOwnedLocalExcludeText(content, target, marker) {
  const lines = content.split(/\r?\n/u);
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === `# ${marker}` && lines[index + 1] === target) { index += 1; continue; }
    kept.push(lines[index]);
  }
  return kept.join("\n");
}
