import { spawnSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

export function gitProbe(cwd, args) {
  const result = spawnSync("git", ["-C", cwd, ...args], {
    cwd,
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function fallbackUmbrella(cwd) {
  let current = resolve(cwd);
  while (true) {
    if (existsSync(join(current, "notes", "burnlists"))) return current;
    const parent = dirname(current);
    if (parent === current) return resolve(cwd);
    current = parent;
  }
}

export function resolveUmbrella(cwd = process.cwd()) {
  const absoluteCwd = resolve(cwd);
  const commonDir = gitProbe(absoluteCwd, ["rev-parse", "--git-common-dir"]);
  if (!commonDir) return fallbackUmbrella(absoluteCwd);
  try {
    let gitDir = realpathSync(resolve(absoluteCwd, commonDir));
    while (basename(gitDir) !== ".git") {
      const parent = dirname(gitDir);
      if (parent === gitDir) return fallbackUmbrella(absoluteCwd);
      gitDir = parent;
    }
    return dirname(gitDir);
  } catch {
    return fallbackUmbrella(absoluteCwd);
  }
}
