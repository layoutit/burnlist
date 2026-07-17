import { readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { gitProbe } from "./git-ignore.mjs";

function gitPath(repoRoot, path) {
  return relative(repoRoot, path).replace(/\\/gu, "/");
}

export function trackedPathsInGit(repoRoot, path) {
  const result = gitProbe(repoRoot, ["ls-files", "--", gitPath(repoRoot, path)]);
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || `could not determine whether ${gitPath(repoRoot, path)} is tracked`);
  return result.stdout.split(/\r?\n/u).filter(Boolean);
}

function contentPaths(target, paths = []) {
  for (const entry of readdirSync(target, { withFileTypes: true })) {
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) contentPaths(targetPath, paths);
    else paths.push(targetPath);
  }
  return paths;
}

// Check files, not just the directory: a pattern such as *.md ignores SKILL.md
// without necessarily ignoring its parent directory.
export function ignoredSkillContent(repoRoot, registration, marker) {
  // Commit mode dereferences source links. Inspect the published copy rather
  // than the source tree so check-ignore sees every file git could add.
  const targets = contentPaths(registration.target);
  targets.push(join(registration.target, marker));
  const result = gitProbe(repoRoot, ["check-ignore", "-v", "--", ...targets.map((path) => gitPath(repoRoot, path))]);
  if (result.status === 1) return undefined;
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || "could not determine whether skill content is ignored");
  return result.stdout.trim().split(/\r?\n/u)[0];
}
