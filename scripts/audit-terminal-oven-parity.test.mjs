import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, readdir, rm, stat, symlink, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { auditTerminalOvenParity, assertCompiledTarget, SCHEMA, validateTerminalParity } from "./terminal-oven-parity-lib.mjs";
import { buildTerminalOvenCorpus } from "./terminal-oven-parity-corpus.mjs";
import { discoverStorybook, discoverTerminalActions } from "./terminal-oven-parity-source.mjs";
import { compileOven } from "../src/ovens/dsl/oven-compile.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (cwd, args, env = {}) => new Promise((done) => { const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] }); let output = ""; child.stdout.on("data", (x) => { output += x; }); child.stderr.on("data", (x) => { output += x; }); child.on("close", (code) => done({ code, output })); });
async function fixture() { const target = await mkdtemp(join(tmpdir(), "burnlist-terminal-inventory-")); try { for (const path of ["dashboard", "src", "ovens", "tui", "scripts", "console-oven-behavior-policy.json", "console-oven-behavior.json", "package.json"]) await cp(join(root, path), join(target, path), { recursive: true }); await symlink(join(root, "node_modules"), join(target, "node_modules"), "dir"); assert.equal((await run(target, ["scripts/write-terminal-story-contracts.mjs"])).code, 0); assert.equal((await run(target, ["scripts/audit-terminal-oven-parity.mjs", "--write"])).code, 0); return target; } catch (error) { await rm(target, { recursive: true, force: true }); throw error; } }
async function withFixture(fn) { const target = await fixture(); try { await fn(target); } finally { await rm(target, { recursive: true, force: true }); } }
async function replace(target, path, before, after) { const full = join(target, path), source = await readFile(full, "utf8"); assert.ok(source.includes(before), `missing ${before}`); await writeFile(full, source.replace(before, after)); }
async function fails(target, pattern, args = ["scripts/audit-terminal-oven-parity.mjs", "--check"]) { const result = await run(target, args); assert.notEqual(result.code, 0); assert.match(result.output, pattern); }

test("source union is finite, classifies FILTERS as data, and records all source gaps", async () => {
  const manifest = await auditTerminalOvenParity(root), rows = [...manifest.denominatorA.grammar, ...manifest.denominatorA.compiledIR, ...manifest.denominatorA.b34References, ...manifest.denominatorA.officialOvens, ...manifest.denominatorB.publicExports, ...manifest.denominatorB.stories];
  assert.equal(manifest.schema, SCHEMA); assert.equal(manifest.denominatorA.compiledIR.length, 455); assert.equal(new Set(rows.map((x) => x.id)).size, rows.length); assert.equal(manifest.terminal.coverage.implemented, 0); assert.ok(manifest.denominatorB.publicExports.some((row) => row.export === "FILTERS" && row.classification === "data"));
});

test("B6 evidence schema is tracked but cannot alter B1 canonical coverage", async () => {
  const index = JSON.parse(await readFile(join(root, "tui/src/oven-runtime/terminal-evidence-index.json"), "utf8")); assert.equal(index.schema, "burnlist-terminal-evidence-index@1"); assert.equal(index.generator, "burnlist-b6-offscreen@1"); assert.equal(index.records.length, 6); assert.ok(index.records.every((record) => record.artifactPath.startsWith("dashboard/src/generated/terminal-frames/") && /^[a-f0-9]{64}$/u.test(record.artifactSha256)));
  await withFixture(async (target) => { await replace(target, "tui/src/oven-runtime/terminal-evidence-index.json", '"checkpoint": "t0"', '"checkpoint": "fabricated"'); await fails(target, /B6 offscreen harness/u, ["scripts/audit-terminal-oven-parity.mjs", "--official-ovens"]); });
});

