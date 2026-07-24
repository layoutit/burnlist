import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { auditConsoleOvenBehavior, policyFor, SCHEMA, validateInventory } from "./console-oven-behavior-lib.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
async function fixture() {
  const temp = await mkdtemp(join(tmpdir(), "burnlist-console-oven-"));
  await Promise.all([cp(join(root, "dashboard"), join(temp, "dashboard"), { recursive: true }), cp(join(root, "src/ovens/dsl"), join(temp, "src/ovens/dsl"), { recursive: true }), cp(join(root, "src/ovens/oven-value-runtime.mjs"), join(temp, "src/ovens/oven-value-runtime.mjs")), cp(join(root, "console-oven-behavior-policy.json"), join(temp, "console-oven-behavior-policy.json"))]);
  return temp;
}
async function mutate(root, path, before, after) {
  const file = join(root, path), source = await readFile(file, "utf8");
  assert.ok(source.includes(before), `missing mutation needle ${before}`);
  await writeFile(file, source.replace(before, after), "utf8");
}
async function withFixture(run) { const temp = await fixture(); try { await run(temp); } finally { await rm(temp, { recursive: true, force: true }); } }

test("audit has exact versioned ownership and complete source coverage", async () => {
  const inventory = await auditConsoleOvenBehavior(root);
  assert.equal(inventory.schema, SCHEMA);
  assert.ok(inventory.authoritativeSources.oven.length > 100);
  assert.ok(inventory.behaviors.length > 300);
  assert.ok(inventory.behaviors.every((row) => row.source.fingerprint && row.semanticOwner.path && row.semanticOwner.version === SCHEMA));
});

test("generated audit JSON has no personal paths or forbidden generated wording", async () => {
  const canonical = (text) => text.replaceAll(/driving-parity/giu, "").replaceAll(/driving parity/giu, "").replaceAll(/visual-parity/giu, "").replaceAll(/visual parity/giu, "").replaceAll(/parity progress/giu, "");
  const forbiddenWord = new RegExp(`\\b${["par", "ity"].join("")}\\b`, "iu");
  for (const file of ["console-oven-behavior.json", "console-oven-behavior-policy.json"]) {
    const text = canonical(await readFile(join(root, file), "utf8"));
    assert.doesNotMatch(text, /\/Users\//u, `${file} contains a personal path`);
    assert.doesNotMatch(text, forbiddenWord, `${file} contains forbidden generated wording`);
  }
});

test("real isolated source mutations fail or invalidate the generated inventory", async () => withFixture(async (temp) => {
  const original = await auditConsoleOvenBehavior(temp);
  await mutate(temp, "src/ovens/dsl/oven-grammar.mjs", "  box: {", "  \"box-removed\": {");
  await assert.rejects(auditConsoleOvenBehavior(temp), /unknown renderer kind/u);
  await mutate(temp, "src/ovens/dsl/oven-grammar.mjs", "  \"box-removed\": {", "  box: {");
  await mutate(temp, "dashboard/src/oven/runtime/theme-registry.ts", '"visual-parity": visualParity,', '"visual-parity": visualParity, "extra": visualParity,');
  await assert.rejects(auditConsoleOvenBehavior(temp), /unknown theme extra/u);
  await mutate(temp, "dashboard/src/oven/runtime/theme-registry.ts", '"visual-parity": visualParity, "extra": visualParity,', '"visual-parity": visualParity,');
  await mutate(temp, "dashboard/src/oven/runtime/OvenNode.tsx", 'node.kind === "model-lab-view"', 'node.kind === "unmapped-kind"');
  await assert.rejects(auditConsoleOvenBehavior(temp), /unknown renderer kind/u);
  assert.ok(original.behaviors.length > 0);
}));

test("route/predicate/adapter mutations reject against the approved policy", async () => withFixture(async (temp) => {
  const before = await auditConsoleOvenBehavior(temp);
  await mutate(temp, "dashboard/src/lib/route-model.mjs", "if (path.length === 0)", "if (path.length !== 0)");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy|component registry differs from grammar/u);
  await mutate(temp, "dashboard/src/oven/runtime/OvenNode.tsx", ', "frame-card"].includes(node.kind)', '].includes(node.kind)');
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy|format registry differs from grammar/u);
  await mutate(temp, "dashboard/src/oven/runtime/OvenNode.tsx", "if (node.kind === \"switch\")", "if (node.kind !== \"switch\")");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy/u);
  await mutate(temp, "dashboard/src/oven/runtime/OvenNode.tsx", '"pagination"].includes(node.kind)', '"unknown-control"].includes(node.kind)');
  await assert.rejects(auditConsoleOvenBehavior(temp), /unknown renderer kind|differs from approved policy/u);
  await mutate(temp, "dashboard/src/oven/runtime/OvenNode.tsx", '"metric-tiles",', '"unknown-widget",');
  await assert.rejects(auditConsoleOvenBehavior(temp), /unknown renderer kind|differs from approved policy/u);
  const invalid = structuredClone(before); invalid.behaviors[0].semanticOwner.version = "invalid";
  assert.throws(() => validateInventory(invalid), /invalid semantic owner/u);
}));

