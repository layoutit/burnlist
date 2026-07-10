#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const result = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 8 * 1024 * 1024,
  shell: false,
});

if (result.status !== 0) {
  console.error(result.stderr || "npm pack --dry-run failed");
  process.exit(result.status || 1);
}

let report;
try {
  [report] = JSON.parse(result.stdout);
} catch {
  console.error("npm pack --dry-run did not return valid JSON.");
  process.exit(1);
}

const files = new Map((report.files || []).map((entry) => [entry.path, entry]));
const required = [
  "LICENSE",
  "README.md",
  "bin/burnlist.mjs",
  "package.json",
  "scripts/register-skills.mjs",
  "scripts/unregister-skills.mjs",
  "skills/burnlist/SKILL.md",
  "skills/burnlist/references/burnlist-creation.md",
  "skills/burnlist/ovens/checklist/instructions.md",
  "skills/burnlist/ovens/compare/instructions.md",
  "skills/burnlist/ovens/compare/detail.json",
  "skills/burnlist/contracts/compare-data.schema.json",
  "skills/burnlist/references/compare-data.md",
  "skills/burnlist/scripts/compare-data-contract.mjs",
  "skills/burnlist/examples/compare/adapter.mjs",
  "skills/burnlist/examples/compare/reference.json",
  "skills/burnlist/examples/compare/candidate.json",
  "skills/burnlist/dashboard/fallback-compare-oven.css",
  "skills/burnlist/dashboard/fallback-compare-oven.js",
  "skills/burnlist/ovens/target/instructions.md",
];

for (const path of required) {
  if (!files.has(path)) {
    console.error(`npm package is missing required file: ${path}`);
    process.exit(1);
  }
}

const forbidden = [
  /^\.git(?:\/|$)/u,
  /^\.local(?:\/|$)/u,
  /^\.playwright-cli(?:\/|$)/u,
  /^dist(?:\/|$)/u,
  /^node_modules(?:\/|$)/u,
  /^notes\/burnlists(?:\/|$)/u,
  /^output(?:\/|$)/u,
  /^scripts\/(?:build-release|install)\.mjs$/u,
  /^skills\/burnlist-create(?:\/|$)/u,
  /\.zip$/u,
];

for (const path of files.keys()) {
  if (forbidden.some((pattern) => pattern.test(path))) {
    console.error(`npm package contains forbidden file: ${path}`);
    process.exit(1);
  }
}

const bin = files.get("bin/burnlist.mjs");
if ((bin.mode & 0o111) === 0) {
  console.error("npm package CLI is not executable.");
  process.exit(1);
}

console.log(`npm package payload verified: ${report.entryCount} files, ${report.unpackedSize} bytes unpacked.`);