test("stateful Storybook sources have finite source-dependent action matrices", async () => {
  const stories = await discoverStorybook(root), byId = (needle) => stories.find((row) => row.id.includes(needle));
  const checkbox = byId("Checkbox/Checkbox.stories.tsx#Interactive"), states = byId("Checkbox/Checkbox.stories.tsx#States"), tabs = byId("Tabs/Tabs.stories.tsx#Default"), filters = byId("Filters/Filters.stories.tsx#Lifecycle"), toggles = byId("ToggleGroup/ToggleGroup.stories.tsx#Multiple"), viewMode = byId("ToggleGroup/ToggleGroup.stories.tsx#ViewMode"), select = byId("Select/Select.stories.tsx#Lifecycle"), copy = byId("CopyButton/CopyButton.stories.tsx#Default");
  assert.deepEqual(checkbox.stateMatrix.map((row) => row.sourceState.checkboxes["checkbox:Include completed Burnlists | onCheckedChange"]), ["unchecked", "checked"]); assert.match(checkbox.stateMatrix[0].actions[0].expectedConsoleOutcome, /checked/u); assert.match(checkbox.stateMatrix[1].actions[0].expectedConsoleOutcome, /unchecked/u);
  assert.equal(states.stateMatrix.length, 4); assert.ok(states.stateMatrix.every((row) => row.sourceState.checkboxes["checkbox:Indeterminate"] === "indeterminate")); assert.deepEqual(new Set(states.stateMatrix.flatMap((row) => row.actions.map((action) => action.id))), new Set(["checkbox:Unchecked", "checkbox:Checked"])); assert.deepEqual(tabs.stateMatrix.map((row) => row.sourceState.selection), ["active", "complete", "blocked"]); assert.match(tabs.stateMatrix[1].actions[0].expectedConsoleOutcome, /visible panel is active/u); assert.equal(filters.stateMatrix.length, 5); assert.equal(toggles.stateMatrix.length, 8); assert.match(toggles.stateMatrix.find((row) => row.id === "state-exact")?.actions.find((action) => action.id.includes("exact"))?.expectedConsoleOutcome || "", /none/u); assert.deepEqual(viewMode.stateMatrix.map((row) => row.sourceState.selection), ["none", "list", "table", "chart"]); assert.deepEqual(select.stateMatrix.map((row) => row.sourceState.selection), ["draft", "ready", "active", "complete"]); assert.match(copy.stateMatrix[0].actions[0].expectedConsoleOutcome, /clipboard.*Copied.*1500/u);
});

test("named exports, source transitions, and cross-layer declarations fail independently", async () => withFixture(async (target) => {
  await replace(target, "dashboard/src/layout/index.ts", 'export { Button, buttonVariants } from "./Button";', 'export { Button, buttonVariants } from "./Button";\nexport { Button as SecondaryButton } from "./Button";'); await fails(target, /stale/u);
  const transition = await fixture(); try { await replace(transition, "dashboard/src/terminal-parity/story-contracts.json", "Select tab complete; the visible panel is complete.", "Select tab complete; the visible panel is wrong."); await fails(transition, /cross-layer action mismatch/u, ["scripts/audit-terminal-oven-parity.mjs", "--official-ovens"]); } finally { await rm(transition, { recursive: true, force: true }); }
  const both = await fixture(); try { await replace(both, "dashboard/src/components/CopyButton/CopyButton.tsx", "Copied", "Done"); await replace(both, "dashboard/src/terminal-parity/story-contracts.json", "Copied, then restore Copy", "Done, then restore Copy"); await fails(both, /state matrix mismatch|cross-layer action mismatch/u, ["scripts/audit-terminal-oven-parity.mjs", "--official-ovens"]); } finally { await rm(both, { recursive: true, force: true }); }
}));

test("external named Storybook re-exports are part of the finite denominator", async () => withFixture(async (target) => {
  const external = join(target, "dashboard/src/components/Filters/external.stories.tsx"), middle = join(target, "dashboard/src/components/Filters/middle.stories.tsx"); await writeFile(external, 'export const Foo = { render: () => <button type="button">External action</button> };\n'); await writeFile(middle, 'export { Foo as ForwardedFoo } from "./external.stories";\n'); await replace(target, "dashboard/src/components/Filters/Filters.stories.tsx", "export const Lifecycle", 'export { ForwardedFoo as ExternalFoo } from "./middle.stories";\n\nexport const Lifecycle'); const stories = await discoverStorybook(target); assert.ok(stories.some((row) => row.id.endsWith("Filters.stories.tsx#ExternalFoo"))); await fails(target, /missing finite states|stale/u); await writeFile(external, 'export { ForwardedFoo as Foo } from "./middle.stories";\n'); await fails(target, /cyclic Storybook re-export/u, ["scripts/audit-terminal-oven-parity.mjs", "--official-ovens"]);
}));

