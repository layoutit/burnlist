#!/usr/bin/env node
import { lstatSync, readlinkSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const globalInstall = process.env.npm_config_global === "true" || args.has("--force-global");

if (!globalInstall) process.exit(0);

const home = process.env.HOME || process.env.USERPROFILE;
if (!home) process.exit(0);

const sourceRoot = resolve(packageRoot, "skills");
const targetRoot = resolve(process.env.BURNLIST_SKILLS_DIR || join(home, ".agents", "skills"));
const skills = readdirSync(sourceRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

for (const name of skills) {
  const source = resolve(sourceRoot, name);
  const target = resolve(targetRoot, name);
  const stat = lstatOrNull(target);
  if (!stat) continue;
  if (!stat.isSymbolicLink() || resolve(dirname(target), readlinkSync(target)) !== source) {
    console.warn(`Burnlist: left ${target} untouched because it is not managed by this package.`);
    continue;
  }
  if (!dryRun) rmSync(target, { force: true });
  console.log(`Burnlist: ${dryRun ? "would unlink" : "unlinked"} ${name} from ${target}.`);
}
