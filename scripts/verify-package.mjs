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
  "src/cli/skills-install-cli.mjs",
  "src/cli/skills-register.mjs",
  "src/cli/oven-cli.mjs",
  "src/cli/registry-cli.mjs",
  "src/events/oven-event-contract.mjs",
  "src/events/oven-event-feed.mjs",
  "src/events/oven-event-store.mjs",
  "src/events/oven-events.mjs",
  "src/ovens/oven-contract.mjs",
  "src/server/burnlist-dashboard-server.mjs",
  "skills/burnlist/SKILL.md",
  "skills/burnlist/references/burnlist-creation.md",
  "skills/burnlist/references/oven-event-coordination.md",
  "ovens/checklist/instructions.md",
  "ovens/differential-testing/instructions.md",
  "ovens/differential-testing/differential-testing.oven",
  "ovens/differential-testing/engine/data.schema.json",
  "skills/burnlist/references/differential-testing-data.md",
  "skills/burnlist/references/differential-testing-adapter-sdk.md",
  "ovens/differential-testing/engine/adapter-sdk.mjs",
  "ovens/differential-testing/engine/contract.mjs",
  "ovens/differential-testing/engine/data-contract.mjs",
  "ovens/differential-testing/engine/transport.mjs",
  "ovens/differential-testing/example/adapter.mjs",
  "ovens/differential-testing/example/reference.json",
  "ovens/differential-testing/example/candidate.json",
  "ovens/model-lab/instructions.md",
  "ovens/model-lab/model-lab.oven",
  "ovens/model-lab/engine/model-lab-contract.mjs",
  "ovens/model-lab/engine/model-lab-handler.mjs",
  "ovens/model-lab/renderer/model-lab.css",
  "ovens/performance-tracing/instructions.md",
  "ovens/performance-tracing/performance-tracing.oven",
  "ovens/performance-tracing/contract.mjs",
  "ovens/performance-tracing/handler.mjs",
  "ovens/visual-parity/instructions.md",
  "ovens/visual-parity/visual-parity.oven",
  "ovens/visual-parity/contract.mjs",
  "ovens/visual-parity/handler.mjs",
  "dashboard/dist/index.html",
];

for (const path of required) {
  if (!files.has(path)) {
    console.error(`npm package is missing required file: ${path}`);
    process.exit(1);
  }
}

for (const extension of [".css", ".js"]) {
  if (![...files.keys()].some((path) => path.startsWith("dashboard/dist/assets/") && path.endsWith(extension))) {
    console.error(`npm package is missing the built dashboard ${extension} asset.`);
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
  /^skills\/burnlist\/contracts\/compare-data\.schema\.json$/u,
  /^dashboard\/compare-oven(?:-renderer\.js|\.css)$/u,
  /^skills\/burnlist\/examples\/compare(?:\/|$)/u,
  /^skills\/burnlist\/ovens\/compare(?:\/|$)/u,
  /^skills\/burnlist\/references\/compare-data\.md$/u,
  /^skills\/burnlist\/scripts\/compare-data-contract(?:\.test)?\.mjs$/u,
  /^skills\/burnlist\/ovens\/target(?:\/|$)/u,
  /\.test\.(?:mjs|js)$/u,
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
