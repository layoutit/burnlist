#!/usr/bin/env node
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const globalInstall = process.env.npm_config_global === "true" || args.has("--force-global");

if (!globalInstall) {
  console.log("Burnlist: local npm install detected; agent skill registration is only performed for global installs.");
  process.exit(0);
}

const home = process.env.HOME || process.env.USERPROFILE;
if (!home) {
  console.error("Burnlist: cannot register agent skills because no user home directory is available.");
  process.exit(1);
}

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

function linkedSource(path) {
  return resolve(dirname(path), readlinkSync(path));
}

const registrations = skills.map((name) => {
  if (!/^[a-z0-9][a-z0-9-]*$/u.test(name)) {
    throw new Error(`unsafe skill folder name: ${name}`);
  }
  const source = resolve(sourceRoot, name);
  if (!existsSync(join(source, "SKILL.md"))) {
    throw new Error(`skill ${name} is missing SKILL.md`);
  }
  const target = resolve(targetRoot, name);
  const stat = lstatOrNull(target);
  if (!stat) return { action: "link", name, source, target };
  if (!stat.isSymbolicLink()) {
    throw new Error(`${target} already exists and is not a Burnlist-managed symlink`);
  }
  if (linkedSource(target) !== source) {
    throw new Error(`${target} already links to a different skill source`);
  }
  return { action: "keep", name, source, target };
});

if (!dryRun) mkdirSync(targetRoot, { recursive: true });

for (const registration of registrations) {
  const verb = registration.action === "keep" ? "kept" : dryRun ? "would link" : "linked";
  if (registration.action === "link" && !dryRun) {
    symlinkSync(
      registration.source,
      registration.target,
      process.platform === "win32" ? "junction" : "dir",
    );
  }
  console.log(`Burnlist: ${verb} ${registration.name} -> ${registration.target}`);
}

console.log(`Burnlist: agent skills are registered under ${targetRoot}.`);
