#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOvenPackage } from "../skills/burnlist/scripts/oven-contract.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));

function run(command, args, options = {}) {
  const label = [command, ...args].join(" ");
  console.log(`> ${label}`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: "inherit",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function walkFiles(root, predicate) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(path, predicate));
    } else if (entry.isFile() && predicate(path)) {
      files.push(path);
    }
  }
  return files;
}

const repoSpecificTerms = [
  ["driv", "ing"],
  ["phys", "ics"],
  ["par", "ity"],
  ["css", "geddon"],
  ["css", "quake"],
  ["vk", "quake"],
].map((parts) => parts.join(""));

const leakPatterns = [
  { name: "personal home path", pattern: /\/Users\//u },
  { name: "local username", pattern: /\bekrof\b/u },
  { name: "private key marker", pattern: /BEGIN [A-Z ]*PRIVATE KEY/u },
  { name: "secret assignment", pattern: /\bSECRET\s*=/u },
  { name: "token assignment", pattern: /\bTOKEN\s*=/u },
  { name: "api key assignment", pattern: /\bAPI_KEY\s*=/u },
  { name: "known local Burnlist id", pattern: /\b260705-003\b/u },
  { name: "known local Burnlist id", pattern: /\b260708-001\b/u },
  { name: "repo-specific term", pattern: new RegExp(`\\b(?:${repoSpecificTerms.join("|")})\\b`, "iu") },
];

const sourceScanExcludes = [
  ".git/",
  ".local/",
  "build/",
  "dist/",
  "node_modules/",
  ".playwright-cli/",
  "notes/burnlists/",
  "output/",
];

function shouldScanSourceFile(path) {
  const normalized = relative(repoRoot, path).replace(/\\/g, "/");
  return !sourceScanExcludes.some((prefix) => normalized === prefix.slice(0, -1) || normalized.startsWith(prefix));
}

function assertNoLeaks(label, text) {
  for (const { name, pattern } of leakPatterns) {
    if (pattern.test(text)) {
      console.error(`Leak scan failed in ${label}: ${name}`);
      process.exit(1);
    }
  }
}

function scanSourceLeaks() {
  for (const file of walkFiles(repoRoot, (path) => shouldScanSourceFile(path))) {
    const stat = statSync(file);
    if (stat.size > 2_000_000) continue;
    assertNoLeaks(relative(repoRoot, file), readFileSync(file, "utf8"));
  }
}

function assertSourceIncludes(path, needle, message) {
  const text = readFileSync(resolve(repoRoot, path), "utf8");
  if (!text.includes(needle)) {
    console.error(message);
    process.exit(1);
  }
}

function assertSourceExcludes(path, needle, message) {
  const text = readFileSync(resolve(repoRoot, path), "utf8");
  if (text.includes(needle)) {
    console.error(message);
    process.exit(1);
  }
}

function assertBuiltInOvenSet(expected) {
  const ovensRoot = resolve(repoRoot, "skills/burnlist/ovens");
  const actual = readdirSync(ovensRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    console.error(`Default Oven ids must be exactly ${wanted.join(", ")}; found ${actual.join(", ") || "none"}.`);
    process.exit(1);
  }
}

function assertSkillSet(expected) {
  const skillsRoot = resolve(repoRoot, "skills");
  const actual = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    console.error(`Published skill ids must be exactly ${wanted.join(", ")}; found ${actual.join(", ") || "none"}.`);
    process.exit(1);
  }
}

