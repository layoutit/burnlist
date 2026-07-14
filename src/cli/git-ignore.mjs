import { spawnSync } from "node:child_process";
import { relative, resolve, sep } from "node:path";

export function gitProbe(dir, args) {
  return spawnSync("git", ["-C", dir, ...args], {
    cwd: dir,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function repoRelativePath(repoRoot, targetPath) {
  const root = resolve(repoRoot);
  const target = resolve(root, targetPath);
  return relative(root, target).split(sep).join("/") || ".";
}

function isNotGitRepository(result) {
  return result.status === 128 && /not a git repository/iu.test(result.stderr ?? "");
}

export function assertGitIgnored(repoRoot, targetPath) {
  const root = resolve(repoRoot);
  const target = repoRelativePath(root, targetPath);
  const result = gitProbe(root, ["check-ignore", "-q", "--", target]);
  if (result.status === 0) return;
  if (result.status === 1) {
    throw new Error(`refusing to write ${target}: not git-ignored; run \`burnlist init\` or add it to .gitignore`);
  }
  if (isNotGitRepository(result)) return;
  const reason = result.error?.message || result.stderr?.trim() || `git exited with status ${result.status}`;
  throw new Error(`could not check whether ${target} is git-ignored: ${reason}`);
}