test("official Oven fixtures cannot influence the source inventory", async () => withFixture(async (temp) => {
  const before = await auditConsoleOvenBehavior(temp);
  await writeFile(join(temp, "dashboard", "ignored.oven"), "<oven id=\"ignored\"/>");
  assert.deepEqual(await auditConsoleOvenBehavior(temp), before);
}));

test("shared evaluator decisions are authoritative and policy-owned", async () => withFixture(async (temp) => {
  const before = await auditConsoleOvenBehavior(temp, { compare: false });
  assert.deepEqual(before.authoritativeSources.shared, ["src/ovens/oven-value-runtime.mjs"]);
  const owned = before.behaviors.filter((row) => row.source.path === "src/ovens/oven-value-runtime.mjs");
  assert.ok(owned.length > 0);
  assert.ok(owned.every((row) => row.classification === "closed-shared-adapter" && row.semanticOwner.ownerTarget === `${row.source.path}:${row.source.export}`));
  await writeFile(join(temp, "console-oven-behavior-policy.json"), `${JSON.stringify(policyFor(before), null, 2)}\n`, "utf8");
  await mutate(temp, "src/ovens/oven-value-runtime.mjs", "if (!binding.optional)", "if (binding.optional)");
  const after = await auditConsoleOvenBehavior(temp, { compare: false });
  assert.notDeepEqual(after.behaviors.filter((row) => row.source.path === "src/ovens/oven-value-runtime.mjs"), owned);
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy/u);
}));

test("incidental source offsets do not change semantic IDs or policy approval", async () => withFixture(async (temp) => {
  const before = await auditConsoleOvenBehavior(temp);
  const file = join(temp, "dashboard/src/lib/route-model.mjs");
  await writeFile(file, `// unrelated leading comment\n${await readFile(file, "utf8")}`, "utf8");
  const after = await auditConsoleOvenBehavior(temp);
  assert.deepEqual(after.behaviors.map((row) => row.id), before.behaviors.map((row) => row.id));
}));

test("registry and theme changes reject before an unapproved console capability can ship", async () => withFixture(async (temp) => {
  await mutate(temp, "dashboard/src/oven/OvenView/registries.ts", "KpiStrip,", "UnknownComponent,");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy|component registry differs from grammar/u);
  await mutate(temp, "dashboard/src/oven/OvenView/registries.ts", "identity:", "unknownFormat:");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy|format registry differs from grammar/u);
  await mutate(temp, "dashboard/src/oven/OvenView/registries.ts", "ClipboardList:", "UnknownIcon:");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy|format registry differs from grammar|icon registry differs from grammar/u);
  await mutate(temp, "dashboard/src/oven/runtime/theme-registry.ts", "runtimeLayout: \"differential-testing\"", "runtimeLayout: \"unknown-layout\"");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy|format registry differs from grammar/u);
  await mutate(temp, "dashboard/src/oven/runtime/theme-registry.ts", "kinds: Object.freeze([\"kpi-strip\"])", "kinds: Object.freeze([\"unknown-region\"])");
  await assert.rejects(auditConsoleOvenBehavior(temp), /unknown renderer kind|semantic capabilities differ from approved policy|format registry differs from grammar/u);
}));

