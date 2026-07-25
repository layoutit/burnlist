import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { auditTerminalOvenParity, storyDirectoryOwners, validateStorybookOwnership, validateTerminalParity } from "./terminal-oven-parity-lib.mjs";
import { storybookOwnerHint } from "./terminal-oven-parity-source.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const run = (args) => new Promise((resolve) => {
  const child = spawn(process.execPath, ["scripts/audit-terminal-oven-parity.mjs", ...args], { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", (chunk) => { output += chunk; }); child.stderr.on("data", (chunk) => { output += chunk; });
  child.on("close", (code) => resolve({ code, output }));
});

test("every renderable Storybook atom has exactly one principled owner", async () => {
  const value = await auditTerminalOvenParity(root), atoms = validateStorybookOwnership(value);
  assert.ok(atoms.length > 0);
  assert.ok(atoms.every((atom) => typeof atom.owner === "string"));
  const terminal = atoms.filter((atom) => atom.owner === "terminal-frame");
  assert.ok(terminal.length > 0);
  assert.ok(terminal.every((atom) => atom.id.includes("TerminalFrame")));
  assert.ok(atoms.filter((atom) => atom.id.includes("TerminalFrame")).every((atom) => atom.owner === "terminal-frame"));
  assert.ok(atoms.some((atom) => atom.owner.startsWith("oven:") && /oven\/|Oven|ModelLab/u.test(atom.id)));
  assert.ok(!atoms.some((atom) => atom.id.endsWith("#FILTERS")));
  assert.ok(atoms.some((atom) => atom.id.endsWith("#Filters")));
  const publicOwner = (name) => atoms.find((atom) => atom.id.endsWith(`#${name}`))?.owner;
  assert.equal(publicOwner("Button"), "general-interactive"); assert.equal(publicOwner("Checkbox"), "general-interactive");
  assert.equal(publicOwner("Badge"), "general-display"); assert.equal(publicOwner("Card"), "general-display");
  for (const name of ["LensSwitcher", "NewOvenPage", "OvenCatalog", "OvenDefinition", "OvenExplainer", "RunBurnPage"]) assert.equal(publicOwner(name), "shell-integration");
  for (const [name, owner] of [["ChecklistOvenView", "oven:checklist"], ["DifferentialTestingOvenPage", "oven:differential-testing"], ["PerformanceTracingOvenPage", "oven:performance-tracing"], ["ModelLabPage", "oven:model-lab"], ["StreamingDiff", "oven:streaming-diff"], ["VisualParityPage", "oven:visual-parity"]]) assert.equal(publicOwner(name), owner);
  const detail = atoms.filter((atom) => atom.id.includes("differential-testing-detail")), hybrid = atoms.filter((atom) => atom.id.includes("HybridFieldList"));
  assert.equal(detail.length, 8928); assert.ok(detail.every((atom) => atom.owner === "oven:differential-testing"));
  assert.equal(hybrid.length, 3); assert.ok(hybrid.every((atom) => atom.owner === "oven:differential-testing"));
  assert.ok(!atoms.some((atom) => atom.owner === "oven:runtime"));
  assert.ok(!atoms.some((atom) => /^oven:.*[A-Z]/u.test(atom.owner)));
});

test("unowned, duplicate, and out-of-scope mutations fail closed", async () => {
  const value = await auditTerminalOvenParity(root), story = value.atomicDenominator.find((atom) => atom.id.startsWith("story:"));
  const unowned = structuredClone(value); unowned.atomicDenominator.find((atom) => atom.id === story.id).owner = null;
  assert.throws(() => validateStorybookOwnership(unowned), /unowned/u);
  const duplicate = structuredClone(value); duplicate.atomicDenominator.push(structuredClone(story));
  assert.throws(() => validateStorybookOwnership(duplicate), /duplicate/u);
  const leaked = structuredClone(value), other = leaked.atomicDenominator.find((atom) => atom.id.startsWith("story:") && atom.owner !== "terminal-frame");
  leaked.terminal.registry.covered = [other.id];
  assert.throws(() => validateStorybookOwnership(leaked, "terminal-frame"), /out-of-scope/u);
  assert.throws(() => validateTerminalParity(unowned), /unowned/u);
  assert.throws(() => validateTerminalParity(duplicate), /duplicate|incomplete source mapping/u);
  const malformed = structuredClone(value); malformed.atomicDenominator.find((atom) => atom.id === story.id).owner = "malformed";
  assert.throws(() => validateTerminalParity(malformed), /unowned/u);
  for (const owner of ["oven:", "oven:Bad", "oven:not-an-official-oven"]) {
    const invented = structuredClone(value); invented.atomicDenominator.find((atom) => atom.id === story.id).owner = owner;
    assert.throws(() => validateTerminalParity(invented), /unowned|non-source-derived/u);
  }
});