test("bare hidden controls are excluded instead of being treated as absent attributes", async () => withFixture(async (target) => {
  await replace(target, "dashboard/src/layout/Tabs/Tabs.stories.tsx", "<TabsList aria-label=\"Burnlist lifecycle\"", "<button hidden>Reset</button><TabsList aria-label=\"Burnlist lifecycle\"");
  const stories = await discoverStorybook(target), tabs = stories.find((row) => row.id.endsWith("Tabs/Tabs.stories.tsx#Default")); assert.ok(tabs); assert.ok(!tabs.controls.some((row) => row.id.includes("Reset")));
}));

test("each legal corpus target is compared against raw compiled IR", async () => withFixture(async (target) => {
  await replace(target, "scripts/terminal-oven-parity-corpus.mjs", "const attributes = Object.fromEntries", 'if (id === "box:data-detail-tab") element = "missing"; const attributes = Object.fromEntries'); const writer = 'import { writeFile } from "node:fs/promises"; import { buildTerminalOvenCorpus } from "./scripts/terminal-oven-parity-corpus.mjs"; await writeFile("terminal-oven-parity-corpus.json", `${JSON.stringify(buildTerminalOvenCorpus(), null, 2)}\\n`);'; assert.equal((await run(target, ["--input-type=module", "--eval", writer])).code, 0); await fails(target, /compiled target mismatch/u, ["scripts/audit-terminal-oven-parity.mjs", "--official-ovens"]);
}));

test("every corpus predicate rejects a changed raw compiler output", () => {
  const find = (ir, kind, parent = null, rows = []) => { for (const node of ir.root || []) visit(node, parent, rows); return rows.filter((row) => row.node.kind === kind); };
  const visit = (node, parent, rows) => { rows.push({ node, parent }); for (const child of node.children || []) visit(child, node, rows); };
  for (const recipe of buildTerminalOvenCorpus().recipes) {
    const compiled = compileOven(recipe.recipe, { file: recipe.id }); assert.ok(compiled.ok, recipe.id); const ir = structuredClone(compiled.ir), wanted = recipe.expectedTarget.coverageTarget, nodes = find(ir, wanted.element);
    if (wanted.registry === "theme") ir.theme = "missing";
    else if (wanted.registry === "contract") ir.contract = "missing";
    else if (wanted.registry === "format") ir.requirements.formats = [];
    else if (wanted.registry === "icon") ir.requirements.icons = [];
    else if (["filter", "sort"].includes(wanted.registry)) ir.requirements.selectors = [];
    else if (wanted.binding) { for (const row of nodes) if (row.parent) row.parent.bindings = {}; }
    else if (wanted.child && wanted.element === "oven") ir.root = ir.root.filter((child) => child.kind !== wanted.child);
    else if (wanted.child) for (const row of nodes) row.node.children = row.node.children.filter((child) => child.kind !== wanted.child);
    else if (wanted.transition) { for (const row of nodes) row.node.kind = "missing"; ir.controls = ir.controls.filter((control) => control.kind !== wanted.element); }
    else if (Object.keys(wanted.attributes).length) { const [key] = Object.keys(wanted.attributes); if (wanted.element === "oven") ir[key] = "missing"; else for (const row of nodes) row.node.attributes[key] = "missing"; }
    else if (wanted.element === "oven") ir.root = [];
    else for (const row of nodes) row.node.kind = "missing";
    assert.throws(() => assertCompiledTarget(ir, recipe.expectedTarget), /compiled target mismatch/u, recipe.id);
  }
});

