#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import "../src/ovens/built-in-handlers.mjs";
import { loadOfficialOvenCatalog } from "../src/ovens/official-oven-catalog.mjs";
import { listOvenHandlers } from "../src/ovens/oven-registry.mjs";
import { assertBuiltInOven, assertBuiltInOvenDataDocs, assertBuiltInOvenSet, assertSkillSet } from "./verify-oven-assertions.mjs";
import { verificationSerialTestFiles, verificationTestFiles } from "./verify-test-files.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
const officialOvenCatalog = loadOfficialOvenCatalog({
  ovensDir: resolve(repoRoot, "ovens"),
  handlers: listOvenHandlers(),
});

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

function runCapture(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    shell: false,
    ...options,
  });
  if (result.status !== 0) {
    process.stderr.write(result.stderr || result.stdout || "");
    process.exit(result.status || 1);
  }
  return result.stdout;
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
    .replaceAll(/terminal-oven-parity/giu, "")
    .replaceAll(/terminal-parity/giu, "")
    .replaceAll(/terminalovenparity/giu, "")
    .replaceAll(/terminalparity/giu, "")
    .replaceAll(/driving-parity/giu, "")
    .replaceAll(/driving parity/giu, "")
    .replaceAll(/visual-parity/giu, "")
    .replaceAll(/visual parity/giu, "")
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
  ".claude/",
  ".local/",
  "build/",
  "dist/",
  "node_modules/",
  ".playwright-cli/",
  "notes/burnlists/",
  "output/",
  "research/",
  "tui/dist/",
  "tui/node_modules/",
  "website/node_modules/",
  "website/dist/",
  "website/.astro/",
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


