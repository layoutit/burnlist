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

function withoutCanonicalTemplateVocabulary(text) {
  return text
    .replaceAll(/driving-parity/giu, "")
    .replaceAll(/driving parity/giu, "")
    .replaceAll(/parity progress/giu, "");
}

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
    const source = name === "repo-specific term" ? withoutCanonicalTemplateVocabulary(text) : text;
    if (pattern.test(source)) {
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

function assertDifferentialTestingContractAssets() {
  const schemaPath = resolve(repoRoot, "skills/burnlist/contracts/differential-testing-data.schema.json");
  const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
  if (schema.$id !== "urn:burnlist:differential-testing-data:1" || schema.properties?.schema?.const !== "burnlist-differential-testing-data@1") {
    console.error("Differential Testing JSON Schema id and payload version must describe burnlist-differential-testing-data@1.");
    process.exit(1);
  }
  if (schema.properties?.telemetry?.$ref !== "#/$defs/telemetry") {
    console.error("Differential Testing JSON Schema is missing aggregate telemetry.");
    process.exit(1);
  }
  if (schema.properties?.scenarioCatalog?.$ref !== "#/$defs/scenarioCatalog") {
    console.error("Differential Testing JSON Schema is missing scenario selection metadata.");
    process.exit(1);
  }
  if (schema.properties?.refresh?.$ref !== "#/$defs/refresh") {
    console.error("Differential Testing JSON Schema is missing event-driven refresh state.");
    process.exit(1);
  }
  if (schema.properties?.exactSession?.$ref !== "#/$defs/exactSession") {
    console.error("Differential Testing JSON Schema is missing exact-session authority.");
    process.exit(1);
  }
  const exactSession = schema.$defs?.exactSession;
  const exactSessionIdentity = schema.$defs?.exactSessionIdentity;
  const exactDecision = schema.$defs?.exactDecision;
  const exactResults = new Set(exactSession?.properties?.result?.enum || []);
  if (!["advanced", "complete", "rejected", "evidence-only", "blocked"].every((result) => exactResults.has(result)) || exactResults.size !== 5) {
    console.error("Differential Testing exact sessions do not expose the lean composed-loop result set.");
    process.exit(1);
  }
  if (!schema.$defs?.telemetryArtifact?.required?.includes("stateVectorSha256") || !schema.$defs?.telemetryArtifact?.required?.includes("stateVectorCheck")) {
    console.error("Differential Testing telemetry artifacts do not seal normalized tick/state vectors.");
    process.exit(1);
  }
  const retainedIdentityKeys = ["referenceSha256", "reportSha256", "stateSha256", "runtimeTreeSha256", "replaySha256", "profileSha256", "contractSha256", "clearedPrefixFrames"];
  if (!retainedIdentityKeys.every((key) => exactSessionIdentity?.required?.includes(key))) {
    console.error("Differential Testing retained sessions do not directly bind their compact exact authority.");
    process.exit(1);
  }
  if (!exactDecision?.required?.includes("retainedSessionId") || !exactDecision?.required?.includes("candidateSessionId")) {
    console.error("Differential Testing decisions do not distinguish retained and evaluated sessions.");
    process.exit(1);
  }
  const refreshStatuses = new Set(schema.$defs?.refreshRecord?.properties?.status?.enum || []);
  if (!["queued", "running", "complete", "failed"].every((status) => refreshStatuses.has(status)) || refreshStatuses.size !== 4) {
    console.error("Differential Testing refresh state must expose queued, running, complete, and failed.");
    process.exit(1);
  }
  const executionClosure = schema.$defs?.executionClosureBinding;
  if (!schema.$defs?.refreshReport?.properties?.executionClosure?.$ref
    || !["schema", "id", "sha256", "size"].every((key) => executionClosure?.required?.includes(key))
    || executionClosure?.additionalProperties !== false) {
    console.error("Differential Testing refresh reports are missing the compact execution-closure binding.");
    process.exit(1);
  }
  if (!schema.$defs?.scenarioCatalog?.properties?.selectedScenarioId?.anyOf?.some((entry) => entry.type === "null") || !schema.$defs?.refresh?.anyOf?.some((entry) => entry.type === "null")) {
    console.error("Differential Testing does not expose the explicit empty scenario bundle.");
    process.exit(1);
  }
  if (schema.properties?.telemetryGate !== undefined || schema.$defs?.telemetryGate !== undefined || schema.$defs?.telemetryGateScenario !== undefined || schema.properties?.exactCycles !== undefined || schema.$defs?.exactBinding !== undefined || schema.$defs?.exactComparison !== undefined || schema.$defs?.exactLifecycle !== undefined || schema.$defs?.exactCycle !== undefined) {
    console.error("Differential Testing still exposes superseded per-candidate ceremony.");
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
  if (packageJson.exports?.["./differential-testing"] !== "./skills/burnlist/scripts/differential-testing-adapter-sdk.mjs"
    || packageJson.exports?.["./differential-testing/contract"] !== "./skills/burnlist/scripts/differential-testing-contract.mjs"
    || packageJson.exports?.["./differential-testing/transport"] !== "./skills/burnlist/scripts/differential-testing-transport.mjs") {
    console.error("package.json does not expose the stable Differential Testing worker, contract, and transport subpaths.");
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
  if (["tailwindcss", "@tailwindcss/vite", "tailwind-merge"].some((name) => packageJson.devDependencies?.[name])) {
    console.error("The dashboard should remain vanilla CSS and must not install Tailwind tooling.");
    process.exit(1);
  }
}

const jsFiles = [
  ...walkFiles(resolve(repoRoot, "bin"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "scripts"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "skills/burnlist/scripts"), (path) => path.endsWith(".mjs")),
  resolve(repoRoot, "skills/burnlist/dashboard/differential-testing-progress-chart.js"),
  resolve(repoRoot, "skills/burnlist/dashboard/differential-testing-renderer.js"),
].sort();

for (const file of jsFiles) {
  run(process.execPath, ["--check", relative(repoRoot, file)]);
}

assertSourceIncludes("skills/burnlist/dashboard/src/app.tsx", ">Ovens</h1>", "Dashboard page is missing.");
assertSourceIncludes("skills/burnlist/dashboard/src/app.tsx", "<ChecklistDashboard", "Checklist Oven is not using the canonical React dashboard.");
for (const surface of ["ProgressPanel", "Timeline", "Target", "Log", "RepoGraph", "Changes"]) {
  assertSourceIncludes("skills/burnlist/dashboard/src/checklist-dashboard.tsx", `function ${surface}`, `Checklist dashboard is missing ${surface}.`);
}
assertSourceIncludes("skills/burnlist/dashboard/src/checklist-dashboard.tsx", "ResizeObserver", "Checklist progress chart does not follow its rendered width.");
assertSourceExcludes("skills/burnlist/dashboard/src/app.tsx", "function Detail(", "Dashboard still carries the superseded simplified Checklist detail path.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "New Oven", "Oven controls are missing.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'url.pathname === "/api/ovens"', "Oven API is missing.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "/api\\/oven-data", "Read-only Oven data API is missing.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'url.pathname === "/api/repo-map"', "Read-only repository map API is missing.");
assertSourceIncludes("skills/burnlist/scripts/repo-map.mjs", 'REPO_MAP_SCHEMA = "burnlist-repo-map@1"', "Repository map API does not expose its strict v1 schema.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'assertKnownKeys(value, new Set(["id", "name", "instructions", "detail"]), "Oven")', "Oven creation does not reject fields outside the strict Oven contract.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'assertKnownKeys(value, new Set(["ovenId", "repoRoot", "title", "objective"]), "Burn run")', "Burn run creation does not reject fields outside the strict Oven contract.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "ovenId(record.ovenId);", "Burn run reads do not require the canonical ovenId.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "assertDifferentialTestingData(payload)", "Differential Testing data is not validated at the server boundary.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'ovenName: "Differential Testing"', "Differential Testing scenarios are missing from the shared dashboard table.");
assertSourceIncludes("skills/burnlist/dashboard/src/app.tsx", '? value! : "active"', "Dashboard table is not filtered to Active by default.");
assertSourceIncludes("skills/burnlist/dashboard/src/app.tsx", '<th className="burnlist-table-heading">Oven</th>', "Shared dashboard table does not identify each row's Oven.");
assertSourceIncludes("bin/burnlist.mjs", "--oven-data <id=path>", "Burnlist CLI is missing read-only Oven data binding help.");
assertSourceIncludes("bin/burnlist.mjs", "differential-testing validate <differential-testing.json>", "Burnlist CLI is missing Differential Testing data validation help.");
assertSourceIncludes("bin/burnlist.mjs", "differential-testing validate-bundle <bundle/current.json>", "Burnlist CLI is missing Differential Testing bundle validation help.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "Oven detail page skeleton", "Oven detail skeleton is missing.");
assertSourceIncludes("skills/burnlist/dashboard/src/app.tsx", 'className="dashboard-header"', "Dashboard header is missing its semantic style hook.");
assertSourceIncludes("skills/burnlist/dashboard/src/index.css", "height: 50px;", "Dashboard header is not fixed at 50px.");
assertSourceIncludes("skills/burnlist/dashboard/src/app.tsx", 'aria-label="Burnlist home"', "Dashboard header logo does not link home.");
assertSourceIncludes("skills/burnlist/dashboard/src/app.tsx", 'aria-label="Primary navigation"', "Dashboard header navigation is missing.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "dashboardFallback", "Dashboard server still contains a fallback renderer.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "burnlist-fallback", "Dashboard server still contains fallback dashboard markup.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "fallback-burn-ovens", "Dashboard server still exposes the fallback Oven bundle.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "legacy-detail-origin", "Burnlist still accepts the retired detail proxy.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'url.pathname === "/api/types"', "Burnlist still exposes the retired type API.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'url.pathname === "/types/new"', "Burnlist still redirects the retired type UI.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", '"definition.md"', "Burnlist still discovers retired Oven filenames.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", '"dashboard.json"', "Burnlist still discovers retired Oven detail filenames.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'value.instructions ?? value.definition', "Oven creation still accepts the retired definition field.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'value.detail ?? value.dashboard', "Oven creation still accepts the retired dashboard field.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", '"typeId"', "Burn runs still accept the retired typeId field.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", 'record.typeId', "Burn run reads still accept retired typeId records.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "/assets/fallback-burn-types.js", "Burnlist still exposes the retired type asset alias.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", '["api", "ovens", "types", "runs"]', "Burnlist still reserves the retired types route.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "setPointerCapture", "Oven detail skeleton pointer capture is missing.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", 'aria-label="New detail section"', "Oven inline detail-section editor is missing.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "DetailTypePicker", "Oven chart-type icon picker is missing.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "Describe the metric", "Oven metric-description textarea is missing.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "const NEW_OVEN_ROW_HEIGHT = 50", "New Oven row height is not defined as a fixed implementation constant.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", 'className="oven-fields-row"', "React New Oven metadata fields are missing their semantic layout hook.");
assertSourceIncludes("skills/burnlist/dashboard/src/index.css", "grid-template-columns: repeat(4, minmax(0, 1fr));", "React New Oven metadata fields are not arranged in columns.");
assertSourceExcludes("skills/burnlist/dashboard/src/index.css", "tailwindcss", "Dashboard stylesheet still imports Tailwind.");
assertSourceExcludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "grid-area-title", "Oven detail sections still expose a separate title field.");
assertSourceExcludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "grid-area-source", "Oven detail sections still expose a source-path field.");
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
assertSourceIncludes("skills/burnlist/ovens/checklist/instructions.md", "## Active Checklist", "Checklist no longer preserves the Burnlist active queue contract.");
assertSourceIncludes("skills/burnlist/ovens/differential-testing/instructions.md", "fix the capture, adapter, or comparison seam", "Differential Testing is missing source-fix discipline.");
assertSourceIncludes("skills/burnlist/ovens/differential-testing/instructions.md", "null remains distinguishable from numeric zero", "Differential Testing is missing null-preservation discipline.");
assertSourceIncludes("skills/burnlist/ovens/differential-testing/instructions.md", 'authority: "telemetry-only"', "Differential Testing is missing the telemetry authority boundary.");
assertSourceIncludes("skills/burnlist/ovens/differential-testing/instructions.md", 'authority: "adapter-attested"', "Differential Testing is missing the exact-session attestation boundary.");
assertSourceIncludes("skills/burnlist/ovens/differential-testing/instructions.md", "one composed candidate transaction", "Differential Testing is missing the lean composed transaction.");
assertSourceIncludes("skills/burnlist/ovens/differential-testing/instructions.md", "Keep the edit only for `advanced` or `complete`", "Differential Testing is missing the composed keep/reject rule.");
assertSourceIncludes("skills/burnlist/ovens/differential-testing/instructions.md", "Every newly advanced exact prefix automatically requests", "Differential Testing is missing automatic event-driven refresh.");
assertSourceIncludes("skills/burnlist/ovens/differential-testing/instructions.md", "No per-candidate ledger", "Differential Testing still requires per-candidate history ceremony.");
assertSourceIncludes("skills/burnlist/ovens/differential-testing/instructions.md", "queued`, `running`, `complete`, or `failed`", "Differential Testing is missing refresh-state discipline.");
assertSourceExcludes("skills/burnlist/ovens/differential-testing/instructions.md", "exactCycles", "Differential Testing instructions still expose exactCycles ceremony.");
assertSourceIncludes("skills/burnlist/scripts/differential-testing-data-contract.mjs", "buildDifferentialTelemetry", "Differential Testing is missing deterministic telemetry construction.");
assertSourceIncludes("skills/burnlist/dashboard/src/burn-ovens.tsx", 'value: "comparison"', "React New Oven is missing the controlled Comparison widget.");
assertSourceIncludes("skills/burnlist/dashboard/src/differential-testing.tsx", "startDifferentialTestingLiveUpdates", "Differential Testing React view is not using the shared live updater.");
assertSourceExcludes("skills/burnlist/dashboard/src/differential-testing.tsx", "fetch(", "Differential Testing React view duplicates the shared live updater.");
assertSourceExcludes("skills/burnlist/dashboard/src/differential-testing.tsx", "setInterval", "Differential Testing React view duplicates the shared polling timer.");
assertSourceExcludes("skills/burnlist/dashboard/src/differential-testing.tsx", "differentialPayloadRevision", "Differential Testing React view duplicates shared revision tracking.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'searchParams.set("scenario", scenarioId)', "Differential Testing is not bound to read-only scenario selection.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'searchParams.set("pageSize"', "Differential Testing is not bound to server-side field paging.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", "startDifferentialTestingLiveUpdates", "Differential Testing does not refresh live data.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", "differentialTelemetryFieldMap", "Differential Testing Changed view is not bound to telemetry transitions.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", "differentialExactTarget", "Differential Testing exact decisions are not bound to exact-session authority.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", "exactSession?.exactComparison", "Differential Testing renderer still reads the removed exact-comparison surface.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", "reconciled telemetry only", "Differential Testing does not visibly distinguish aggregate telemetry from exact authority.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", "field.samples", "Differential Testing is missing paired sample charts.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'role="button" tabindex="0" aria-expanded=', "Differential Testing rows do not preserve the expand interaction contract.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'placeholder="Search Fields..."', "Differential Testing does not preserve the canonical search control.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'data-driving-parity-chart="delta"', "Differential Testing does not preserve the canonical Value and Delta controls.");
assertSourceIncludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "queryDifferentialTestingFieldPage", "Differential Testing server is missing bounded field-page transport.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'data-driving-parity-sort="improved"', "Differential Testing does not preserve the canonical Changed control.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'data-driving-parity-filter="failing"', "Differential Testing does not preserve the canonical Failed control.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'class="hybrid-cell hybrid-field"', "Differential Testing does not preserve the canonical hybrid field cell.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'class="hybrid-cell hybrid-metric"', "Differential Testing does not preserve the canonical hybrid metric cell.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'class="hybrid-chart"', "Differential Testing does not preserve the canonical hybrid chart cell.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", '`Δ ${value(field.maxDelta)}`', "Differential Testing still invents a Greek delta prefix that the canonical hybrid row never renders.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'value(field.maxDelta)', "Differential Testing drops the canonical plain numeric value line.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-progress-chart.js", "maxTime = Math.max(minTime + 1", "Differential Testing history does not handle one-run data without a floating label.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", "spikeThreshold", "Differential Testing history still erases losing telemetry runs that later restore baseline.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-progress-chart.js", "withoutBacktrackedFailedSpikes", "Differential Testing is not using the canonical progress-chart history projection.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", "Cards view", "Differential Testing still carries the removed legacy cards view.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", "Table view", "Differential Testing still carries the removed legacy table view.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", "grid-template-columns: 20% 10% minmax(0, 70%)", "Differential Testing rows do not use the canonical hybrid geometry.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", "height: 90px", "Differential Testing collapsed rows do not use the canonical height.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", "height: 220px", "Differential Testing expanded rows do not use the canonical height.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing.css", "height: 426px", "Differential Testing Overview and top panels do not preserve the canonical height.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'class="work-panel-title">Overview</div>', "Differential Testing does not preserve the canonical Overview section title.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing.css", "grid-template-columns: 30% minmax(0, 70%)", "Differential Testing top panels do not preserve the canonical 30/70 layout.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing.css", "inset: 28px 0 0", "Differential Testing top panels do not preserve the shared-card template.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing.css", ".driving-parity-view .differential-tabs", "Differential Testing tab groups do not share one component style.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing.css", '--dashboard-title-font: "Helvetica Neue", Helvetica, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;', "Differential Testing does not preserve the canonical title font stack.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing.css", ".driving-parity-view .driving-parity-controls button,\n.driving-parity-view .driving-parity-controls select,\n.driving-parity-view .driving-parity-controls input,\n.driving-parity-view .driving-parity-overall-toggle {\n  font: 14px/1.2 var(--dashboard-title-font);\n}", "Differential Testing controls do not preserve the canonical sans-serif typography.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing.css", '.driving-parity-view .driving-parity-controls input[type="search"],\n.driving-parity-view .driving-parity-controls input[type="search"]:focus {\n  background: transparent;\n}', "Differential Testing search input does not preserve its transparent background.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing.css", "h2 { margin: 0 0 12px; font-size: 16px; font-weight: 400; letter-spacing: 0; }", "Differential Testing panel headings do not preserve the canonical type scale.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'return minutes === 0 ? "now" : minutes + "m";', "Differential Testing Age values do not preserve the canonical minute display.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", '`${hours}h`', "Differential Testing Age values still collapse minutes into hours.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", '<h2 id="progress-panel-title">Parity Progress</h2>', "Differential Testing does not render the canonical progress title.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing-renderer.js", 'id="driving-parity-inline-renderer"', "Differential Testing does not preserve the canonical inline renderer boundary.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", "isolateDrivingParityFrame", "Differential Testing still moves the canonical inline renderer into a non-reference frame.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", "frame.srcdoc", "Differential Testing still publishes the canonical inline renderer through srcdoc.");
assertSourceIncludes("skills/burnlist/dashboard/differential-testing.css", "flex: 0 0 auto;", "Differential Testing log rows can stretch to fill the panel.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", "differential-exact-session", "Differential Testing adds a non-template exact-authority panel.");
assertSourceExcludes("skills/burnlist/dashboard/differential-testing-renderer.js", "Targeted Burn", "Differential Testing renderer still hardcodes a project workflow title.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", "exact comparator when used", "Fallback Run Burn still requests the superseded manual comparator workflow.");
assertSourceExcludes("skills/burnlist/dashboard/src/burn-ovens.tsx", "exact comparator when used", "React Run Burn still requests the superseded manual comparator workflow.");
assertSourceIncludes("skills/burnlist/SKILL.md", "references/burnlist-creation.md", "The Burnlist skill does not route creation work.");
assertSourceIncludes("scripts/register-skills.mjs", 'join(home, ".agents", "skills")', "Global npm install does not use the agent skill directory.");
assertSourceIncludes("bin/burnlist.mjs", "Usage:", "Burnlist CLI help is missing.");
assertSourceIncludes("bin/burnlist.mjs", 'args[0] === "uninstall"', "Burnlist CLI does not own safe uninstall cleanup.");
assertSourceExcludes("README.md", "**Target**", "README still advertises the removed Target Oven.");
assertSourceExcludes("skills/burnlist/scripts/burnlist-dashboard-server.mjs", '"/targets"', "Dashboard server still exposes the removed Targets route.");
assertSourceExcludes("skills/burnlist/dashboard/src/app.tsx", '"/targets"', "React dashboard still exposes the removed Targets route.");
assertSourceExcludes("skills/burnlist/scripts/oven-contract.mjs", '"target"', "Oven contract still accepts the removed Target widget.");
assertSkillSet(["burnlist"]);
assertBuiltInOvenSet(["checklist", "differential-testing"]);
assertBuiltInOven("checklist", "Checklist");
assertBuiltInOven("differential-testing", "Differential Testing");
assertDifferentialTestingContractAssets();
assertPublishablePackage();

run(process.execPath, [
  "--test",
  "skills/burnlist/scripts/dashboard-routes.test.mjs",
  "skills/burnlist/scripts/projects-api.test.mjs",
  "skills/burnlist/scripts/differential-testing-adapter-sdk.test.mjs",
  "skills/burnlist/scripts/differential-testing-contract.test.mjs",
  "skills/burnlist/scripts/differential-testing-data-contract.test.mjs",
  "skills/burnlist/scripts/discovery.test.mjs",
  "skills/burnlist/scripts/registry-cli.test.mjs",
  "skills/burnlist/scripts/registry.test.mjs",
  "skills/burnlist/scripts/repo-map.test.mjs",
  "skills/burnlist/scripts/repo-state.test.mjs",
]);

run(process.execPath, ["scripts/register-skills.mjs", "--force-global", "--dry-run"], {
  env: { ...process.env, HOME: resolve(repoRoot, "fixtures", "npm-home") },
});
run(process.execPath, ["bin/burnlist.mjs", "--version"]);
run(process.execPath, ["bin/burnlist.mjs", "--stamp"]);
run(process.execPath, ["bin/burnlist.mjs", "differential-testing", "schema"]);
run(process.execPath, ["bin/burnlist.mjs", "differential-testing", "sdk"]);

scanSourceLeaks();

console.log("Verification passed.");