test("wrapper, dispatcher owner, and structured-policy mutations are fail closed", async () => withFixture(async (temp) => {
  await mutate(temp, "dashboard/src/components/VisualParity/VisualParity.tsx", "export function", "export const changed = true;\nexport function");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy/u);
  const dispatch = await fixture();
  try {
    await mutate(dispatch, "dashboard/src/oven/runtime/OvenNode.tsx", "<ModelLabView", "<UnexpectedModelLabView");
    await assert.rejects(auditConsoleOvenBehavior(dispatch), /model-lab dispatcher has no static ModelLabView owner/u);
  } finally { await rm(dispatch, { recursive: true, force: true }); }
  const policyPath = join(temp, "console-oven-behavior-policy.json");
  const policy = JSON.parse(await readFile(policyPath, "utf8"));
  policy.capabilities[0].semanticOwner.ownerTarget = "unapproved-owner";
  await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy/u);
}));

test("spread provenance and grammar guards fail even without policy comparison", async () => withFixture(async (temp) => {
  await mutate(temp, "dashboard/src/oven/OvenView/registries.ts", "identity: ovenFormatRegistry.identity,", "changedIdentity: ovenFormatRegistry.identity,");
  await assert.rejects(auditConsoleOvenBehavior(temp, { compare: false }), /format registry differs from grammar/u);
  const spread = await fixture();
  try {
    await mutate(spread, "dashboard/src/oven/OvenView/registries.ts", "identity: ovenFormatRegistry.identity,", "...unownedFormatRegistry,");
    await assert.rejects(auditConsoleOvenBehavior(spread, { compare: false }), /unowned spread/u);
  } finally { await rm(spread, { recursive: true, force: true }); }
  const theme = await fixture();
  try {
    await mutate(theme, "dashboard/src/oven/runtime/theme-registry.ts", "runtimeLayout: \"differential-testing\"", "runtimeLayout: \"unknown-layout\"");
    await assert.rejects(auditConsoleOvenBehavior(theme, { compare: false }), /unknown runtimeLayout/u);
  } finally { await rm(theme, { recursive: true, force: true }); }
}));

test("renderer-owned theme/detail decisions and exact components are independently guarded", async () => withFixture(async (temp) => {
  await mutate(temp, "dashboard/src/oven/runtime/differential-testing-theme-view.tsx", "state.payload === undefined", "state.payload !== undefined");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy/u);
  const detail = await fixture();
  try {
    await mutate(detail, "dashboard/src/oven/runtime/differential-testing-detail.tsx", "payload.primaryChartTitle ||", "payload.primaryChartTitle ??");
    await assert.rejects(auditConsoleOvenBehavior(detail), /semantic capabilities differ from approved policy/u);
  } finally { await rm(detail, { recursive: true, force: true }); }
  const unknown = await fixture();
  try {
    await mutate(unknown, "dashboard/src/oven/OvenView/registries.ts", "KpiStrip,", "UnknownComponent,");
    await assert.rejects(auditConsoleOvenBehavior(unknown, { compare: false }), /component registry differs from grammar/u);
  } finally { await rm(unknown, { recursive: true, force: true }); }
  const missing = await fixture();
  try {
    await mutate(missing, "dashboard/src/oven/OvenView/registries.ts", "Box,", "RemovedBox,");
    await assert.rejects(auditConsoleOvenBehavior(missing, { compare: false }), /component registry differs from grammar/u);
  } finally { await rm(missing, { recursive: true, force: true }); }
}));