function assertDifferentialTestingContractAssets() {
  const schemaPath = resolve(repoRoot, "ovens/differential-testing/engine/data.schema.json");
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
  if (packageJson.exports?.["./differential-testing"] !== "./ovens/differential-testing/engine/adapter-sdk.mjs"
    || packageJson.exports?.["./differential-testing/contract"] !== "./ovens/differential-testing/engine/contract.mjs"
    || packageJson.exports?.["./differential-testing/transport"] !== "./ovens/differential-testing/engine/transport.mjs"
    || packageJson.exports?.["./oven-events"] !== "./src/events/oven-events.mjs") {
    console.error("package.json does not expose the stable Differential Testing and Oven event subpaths.");
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

const jsFiles = [...new Set([
  ...walkFiles(resolve(repoRoot, "bin"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "scripts"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "src"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "ovens/differential-testing"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "ovens/model-lab"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "ovens/performance-tracing"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "ovens/streaming-diff/engine"), (path) => path.endsWith(".mjs")),
  ...walkFiles(resolve(repoRoot, "ovens/visual-parity"), (path) => path.endsWith(".mjs")),
  resolve(repoRoot, "src/ovens/oven-registry.mjs"),
  resolve(repoRoot, "src/ovens/built-in-handlers.mjs"),
  resolve(repoRoot, "src/ovens/handlers/generic-json-handler.mjs"),
  resolve(repoRoot, "ovens/differential-testing/engine/handler.mjs"),
  resolve(repoRoot, "dashboard/src/oven/differential-testing-render/differential-testing-progress-chart.js"),
  resolve(repoRoot, "dashboard/src/oven/differential-testing-render/differential-testing-renderer.js"),
])].sort();

for (const file of jsFiles) {
  run(process.execPath, ["--check", relative(repoRoot, file)]);
}

assertSourceIncludes("dashboard/src/App.tsx", ">Burnlists</h1>", "Dashboard landing page is missing.");
assertSourceIncludes("dashboard/src/App.tsx", "<ChecklistOvenView", "Checklist Oven is not rendered through its declarative engine view.");
for (const surface of ["ChecklistKpis", "ProgressPanel", "ProgressLedger", "EventCardList"]) {
  assertSourceIncludes("dashboard/src/components/ChecklistDashboard/ChecklistDashboard.tsx", `function ${surface}`, `Checklist dashboard is missing ${surface}.`);
}
assertSourceIncludes("dashboard/src/components/ChecklistDashboard/ChecklistDashboard.tsx", "ResizeObserver", "Checklist progress chart does not follow its rendered width.");
assertSourceExcludes("dashboard/src/App.tsx", "function Detail(", "Dashboard still carries the superseded simplified Checklist detail path.");
assertSourceIncludes("dashboard/src/components/BurnOvens/BurnOvens.tsx", "New Oven", "Oven controls are missing.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", 'url.pathname === "/api/ovens"', "Oven API is missing.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", 'url.pathname === "/api/oven-catalog"', "Official Oven catalog API is missing.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", "/api\\/oven-data", "Read-only Oven data API is missing.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", 'url.pathname === "/api/events"', "Replayable generic Oven event API is missing.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", 'url.pathname === "/api/repo-map"', "Read-only repository map API is missing.");
assertSourceIncludes("src/server/repo-map.mjs", 'REPO_MAP_SCHEMA = "burnlist-repo-map@1"', "Repository map API does not expose its strict v1 schema.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", 'assertKnownKeys(value, new Set(["id", "name", "instructions"]), "Oven")', "Oven creation does not reject fields outside the strict Oven contract.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", 'assertKnownKeys(value, new Set(["ovenId", "repoRoot", "title", "objective"]), "Burn run")', "Burn run creation does not reject fields outside the strict Oven contract.");
assertSourceIncludes(".github/workflows/publish.yml", "git fetch origin main", "Publish reruns must refresh origin/main before release-state checks.");
assertSourceIncludes(".github/workflows/publish.yml", '"refs/tags/${VERSION}^{}"', "Publish tag verification must request annotated-tag peeled refs.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", "ovenId(record.ovenId);", "Burn run reads do not require the canonical ovenId.");
assertSourceIncludes("ovens/differential-testing/engine/handler.mjs", "validateData: validateDifferentialTestingRuntimeData", "Differential Testing does not expose its server-boundary validator.");
assertSourceIncludes("ovens/differential-testing/engine/handler.mjs", "validateDifferentialTestingRuntimeData(document)", "Differential Testing source snapshots are not validated at the shared read boundary.");
assertSourceIncludes("ovens/performance-tracing/handler.mjs", "validateData: validatePerformanceTracingRuntimeData", "Performance Tracing does not expose its server-boundary validator.");
assertSourceIncludes("ovens/performance-tracing/handler.mjs", "validatePerformanceTracingRuntimeData(payload", "Performance Tracing data is not validated at the server boundary.");
assertSourceIncludes("ovens/visual-parity/handler.mjs", "validateData: validateVisualParityRuntimeData", "Visual Parity does not expose its server-boundary validator.");
assertSourceIncludes("ovens/visual-parity/handler.mjs", "validateVisualParityRuntimeData(payload)", "Visual Parity data is not validated at the server boundary.");
assertSourceIncludes("ovens/differential-testing/engine/handler.mjs", 'ovenName: "Differential Testing"', "Differential Testing scenarios are missing from the shared dashboard table.");
assertSourceIncludes("ovens/differential-testing/engine/handler.mjs", "queryDifferentialTestingFieldPage", "Differential Testing server is missing bounded field-page transport.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", 'id === "differential-testing"', "Dashboard server still hardcodes the Differential Testing Oven.");
assertSourceIncludes("dashboard/src/lib/hrefs.ts", '? value! : "active"', "Dashboard table is not filtered to Active by default.");
assertSourceIncludes("dashboard/src/components/ProjectGroup/BurnlistTable.tsx", '<table aria-label="Burnlists"', "Dashboard landing is missing its semantic Burnlist table.");
assertSourceIncludes("dashboard/src/components/ProjectGroup/BurnlistTable.tsx", ">Oven</th>", "Dashboard landing is missing its Oven identity column.");
assertSourceIncludes("dashboard/src/App.tsx", '<BurnlistTable showStatus={filter === "all"}>{projects.map', "Dashboard projects do not share one calm table surface.");
assertSourceExcludes("dashboard/src/components/ProjectGroup/ProjectGroup.tsx", "<table", "Dashboard project groups still repeat the table header.");
assertSourceIncludes("dashboard/src/components/ProjectGroup/BurnlistRow.tsx", "rowSpan={projectRowSpan}", "Dashboard project grouping is not represented in its flat table.");
assertSourceIncludes("dashboard/src/components/ProjectGroup/BurnlistRow.tsx", '<Badge data-oven={entry.ovenId}', "Dashboard Oven labels do not use the shared Badge primitive.");
assertSourceIncludes("dashboard/src/components/Filters/Filters.tsx", "ToggleGroup, ToggleGroupItem", "Dashboard lifecycle filters do not use the shared Toggle Group primitive.");
assertSourceIncludes("dashboard/src/components/Filters/Filters.tsx", 'aria-label="Burnlist lifecycle"', "Dashboard lifecycle filters are missing their accessible label.");
assertSourceIncludes("bin/burnlist.mjs", "--oven-data <id=path>", "Burnlist CLI is missing read-only Oven data binding help.");
assertSourceIncludes("bin/burnlist.mjs", "oven <list|view|use|set|bind", "Top-level help is missing the Oven use/set flow.");
assertSourceIncludes("src/cli/oven-cli.mjs", "burnlist oven use <id> [--repo <path>] [--force]", "Oven help is missing use syntax.");
assertSourceIncludes("src/cli/oven-cli.mjs", "burnlist oven set <id> <path|-|json> [--repo <path>]", "Oven help is missing set syntax.");
assertSourceIncludes("skills/burnlist/references/oven-authoring.md", "shape-only validation checks source pointers, not payload truth.", "Published skill guidance is missing the custom Oven validation boundary.");
assertSourceIncludes("website/src/content/docs/cli.mdx", ".local/burnlist/data/<id>.json", "Website CLI docs are missing canonical Oven data publication.");
assertSourceIncludes("website/scripts/skill-content.mjs", "burnlist oven <list|view|use|set|bind", "Generated website skill content is missing the Oven use/set flow.");
assertSourceIncludes("bin/burnlist.mjs", "differential-testing validate <differential-testing.json>", "Burnlist CLI is missing Differential Testing data validation help.");
assertSourceIncludes("bin/burnlist.mjs", "differential-testing validate-bundle <bundle/current.json>", "Burnlist CLI is missing Differential Testing bundle validation help.");
assertSourceIncludes("dashboard/src/components/AppHeader/AppHeader.tsx", 'className="dashboard-header"', "Dashboard header is missing its semantic style hook.");
assertSourceIncludes("dashboard/src/index.css", "height: 50px;", "Dashboard header is not fixed at 50px.");
assertSourceIncludes("dashboard/src/components/AppHeader/AppHeader.tsx", 'aria-label="Burnlist home"', "Dashboard header logo does not link home.");
assertSourceIncludes("dashboard/src/components/AppHeader/AppHeader.tsx", 'aria-label="Primary navigation"', "Dashboard header navigation is missing.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "dashboardFallback", "Dashboard server still contains a fallback renderer.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "burnlist-fallback", "Dashboard server still contains fallback dashboard markup.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "fallback-burn-ovens", "Dashboard server still exposes the fallback Oven bundle.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "legacy-detail-origin", "Burnlist still accepts the retired detail proxy.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", 'url.pathname === "/api/types"', "Burnlist still exposes the retired type API.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", 'url.pathname === "/types/new"', "Burnlist still redirects the retired type UI.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", '"definition.md"', "Burnlist still discovers retired Oven filenames.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", '"dashboard.json"', "Burnlist still discovers retired Oven detail filenames.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", 'value.instructions ?? value.definition', "Oven creation still accepts the retired definition field.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", 'value.detail ?? value.dashboard', "Oven creation still accepts the retired dashboard field.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", '"typeId"', "Burn runs still accept the retired typeId field.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", 'record.typeId', "Burn run reads still accept retired typeId records.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "/assets/fallback-burn-types.js", "Burnlist still exposes the retired type asset alias.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", '["api", "ovens", "types", "runs"]', "Burnlist still reserves the retired types route.");
assertSourceExcludes("dashboard/src/index.css", "tailwindcss", "Dashboard stylesheet still imports Tailwind.");
assertSourceExcludes("dashboard/src/components/BurnOvens/BurnOvens.tsx", "grid-area-title", "Oven detail sections still expose a separate title field.");
assertSourceExcludes("dashboard/src/components/BurnOvens/BurnOvens.tsx", "grid-area-source", "Oven detail sections still expose a source-path field.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "grid-row-height", "New Oven still exposes a row-height control.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", ">Row height<", "New Oven still renders a Row height label.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "Instructions are stored as Markdown", "New Oven still renders the removed Markdown helper text.");
assertSourceExcludes("dashboard/src/components/BurnOvens/BurnOvens.tsx", "Instructions are stored as Markdown", "React New Oven still renders the removed Markdown helper text.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "builder-hint", "New Oven still renders the removed skeleton helper text.");
assertSourceExcludes("dashboard/src/components/BurnOvens/BurnOvens.tsx", "Drag to place a detail section", "React New Oven still renders the removed skeleton helper text.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "grid-ruler", "Oven detail skeleton still renders grid ruler numbers.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", 'class="form-card oven-builder"', "Oven detail skeleton is still wrapped in a card container.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", "schemaVersion: 5", "Burn runs do not write manifest schema version 5.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", "ovenRevision: oven.ovenRevision", "Burn runs do not pin the Oven revision.");
assertSourceIncludes("dashboard/src/components/BurnOvens/BurnOvens.tsx", 'useState("checklist")', "React Run Burn does not default to Checklist.");
assertSourceIncludes("ovens/checklist/instructions.md", "## Active Checklist", "Checklist no longer preserves the Burnlist active queue contract.");
assertSourceIncludes("ovens/differential-testing/instructions.md", "fix the capture, adapter, or comparison seam", "Differential Testing is missing source-fix discipline.");
assertSourceIncludes("ovens/differential-testing/instructions.md", "null remains distinguishable from numeric zero", "Differential Testing is missing null-preservation discipline.");
assertSourceIncludes("ovens/differential-testing/instructions.md", 'authority: "telemetry-only"', "Differential Testing is missing the telemetry authority boundary.");
assertSourceIncludes("ovens/differential-testing/instructions.md", 'authority: "adapter-attested"', "Differential Testing is missing the exact-session attestation boundary.");
assertSourceIncludes("ovens/differential-testing/instructions.md", "one composed candidate transaction", "Differential Testing is missing the lean composed transaction.");
assertSourceIncludes("ovens/differential-testing/instructions.md", "Keep the edit only for `advanced` or `complete`", "Differential Testing is missing the composed keep/reject rule.");
assertSourceIncludes("ovens/differential-testing/instructions.md", "Every newly advanced exact prefix automatically requests", "Differential Testing is missing automatic event-driven refresh.");
assertSourceIncludes("ovens/differential-testing/instructions.md", "No per-candidate ledger", "Differential Testing still requires per-candidate history ceremony.");
assertSourceIncludes("ovens/differential-testing/instructions.md", "queued`, `running`, `complete`, or `failed`", "Differential Testing is missing refresh-state discipline.");
assertSourceExcludes("ovens/differential-testing/instructions.md", "exactCycles", "Differential Testing instructions still expose exactCycles ceremony.");
assertSourceIncludes("ovens/differential-testing/engine/data-contract.mjs", "buildDifferentialTelemetry", "Differential Testing is missing deterministic telemetry construction.");
assertSourceIncludes("dashboard/src/oven/runtime/oven-live-data.ts", 'target.set("scenario"', "Canonical Differential Testing is not bound to read-only scenario selection.");
assertSourceIncludes("dashboard/src/oven/runtime/oven-live-data.ts", 'query.set("pageSize"', "Canonical Differential Testing is not bound to server-side field paging.");
assertSourceIncludes("dashboard/src/oven/runtime/oven-live-data.ts", "subscribeOvenRuntimeSnapshot", "Canonical Differential Testing does not use shared snapshot updates.");
assertSourceIncludes("src/server/burnlist-dashboard-server.mjs", 'from "./oven-projection-coordinator.mjs"', "Dashboard server is missing the canonical Oven projection coordinator.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "oven-warm", "Dashboard server still imports the retired Oven warming layer.");
assertSourceExcludes("ovens/visual-parity/handler.mjs", "readStableVisualParitySource", "Visual Parity still exposes a private stable-read implementation.");
assertSourceIncludes("README.md", "There are no\nhandler warm hooks", "README does not document the canonical-only Oven architecture.");
assertSourceIncludes("skills/burnlist/references/oven-event-coordination.md", "The remaining intervals are intentional and regression-allowlisted", "Oven event guidance does not document surviving timers.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "startDifferentialTestingLiveUpdates", "The legacy Differential Testing live updater still exists.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "differentialTelemetryFieldMap", "Differential Testing Changed view is not bound to telemetry transitions.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "differentialExactTarget", "Differential Testing exact decisions are not bound to exact-session authority.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "exactSession?.exactComparison", "Differential Testing renderer still reads the removed exact-comparison surface.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "reconciled telemetry only", "Differential Testing does not visibly distinguish aggregate telemetry from exact authority.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-render.js", "field.samples", "Differential Testing is missing paired sample charts.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-render.js", 'role="button" tabindex="0" aria-expanded=', "Differential Testing rows do not preserve the expand interaction contract.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", 'placeholder="Search Fields..."', "Differential Testing does not preserve the canonical search control.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", 'data-driving-parity-chart="delta"', "Differential Testing does not preserve the canonical Value and Delta controls.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", 'data-driving-parity-sort="improved"', "Differential Testing does not preserve the canonical Changed control.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", 'data-driving-parity-filter="failing"', "Differential Testing does not preserve the canonical Failed control.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-render.js", 'class="hybrid-cell hybrid-field"', "Differential Testing does not preserve the canonical hybrid field cell.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-render.js", 'class="hybrid-cell hybrid-metric"', "Differential Testing does not preserve the canonical hybrid metric cell.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-render.js", 'class="hybrid-chart"', "Differential Testing does not preserve the canonical hybrid chart cell.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", '`Δ ${value(field.maxDelta)}`', "Differential Testing still invents a Greek delta prefix that the canonical hybrid row never renders.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-render.js", 'value(field.maxDelta)', "Differential Testing drops the canonical plain numeric value line.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-progress-chart.js", "maxTime = Math.max(minTime + 1", "Differential Testing history does not handle one-run data without a floating label.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "spikeThreshold", "Differential Testing history still erases losing telemetry runs that later restore baseline.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-progress-chart.js", "withoutBacktrackedFailedSpikes", "Differential Testing is not using the canonical progress-chart history projection.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "Cards view", "Differential Testing still carries the removed legacy cards view.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", "Cards view", "Differential Testing still carries the removed legacy cards view.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "Table view", "Differential Testing still carries the removed legacy table view.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", "Table view", "Differential Testing still carries the removed legacy table view.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", "grid-template-columns: 20% 10% minmax(0, 70%)", "Differential Testing rows do not use the canonical hybrid geometry.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", "height: 90px", "Differential Testing collapsed rows do not use the canonical height.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", "height: 220px", "Differential Testing expanded rows do not use the canonical height.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", "--driving-parity-top-card-height: 310px", "Differential Testing top panels are missing their standard fixed height.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", ".differential-overview:not([hidden]) + .detail-workspace {\n  height: var(--driving-parity-top-card-height);\n  min-height: var(--driving-parity-top-card-height);\n  max-height: var(--driving-parity-top-card-height);", "Differential Testing top panels can still grow with their log content.");
assertSourceIncludes("dashboard/src/oven/DifferentialLogTable/DifferentialLogTable.tsx", "LOG_ROW_LIMIT = 8", "Differential Testing history does not preserve its eight-event visible contract.");
assertSourceIncludes("dashboard/src/oven/DifferentialLogTable/DifferentialLogTable.tsx", "setInterval", "Differential Testing history ages do not advance while its payload is unchanged.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", 'class="work-panel-title">Overview</div>', "Differential Testing still renders the removed Overview section title.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", 'class="work-panel-title">Overview</div>', "Differential Testing still renders the removed Overview section title.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", "grid-template-columns: 30% minmax(0, 70%)", "Differential Testing top panels do not preserve the canonical 30/70 layout.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", "inset: 28px 0 0", "Differential Testing top panels do not preserve the shared-card template.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", ".driving-parity-view .differential-tabs", "Differential Testing tab groups do not share one component style.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", '--dashboard-title-font: "Helvetica Neue", Helvetica, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;', "Differential Testing does not preserve the canonical title font stack.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", ".driving-parity-view .driving-parity-controls button,\n.driving-parity-view .driving-parity-controls select,\n.driving-parity-view .driving-parity-controls input,\n.driving-parity-view .driving-parity-overall-toggle {\n  font: 14px/1.2 var(--dashboard-title-font);\n}", "Differential Testing controls do not preserve the canonical sans-serif typography.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", '.driving-parity-view .driving-parity-controls input[type="search"],\n.driving-parity-view .driving-parity-controls input[type="search"]:focus {\n  background: transparent;\n}', "Differential Testing search input does not preserve its transparent background.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", "h2 { margin: 0 0 12px; font-size: 16px; font-weight: 400; letter-spacing: 0; }", "Differential Testing panel headings do not preserve the canonical type scale.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", 'return minutes === 0 ? "now" : minutes + "m";', "Differential Testing Age values do not preserve the canonical minute display.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", '`${hours}h`', "Differential Testing Age values still collapse minutes into hours.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", '<h2 id="progress-panel-title">Parity Progress</h2>', "Differential Testing does not render the canonical progress title.");
assertSourceIncludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", 'id="driving-parity-inline-renderer"', "Differential Testing does not preserve the canonical inline renderer boundary.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "isolateDrivingParityFrame", "Differential Testing still moves the canonical inline renderer into a non-reference frame.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "frame.srcdoc", "Differential Testing still publishes the canonical inline renderer through srcdoc.");
assertSourceIncludes("dashboard/src/components/DifferentialTesting/differential-testing.css", "flex: 0 0 auto;", "Differential Testing log rows can stretch to fill the panel.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "differential-exact-session", "Differential Testing adds a non-template exact-authority panel.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", "differential-exact-session", "Differential Testing adds a non-template exact-authority panel.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "Targeted Burn", "Differential Testing renderer still hardcodes a project workflow title.");
assertSourceExcludes("dashboard/src/oven/differential-testing-render/differential-testing-template.js", "Targeted Burn", "Differential Testing renderer still hardcodes a project workflow title.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", "exact comparator when used", "Fallback Run Burn still requests the superseded manual comparator workflow.");
assertSourceExcludes("dashboard/src/components/BurnOvens/BurnOvens.tsx", "exact comparator when used", "React Run Burn still requests the superseded manual comparator workflow.");
assertSourceIncludes("skills/burnlist/SKILL.md", "references/burnlist-creation.md", "The Burnlist skill does not route creation work.");
assertSourceIncludes("skills/burnlist/SKILL.md", "references/oven-event-coordination.md", "The Burnlist skill does not route coordinator event work.");
assertSourceIncludes("src/cli/skills-register.mjs", 'join(home, ".claude", "skills")', "Global npm install does not use the Claude skill directory.");
assertSourceIncludes("src/cli/skills-register.mjs", 'join(home, ".agents", "skills")', "Global npm install does not use the Codex skill directory.");
assertSourceIncludes("bin/burnlist.mjs", "Usage:", "Burnlist CLI help is missing.");
assertSourceIncludes("bin/burnlist.mjs", 'args[0] === "uninstall"', "Burnlist CLI does not own safe uninstall cleanup.");
assertSourceExcludes("README.md", "**Target**", "README still advertises the removed Target Oven.");
assertSourceExcludes("src/server/burnlist-dashboard-server.mjs", '"/targets"', "Dashboard server still exposes the removed Targets route.");
assertSourceExcludes("dashboard/src/App.tsx", '"/targets"', "React dashboard still exposes the removed Targets route.");
assertSourceExcludes("src/ovens/oven-contract.mjs", '"target"', "Oven contract still accepts the removed Target widget.");
assertSkillSet(repoRoot, ["burnlist"]);
const officialOvenExpectations = new Map([
  ["checklist", { name: "Checklist", validator: "validateGenericJsonData" }],
  ["differential-testing", { name: "Differential Testing", validator: "validateDifferentialTestingRuntimeData" }],
  ["model-lab", { name: "Model Lab", validator: "validateModelLabRuntimeData" }],
  ["performance-tracing", { name: "Performance Tracing", validator: "validatePerformanceTracingRuntimeData" }],
  ["streaming-diff", { name: "Streaming Diff" }],
  ["visual-parity", { name: "Visual Parity", validator: "validateVisualParityRuntimeData" }],
]);
const officialIds = officialOvenCatalog.entries.map(({ id }) => id);
if (officialOvenExpectations.size !== officialIds.length
  || officialIds.some((id) => !officialOvenExpectations.has(id))) {
  console.error("Official Oven documentation expectations must match the catalog exactly.");
  process.exit(1);
}
assertBuiltInOvenSet(repoRoot, officialIds);
for (const entry of officialOvenCatalog.entries) {
  const expectation = officialOvenExpectations.get(entry.id);
  assertBuiltInOven(repoRoot, entry.id, expectation.name);
  assertBuiltInOvenDataDocs(repoRoot, entry.id, {
    dataInput: entry.dataInput,
    validator: expectation.validator,
  });
}
assertDifferentialTestingContractAssets();
assertPublishablePackage();

run(process.execPath, ["scripts/audit-console-oven-behavior.mjs", "--check"]);
run(process.execPath, ["scripts/audit-terminal-oven-parity.mjs", "--check"]);
run("npm", ["run", "check:terminal-story-frames"]);
run(process.execPath, ["--test", ...verificationTestFiles]);
for (const file of verificationSerialTestFiles) run(process.execPath, ["--test", file]);
run(process.execPath, ["dashboard/src/oven/test-support/run-oven-tests.mjs"]);

const {
  BURNLIST_CLAUDE_SKILLS_DIR: ignoredClaudeSkillsDir,
  BURNLIST_SKILLS_DIR: ignoredCodexSkillsDir,
  ...verificationEnv
} = process.env;
const verificationHome = resolve(repoRoot, "fixtures", "npm-home");
const skillDryRun = runCapture(process.execPath, ["scripts/register-skills.mjs", "--force-global", "--dry-run"], {
  env: { ...verificationEnv, HOME: verificationHome },
});
for (const target of [
  join(verificationHome, ".claude", "skills", "burnlist"),
  join(verificationHome, ".agents", "skills", "burnlist"),
]) {
  if (!skillDryRun.includes(target)) {
    console.error(`Global skill registration dry-run did not include ${target}.`);
    process.exit(1);
  }
}
process.stdout.write(skillDryRun);
run(process.execPath, ["bin/burnlist.mjs", "--version"]);
run(process.execPath, ["bin/burnlist.mjs", "--stamp"]);
run(process.execPath, ["bin/burnlist.mjs", "differential-testing", "schema"]);
run(process.execPath, ["bin/burnlist.mjs", "differential-testing", "sdk"]);

scanSourceLeaks();

console.log("Verification passed.");
