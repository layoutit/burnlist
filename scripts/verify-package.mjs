#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
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
const packedPaths = [...files.keys()];
const expectedPaths = JSON.parse(readFileSync(resolve(repoRoot, "scripts", "package-paths.json"), "utf8"));
if (!Array.isArray(expectedPaths) || JSON.stringify([...packedPaths].sort()) !== JSON.stringify([...expectedPaths].sort())) {
  console.error("npm package paths differ from the committed package-paths.json manifest.");
  process.exit(1);
}
const forbiddenPayloadBytes = [
  ["BEGIN", "PRIVATE", "KEY"].join(" "),
  ["BEGIN", "OPENSSH", "PRIVATE", "KEY"].join(" "),
  ["BURNLIST", "FAKE", ""].join("_"),
];
const forbiddenPayloadText = [
  /(?:^|[^\w])\/(?:Users|home)\/[^/\s]+(?:\/|$)/u,
  /\b(?:SECRET|TOKEN|API_KEY)\s*=/u,
  /\b(?:prototype-only|prototype command|prototype CLI)\b/iu,
];

function sourceFiles(directory, root = repoRoot) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path, root);
    return entry.isFile() ? [relative(root, path).replace(/\\/gu, "/")] : [];
  });
}
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
  "src/ovens/official-oven-catalog.mjs",
  "src/server/burnlist-dashboard-server.mjs",
  "loops/review/review.loop",
  "loops/review/instructions.md",
  "skills/burnlist/references/loop-capability-example.json",
  "skills/burnlist/SKILL.md",
  "skills/burnlist/references/burnlist-creation.md",
  "skills/burnlist/references/oven-event-coordination.md",
  "ovens/catalog.json",
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

// The Loop is not an optional documentation add-on: every non-test runtime
// module and installed Loop source must be present in the tarball.
const runtimeSources = [
  ...sourceFiles(resolve(repoRoot, "src/loops")),
  ...sourceFiles(resolve(repoRoot, "loops")),
].filter((path) => !path.includes("/__fixtures__/") && !/\.test\.m?js$/u.test(path) && !/(?:minimal-review-e2e-fixtures|m2-test-fixtures|run-test-fixtures)\.mjs$/u.test(path));
for (const path of runtimeSources) {
  if (!files.has(path)) {
    console.error(`npm package is missing Loop runtime asset: ${path}`);
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
  /^src\/loops\/minimal-review-e2e-fixtures\.mjs$/u,
  /^src\/loops\/adapters\/docker-isolation\.mjs$/u,
  /^src\/loops\/config\/(?:controllers|probes)\.mjs$/u,
  /^src\/loops\/run\/(?:m2|run)-test-fixtures\.mjs$/u,
  /^src\/server\/dashboard-routes-fixtures\.mjs$/u,
  /(?:^|\/)__fixtures__(?:\/|$)/u,
  /\.test\.(?:mjs|js)$/u,
  /\.zip$/u,
];

for (const path of packedPaths) {
  if (forbidden.some((pattern) => pattern.test(path))) {
    console.error(`npm package contains forbidden file: ${path}`);
    process.exit(1);
  }
}

for (const path of packedPaths.filter((entry) => !entry.startsWith("dashboard/dist/assets/"))) {
  const text = readFileSync(resolve(repoRoot, path), "utf8");
  if (/\/Users\//u.test(text)) {
    console.error(`npm package contains a personal path: ${path}`);
    process.exit(1);
  }
}

const bin = files.get("bin/burnlist.mjs");
if ((bin.mode & 0o111) === 0) {
  console.error("npm package CLI is not executable.");
  process.exit(1);
}

if (report.entryCount > 220 || report.unpackedSize > 2_500_000) {
  console.error(`npm package exceeds its bounded payload budget: ${report.entryCount} files, ${report.unpackedSize} bytes.`);
  process.exit(1);
}

// npm's dry-run manifest is useful for policy, but inspect the extracted bytes
// too: this catches leaks in generated dashboard files as well as source text.
const packDirectory = mkdtempSync(join(tmpdir(), "burnlist-package-verify-"));
try {
  const packed = spawnSync("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", packDirectory], {
    cwd: repoRoot, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, shell: false,
  });
  if (packed.status !== 0) throw new Error(packed.stderr || "npm pack failed");
  const [{ filename }] = JSON.parse(packed.stdout);
  const untar = spawnSync("tar", ["-xzf", join(packDirectory, filename), "-C", packDirectory], { encoding: "utf8", shell: false });
  if (untar.status !== 0) throw new Error(untar.stderr || "tar extraction failed");
  const actual = sourceFiles(join(packDirectory, "package"), join(packDirectory, "package")).sort();
  const expected = [...expectedPaths].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error("packed tarball paths differ from npm dry-run manifest");
  for (const path of actual) {
    const bytes = readFileSync(join(packDirectory, "package", path));
    const text = bytes.toString("utf8");
    if (forbiddenPayloadBytes.some((marker) => bytes.includes(Buffer.from(marker))) || forbiddenPayloadText.some((pattern) => pattern.test(text))) {
      throw new Error(`packed tarball contains a forbidden personal path or prototype command: ${path}`);
    }
  }
} catch (error) {
  console.error(`npm package byte verification failed: ${error.message}`);
  process.exit(1);
} finally {
  rmSync(packDirectory, { recursive: true, force: true });
}

console.log(`npm package payload verified: ${report.entryCount} files, ${report.unpackedSize} bytes unpacked.`);