test("legacy differential renderer status and chart decisions are policy-owned", async () => withFixture(async (temp) => {
  await mutate(temp, "dashboard/src/oven/differential-testing-render/differential-testing-renderer.js", "clientStatus === \"loading\"", "clientStatus === \"waiting\"");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy/u);
  const chart = await fixture();
  try {
    await mutate(chart, "dashboard/src/oven/differential-testing-render/differential-testing-progress-chart.js", "if (includeSeconds)", "if (includeMilliseconds)");
    await assert.rejects(auditConsoleOvenBehavior(chart), /semantic capabilities differ from approved policy/u);
  } finally { await rm(chart, { recursive: true, force: true }); }
}));

test("registry spread provenance names its source export and is policy-owned", async () => {
  const inventory = await auditConsoleOvenBehavior(root);
  const rows = inventory.behaviors.filter((row) => row.source.node === "registry-entry");
  for (const row of rows) {
    const source = await readFile(join(root, row.source.path), "utf8"), tree = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"] });
    let found = false;
    for (const statement of tree.program.body) if (statement.type === "ExportNamedDeclaration" && statement.declaration?.declarations?.some((declaration) => declaration.id?.name === row.source.export)) found = true;
    assert.ok(found, `${row.source.path} does not export ${row.source.export}`);
  }
  const progress = rows.find((row) => row.id === "registry:formatRegistry:progress-headline");
  assert.deepEqual({ path: progress.source.path, export: progress.source.export, owner: progress.semanticOwner.ownerTarget }, { path: "dashboard/src/oven/OvenView/registries.ts", export: "formatRegistry", owner: "dashboard/src/oven/OvenView/registries.ts:formatRegistry" });
  await withFixture(async (temp) => {
    const policyPath = join(temp, "console-oven-behavior-policy.json"), policy = JSON.parse(await readFile(policyPath, "utf8"));
    policy.capabilities.find((row) => row.id === "registry:formatRegistry:progress-headline").semanticOwner.ownerTarget = "wrong-origin";
    await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
    await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy/u);
  });
});

test("every authoritative AST decision owns exactly one policy behavior", async () => {
  const inventory = await auditConsoleOvenBehavior(root), paths = [...new Set([...inventory.authoritativeSources.oven, ...inventory.authoritativeSources.wrappers, ...inventory.authoritativeSources.shared])], actual = inventory.behaviors.filter((row) => ["IfStatement", "ConditionalExpression", "SwitchCase", "LogicalExpression"].includes(row.source.node));
  let expected = 0;
  const count = (node) => { if (!node || typeof node !== "object") return; if (["IfStatement", "ConditionalExpression", "LogicalExpression"].includes(node.type) || (node.type === "SwitchCase" && node.test)) expected += 1; for (const value of Object.values(node)) { if (Array.isArray(value)) value.forEach(count); else if (value?.type) count(value); } };
  for (const path of paths) count(parse(await readFile(join(root, path), "utf8"), { sourceType: "module", plugins: ["typescript", "jsx"] }));
  assert.equal(actual.length, expected);
  assert.ok(actual.every((row) => row.classification !== "blocker-to-migrate" || inventory.authoritativeSources.wrappers.includes(row.source.path) || row.source.path.endsWith("theme-registry.ts")));
});

test("previously untracked OvenView and ModelLabView decisions reject policy changes", async () => withFixture(async (temp) => {
  await mutate(temp, "dashboard/src/oven/OvenView/OvenView.tsx", "\"component\" in slotDef", "\"widget\" in slotDef");
  await assert.rejects(auditConsoleOvenBehavior(temp), /semantic capabilities differ from approved policy/u);
  const lab = await fixture();
  try {
    await mutate(lab, "dashboard/src/oven/ModelLabView/ModelLabView.tsx", "runtime?.status === \"ready\"", "runtime?.status === \"waiting\"");
    await assert.rejects(auditConsoleOvenBehavior(lab), /semantic capabilities differ from approved policy/u);
  } finally { await rm(lab, { recursive: true, force: true }); }
}));