test("pre-B6 terminal annotations fail closed", async () => withFixture(async (target) => {
  await replace(target, "tui/src/oven-runtime/capability-registry.ts", "export const TERMINAL_OVEN_ACTIONS: readonly TerminalActionAnnotation[] = Object.freeze([]);", 'export const TERMINAL_OVEN_ACTIONS: readonly TerminalActionAnnotation[] = Object.freeze([{ recordId: "fabricated", actionId: "terminal-action:missing" }]);'); await fails(target, /B6 offscreen harness/u, ["scripts/audit-terminal-oven-parity.mjs", "--official-ovens"]);
}));

test("every keyboard handler branch is an AST-derived stale denominator", async () => withFixture(async (target) => {
  const path = join(target, "tui/src/app.tsx"), source = await readFile(path, "utf8");
  const before = await discoverTerminalActions(target), extra = join(target, "tui/src/extra-keyboard.tsx"); await writeFile(path, source.replace('if (key.name === "q") return back();', 'if (key.name === "q") return refresh();')); assert.notDeepEqual((await discoverTerminalActions(target)).actions, before.actions); await fails(target, /stale/u); await writeFile(path, source.replace('if (key.name === "q") return back();', 'if (key.name === "z") return refresh();\n    if (key.name === "q") return back();')); assert.equal((await discoverTerminalActions(target)).actions.length, before.actions.length + 1); await fails(target, /stale/u); await writeFile(path, source.replace('if (key.name === "q") return back();', '')); assert.equal((await discoverTerminalActions(target)).actions.length, before.actions.length - 1); await fails(target, /stale/u); await writeFile(path, source); await writeFile(extra, 'import { useKeyboard as useKeys } from "@opentui/react"; const keys = useKeys; const onExtraKey = (key: { name: string }) => { if (key.name === "x") return; }; export function ExtraKeyboard() { keys(onExtraKey); return null; }\n'); assert.equal((await discoverTerminalActions(target)).actions.length, before.actions.length + 1); await fails(target, /stale/u); await writeFile(extra, 'import { useKeyboard } from "@opentui/react"; const first = second; const second = first; export function ExtraKeyboard() { useKeyboard(first); return null; }\n'); await fails(target, /cyclic keyboard callback/u, ["scripts/audit-terminal-oven-parity.mjs", "--official-ovens"]);
}));

test("Story controls distinguish inert presentation from an actionable handler", async () => withFixture(async (target) => {
  const card = (await discoverStorybook(target)).find((entry) => entry.id.endsWith("Card/Card.stories.tsx#OvenSummary")); assert.equal(card.stateMatrix[0].actions.length, 0);
  await replace(target, "dashboard/src/layout/Card/Card.stories.tsx", '<Button size="sm" variant="outline">Open Oven</Button>', '<Button size="sm" variant="outline" onClick={() => undefined}>Open Oven</Button>');
  const actionable = (await discoverStorybook(target)).find((entry) => entry.id.endsWith("Card/Card.stories.tsx#OvenSummary")); assert.equal(actionable.stateMatrix[0].actions.length, 1); assert.match(actionable.stateMatrix[0].actions[0].id, /Open Oven/u);
}));

test("pre-B6 terminal capability claims fail closed", async () => withFixture(async (target) => {
  await replace(target, "tui/src/oven-runtime/capability-registry.ts", "export const TERMINAL_OVEN_CAPABILITIES: readonly TerminalCapabilityClaim[] = Object.freeze([]);", 'export const TERMINAL_OVEN_CAPABILITIES: readonly TerminalCapabilityClaim[] = Object.freeze([{ sourceFamilyId: "fabricated", implementationExport: "tui/src/app.tsx#App", fixtureIds: ["echo"], atomMappings: [] }]);'); await fails(target, /B6 offscreen harness/u, ["scripts/audit-terminal-oven-parity.mjs", "--official-ovens"]);
}));