test("storybook CLI accepts reordered valid flags and rejects malformed combinations", async () => {
  assert.equal((await run(["--actions", "--scope=general", "--storybook", "--states"])).code, 0);
  assert.notEqual((await run(["--storybook", "--unknown"])).code, 0);
  assert.notEqual((await run(["--storybook", "--scope=general-display", "--scope=oven-family"])).code, 0);
  assert.notEqual((await run(["--storybook", "--scope=unknown"])).code, 0);
  assert.notEqual((await run(["--storybook", "--scope=oven:missing"])).code, 0);
  assert.notEqual((await run(["--storybook", "--scope="])).code, 0);
  assert.notEqual((await run(["--storybook", "--scope=general-display", "--actions"])).code, 0);
  assert.notEqual((await run(["--states"])).code, 0);
  assert.notEqual((await run(["--storybook", "--states", "--states"])).code, 0);
  assert.notEqual((await run(["--storybook", "--scope=terminal-frame", "--states"])).code, 0);
});

test("supporting exports cannot become render obligations or false coverage", async () => {
  const base = validateTerminalParity(await auditTerminalOvenParity(root));
  const supporting = base.denominatorB.publicExports.find((row) => row.classification !== "react-component");
  assert.equal(supporting.mappingStatus, "supporting"); assert.equal(supporting.atomCoverage.status, "supporting");
  const utilityGap = structuredClone(base), gap = utilityGap.denominatorB.publicExports.find((row) => row.id === supporting.id); gap.mappingStatus = "gap"; gap.atomCoverage.status = "gap";
  assert.throws(() => validateTerminalParity(utilityGap), /supporting|incomplete source mapping/u);
  const utilityImplemented = structuredClone(base), falseCoverage = utilityImplemented.denominatorB.publicExports.find((row) => row.id === supporting.id); falseCoverage.mappingStatus = "implemented"; falseCoverage.atomCoverage.status = "implemented";
  assert.throws(() => validateTerminalParity(utilityImplemented), /supporting/u);
  const utilityAtom = structuredClone(base); utilityAtom.atomicDenominator.push({ id: `${supporting.id}:fake`, rowId: supporting.id, mappingStatus: "gap" });
  assert.throws(() => validateTerminalParity(utilityAtom), /supporting|incomplete source mapping|unowned/u);
  const component = structuredClone(base), renderable = component.denominatorB.publicExports.find((row) => row.classification === "react-component"); renderable.mappingStatus = "supporting"; renderable.atomCoverage.status = "supporting";
  assert.throws(() => validateTerminalParity(component), /atomic row coverage|incomplete source mapping/u);
});

test("source-owned Storybook hints are literal, valid, and directory-consistent", () => {
  const source = (value) => `const meta={parameters:{terminalParityOwner:${value}}};`;
  assert.equal(storybookOwnerHint(source('"oven:new-family"')), "oven:new-family");
  assert.throws(() => storybookOwnerHint(source("OWNER")), /string literal/u);
  assert.throws(() => storybookOwnerHint(source('"oven:Bad"')), /invalid/u);
  assert.throws(() => storyDirectoryOwners([{ path: "dashboard/src/oven/New/a.stories.tsx", ownerHint: "oven:a" }, { path: "dashboard/src/oven/New/b.stories.tsx", ownerHint: "oven:b" }]), /conflicting/u);
});
