#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = mkdtempSync(join(tmpdir(), "burnlist-clean-"));
const cleanRoot = join(tmpRoot, "burnlist");
const excludeNames = new Set([".DS_Store", ".git", ".local", "build", "dist", "node_modules", "output"]);
const excludePaths = new Set(["notes/burnlists"]);

function run(command, args, cwd) {
  const label = [command, ...args].join(" ");
  console.log(`> ${label}`);
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) {
    const error = new Error(`${label} failed`);
    error.exitCode = result.status || 1;
    throw error;
  }
}

function shouldExclude(path) {
  const rel = relative(repoRoot, path).replace(/\\/g, "/");
  return excludePaths.has(rel) || [...excludePaths].some((prefix) => rel.startsWith(`${prefix}/`));
}

function copyTree(source, target) {
  if (shouldExclude(source)) return;
  const name = source === repoRoot ? "" : source.split(/[\\/]/u).at(-1);
  if (name && excludeNames.has(name)) return;
  mkdirSync(target, { recursive: true });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const sourcePath = join(source, entry.name);
    const targetPath = join(target, entry.name);
    if (entry.isDirectory()) {
      copyTree(sourcePath, targetPath);
    } else if (entry.isFile() && !shouldExclude(sourcePath) && !excludeNames.has(entry.name)) {
      cpSync(sourcePath, targetPath);
    }
  }
}

let exitCode = 0;
try {
  copyTree(repoRoot, cleanRoot);
  if (!existsSync(join(cleanRoot, "package.json"))) {
    throw new Error("Clean copy is missing package.json.");
  }
  run("npm", ["run", "verify"], cleanRoot);
  run("npm", ["run", "verify:package"], cleanRoot);
  run("npm", ["run", "test:global-install"], cleanRoot);
  console.log(`Clean replay passed in ${cleanRoot}`);
} catch (err) {
  console.error(err.message);
  exitCode = err.exitCode || 1;
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}
process.exit(exitCode);