function assertBuiltInOven(id, expectedName) {
  const root = resolve(repoRoot, "skills/burnlist/ovens", id);
  const instructionsPath = resolve(root, "instructions.md");
  const detailPath = resolve(root, "detail.json");
  try {
    const ovenPackage = normalizeOvenPackage({
      id,
      instructions: readFileSync(instructionsPath, "utf8"),
      detail: JSON.parse(readFileSync(detailPath, "utf8")),
    });
    const heading = ovenPackage.instructions
      .split(/\r?\n/u)
      .find((line) => /^#\s+\S/u.test(line.trim()))
      ?.trim()
      .replace(/^#\s+/u, "");
    if (heading !== expectedName) throw new Error(`expected heading "${expectedName}", found "${heading || "none"}"`);
  } catch (error) {
    console.error(`Default oven ${id} violates the Oven contract: ${error.message}`);
    process.exit(1);
  }
}

function assertCompareContractAssets() {
  const schemaPath = resolve(repoRoot, "skills/burnlist/contracts/compare-data.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  if (schema.$id !== "urn:burnlist:compare-data:1" || schema.properties?.schema?.const !== "burnlist-compare-data@1") {
    console.error("Compare JSON Schema id and payload version must describe burnlist-compare-data@1.");
    process.exit(1);
  }
}

function assertPublishablePackage() {
  if (packageJson.private === true) {
    console.error("package.json still marks Burnlist private.");
    process.exit(1);
  }
  if (packageJson.publishConfig?.access !== "public") {
    console.error("package.json must publish with public access.");
    process.exit(1);
  }
  if (packageJson.bin?.burnlist !== "bin/burnlist.mjs") {
    console.error("package.json does not expose the Burnlist CLI.");
    process.exit(1);
  }
  if (packageJson.scripts?.postinstall !== "node scripts/register-skills.mjs") {
    console.error("Global npm installation does not register agent skills automatically.");
    process.exit(1);
  }
  if (packageJson.dependencies && Object.keys(packageJson.dependencies).length) {
    console.error("The published Burnlist CLI should not install build-only runtime dependencies.");
    process.exit(1);
  }
}

const jsFiles = [
  ...walkFiles(resolve(repoRoot, "bin"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "scripts"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "skills/burnlist/scripts"), (path) => path.endsWith(".mjs")),
  resolve(repoRoot, "skills/burnlist/dashboard/fallback-burn-ovens.js"),
  resolve(repoRoot, "skills/burnlist/dashboard/fallback-compare-oven.js"),
].sort();

for (const file of jsFiles) {
  run(process.execPath, ["--check", relative(repoRoot, file)]);
}

assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "Burnlist Progress", "Dashboard page is missing.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "New Oven", "Oven controls are missing.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'url.pathname === "/api/ovens"', "Oven API is missing.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "/api\\/oven-data", "Read-only Oven data API is missing.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "assertCompareData(payload)", "Compare data is not validated at the server boundary.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'href="/ovens/compare/view">Compare</a>', "Configured Compare Oven is not linked from the dashboard index.");
assertSourceIncludes("bin/burnlist.mjs", "--oven-data <id=path>", "Burnlist CLI is missing read-only Oven data binding help.");
assertSourceIncludes("bin/burnlist.mjs", "compare validate <compare.json>", "Burnlist CLI is missing Compare data validation help.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "Oven detail page skeleton", "Oven detail skeleton is missing.");
assertSourceIncludes("skills/burnlist/dashboard/fallback-burn-ovens.js", "setPointerCapture", "Oven detail skeleton pointer capture is missing.");
assertSourceIncludes("skills/burnlist/dashboard/fallback-burn-ovens.js", "Draft detail section", "Oven inline detail-section editor is missing.");
assertSourceIncludes("skills/burnlist/dashboard/fallback-burn-ovens.js", "grid-chart-type", "Oven chart-type icon picker is missing.");
assertSourceIncludes("skills/burnlist/dashboard/fallback-burn-ovens.js", "Describe the metric", "Oven metric-description textarea is missing.");
assertSourceIncludes("skills/burnlist/dashboard/fallback-burn-ovens.js", "const NEW_OVEN_ROW_HEIGHT = 50", "New Oven row height is not defined as a fixed implementation constant.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "oven-fields-row", "New Oven metadata fields are not arranged in columns.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "md:grid-cols-4", "React New Oven metadata fields are not arranged in columns.");
assertSourceExcludes("skills/burnlist/dashboard/fallback-burn-ovens.js", "grid-area-title", "Oven detail sections still expose a separate title field.");
assertSourceExcludes("skills/burnlist/dashboard/fallback-burn-ovens.js", "grid-area-source", "Oven detail sections still expose a source-path field.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "grid-row-height", "New Oven still exposes a row-height control.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", ">Row height<", "New Oven still renders a Row height label.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "Instructions are stored as Markdown", "New Oven still renders the removed Markdown helper text.");
assertSourceExcludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "Instructions are stored as Markdown", "React New Oven still renders the removed Markdown helper text.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "builder-hint", "New Oven still renders the removed skeleton helper text.");
assertSourceExcludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "Drag to place a detail section", "React New Oven still renders the removed skeleton helper text.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "grid-ruler", "Oven detail skeleton still renders grid ruler numbers.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'class="form-card oven-builder"', "Oven detail skeleton is still wrapped in a card container.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "ovenRevision", "Burn runs still claim a fixed Oven revision.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", 'useState("checklist")', "React Run Burn does not default to Checklist.");
assertSourceIncludes("skills/burnlist/dashboard/fallback-burn-ovens.js", 'option.value === "checklist"', "Fallback Run Burn does not default to Checklist.");
assertSourceIncludes("skills/burnlist/ovens/checklist/instructions.md", "## Active Checklist", "Checklist no longer preserves the Burnlist active queue contract.");
assertSourceIncludes("skills/burnlist/ovens/target/instructions.md", "Work only the active gate", "Target is missing current-gate discipline.");
assertSourceIncludes("skills/burnlist/ovens/target/instructions.md", "earliest proven actionable producer", "Target is missing upstream producer discipline.");
assertSourceIncludes("skills/burnlist/ovens/target/instructions.md", "Revert exactly that change", "Target is missing exact regression-revert discipline.");
assertSourceIncludes("skills/burnlist/ovens/compare/instructions.md", "fix the capture, adapter, or comparator", "Compare is missing source-fix discipline.");
assertSourceIncludes("skills/burnlist/ovens/compare/instructions.md", "null values remain distinguishable from numeric zero", "Compare is missing null-preservation discipline.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", 'value: "comparison"', "React New Oven is missing the controlled Comparison widget.");
assertSourceIncludes("skills/burnlist/dashboard/src/compare-oven.tsx", 'fetch("/api/oven-data/compare"', "Compare Oven renderer is not bound to normalized Oven data.");
assertSourceIncludes("skills/burnlist/dashboard/src/compare-oven.tsx", "field.samples", "Compare Oven renderer is missing paired sample charts.");
assertSourceIncludes("skills/burnlist/dashboard/fallback-burn-ovens.js", 'id: "comparison"', "Fallback New Oven is missing the controlled Comparison widget.");
assertSourceIncludes("skills/burnlist/dashboard/fallback-compare-oven.js", 'fetch("/api/oven-data/compare"', "Fallback Compare Oven is not bound to normalized Oven data.");
assertSourceIncludes("skills/burnlist/dashboard/fallback-compare-oven.js", "field.samples", "Fallback Compare Oven is missing paired sample charts.");
assertSourceIncludes("skills/burnlist/SKILL.md", "references/burnlist-creation.md", "The Burnlist skill does not route creation work.");
assertSourceIncludes("scripts/register-skills.mjs", 'join(home, ".agents", "skills")', "Global npm install does not use the agent skill directory.");
assertSourceIncludes("bin/burnlist.mjs", "Usage:", "Burnlist CLI help is missing.");
assertSourceIncludes("bin/burnlist.mjs", 'args[0] === "uninstall"', "Burnlist CLI does not own safe uninstall cleanup.");
assertSkillSet(["burnlist"]);
assertBuiltInOvenSet(["checklist", "compare", "target"]);
assertBuiltInOven("checklist", "Checklist");
assertBuiltInOven("compare", "Compare");
assertBuiltInOven("target", "Target");
assertCompareContractAssets();
assertPublishablePackage();

run(process.execPath, ["--test", "skills/burnlist/scripts/compare-data-contract.test.mjs"]);

run(process.execPath, ["scripts/register-skills.mjs", "--force-global", "--dry-run"], {
  env: { ...process.env, HOME: resolve(repoRoot, "fixtures", "npm-home") },
});
run(process.execPath, ["bin/burnlist.mjs", "--version"]);
run(process.execPath, ["bin/burnlist.mjs", "--stamp"]);
run(process.execPath, ["bin/burnlist.mjs", "compare", "schema"]);

scanSourceLeaks();

console.log("Verification passed.");