test("a Story action cannot cover its state render atom", async () => {
  const value = structuredClone(await auditTerminalOvenParity(root)), row = value.denominatorB.stories.find((entry) => value.atomicDenominator.some((atom) => atom.rowId === entry.id && atom.kind === "story-action")), action = value.atomicDenominator.find((atom) => atom.rowId === row.id && atom.kind === "story-action"), render = value.atomicDenominator.find((atom) => atom.rowId === row.id && atom.kind === "story-render");
  action.mappingStatus = "implemented"; assert.equal(render.mappingStatus, "gap"); row.mappingStatus = "partial"; row.atomCoverage = { implemented: 1, total: row.atomCoverage.total, status: "partial" }; value.terminal.registry.covered = [action.id]; value.terminal.coverage.implemented = 1; value.terminal.coverage.status = "partial"; assert.doesNotThrow(() => validateTerminalParity(value)); row.mappingStatus = "implemented"; row.atomCoverage.status = "implemented"; assert.throws(() => validateTerminalParity(value), /inexact atomic row coverage/u);
});

test("pre-B6 fabricated evidence cannot cover non-action atoms", async () => withFixture(async (target) => {
  await replace(target, "tui/src/oven-runtime/capability-registry.ts", "export const TERMINAL_OVEN_ACTIONS: readonly TerminalActionAnnotation[] = Object.freeze([]);", 'export const TERMINAL_OVEN_ACTIONS: readonly TerminalActionAnnotation[] = Object.freeze([{ recordId: "fabricated", actionId: "terminal-action:fake" }]);'); await fails(target, /B6 offscreen harness/u, ["scripts/audit-terminal-oven-parity.mjs", "--official-ovens"]);
}));

test("check mode is non-writing and atomic failure removes only its exact temporary output", async () => withFixture(async (target) => {
  const manifest = join(target, "terminal-oven-parity.json"), before = await readFile(manifest, "utf8"), time = (await stat(manifest)).mtimeMs;
  assert.equal((await run(target, ["scripts/audit-terminal-oven-parity.mjs", "--check"])).code, 0); assert.equal(await readFile(manifest, "utf8"), before); assert.equal((await stat(manifest)).mtimeMs, time);
  const result = await run(target, ["scripts/audit-terminal-oven-parity.mjs", "--write"], { BURNLIST_TERMINAL_INVENTORY_FAIL_AFTER_TEMP: "1" }); assert.notEqual(result.code, 0); assert.equal(await readFile(manifest, "utf8"), before); const names = await readdir(target); assert.ok(!names.some((name) => name.startsWith("terminal-oven-parity.json.") && name.endsWith(".tmp")));
}));

test("malformed manifests and current behavior source mutations fail closed", async () => {
  const value = structuredClone(await auditTerminalOvenParity(root)); value.terminal.coverage.total = 0; assert.throws(() => validateTerminalParity(value), /inexact terminal coverage/u);
  const exact = structuredClone(await auditTerminalOvenParity(root)), first = exact.atomicDenominator[0], second = exact.atomicDenominator[1], row = [...exact.denominatorA.grammar, ...exact.denominatorA.compiledIR, ...exact.denominatorA.b34References, ...exact.denominatorA.officialOvens, ...exact.denominatorB.publicExports, ...exact.denominatorB.stories].find((entry) => entry.id === first.rowId); first.mappingStatus = "implemented"; row.mappingStatus = "implemented"; row.atomCoverage = { implemented: 1, total: 1, status: "implemented" }; exact.terminal.registry.covered = [first.id]; exact.terminal.coverage = { implemented: 1, total: exact.atomicDenominator.length, status: "partial" }; assert.doesNotThrow(() => validateTerminalParity(exact)); exact.terminal.registry.covered = [second.id]; assert.throws(() => validateTerminalParity(exact), /inexact terminal coverage/u); exact.terminal.registry.covered = ["atom:unknown"]; assert.throws(() => validateTerminalParity(exact), /incomplete source mapping/u); exact.terminal.registry.covered = [first.id, first.id]; assert.throws(() => validateTerminalParity(exact), /incomplete source mapping/u);
  await withFixture(async (target) => { await replace(target, "ovens/checklist/checklist.oven", 'id="checklist"', 'id="checklist-mutated"'); await fails(target, /stale/u); });
});
