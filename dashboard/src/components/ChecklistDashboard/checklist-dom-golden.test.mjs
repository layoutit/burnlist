import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { checklistFixture } from "./ChecklistDashboard.fixture.mjs";
import { withDeterministicTime } from "../../oven/test-support/deterministic-time.mjs";
import { runM4ProgressFixture } from "../../../../src/loops/run/run-test-fixtures.mjs";

const componentPath = new URL("./ChecklistDashboard.tsx", import.meta.url).pathname;
const normalizerPath = new URL("../../oven/test-support/dom-normalize.ts", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
const goldenPath = new URL("./checklist-dom.golden.html", import.meta.url);
const loopGoldenPath = new URL("./checklist-loop-progression.golden.json", import.meta.url);
const loopStateGoldenPath = new URL("./checklist-loop-states.golden.json", import.meta.url);
const digest = (value) => createHash("sha256").update(value).digest("hex");
const itemData = (projection) => ({
  ...checklistFixture,
  active: [{
    id: projection.itemRef.split("#").at(-1),
    title: "Loop-assigned item",
    fields: {},
    loop: { selector: `loop:builtin:${projection.loopId}` },
  }],
  loopRun: projection,
});

test("checklist detail static DOM matches the frozen byte golden", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".checklist-dom-golden-test-"));
  try {
    const componentOutput = join(outputDir, "ChecklistDashboard.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [componentPath], bundle: true, format: "esm", outfile: componentOutput, platform: "node", alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const [{ ChecklistDashboard }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${new URL(`file://${componentOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${normalizerOutput}`).href}?test=${Date.now()}`),
    ]);
    const markup = withDeterministicTime(() => renderToStaticMarkup(createElement(ChecklistDashboard, { data: checklistFixture })));
    const actual = serializeCanonical(normalize(parseHtml(markup)));
    const expected = (await readFile(goldenPath, "utf8")).replace(/\n$/u, "");
    assert.equal(actual, expected);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});

test("real M4 projections advance the full Checklist DOM through the frozen Loop progression", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".checklist-loop-golden-test-"));
  const repoRoot = await mkdtemp(join(process.cwd(), ".checklist-loop-run-"));
  try {
    const componentOutput = join(outputDir, "ChecklistDashboard.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [componentPath], bundle: true, format: "esm", outfile: componentOutput, platform: "node", alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const [{ ChecklistDashboard }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${new URL(`file://${componentOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${normalizerOutput}`).href}?test=${Date.now()}`),
    ]);
    const { snapshots } = await runM4ProgressFixture({
      repoRoot,
      outcomes: ["complete", "pass", "reject", "complete", "pass", "approve"],
    });
    const selected = [
      snapshots.find((snapshot) => snapshot.currentNode === "implement" && snapshot.attempt === 1 && snapshot.latestResult?.kind === "reject"),
      snapshots.find((snapshot) => snapshot.currentNode === "implement" && snapshot.attempt === 2 && snapshot.latestResult?.kind === "reject"),
      snapshots.find((snapshot) => snapshot.currentNode === "review" && snapshot.attempt === 2 && snapshot.latestResult?.kind === "approve"),
      snapshots.find((snapshot) => snapshot.currentNode === "converged" && snapshot.attempt === 1),
      snapshots.filter((snapshot) => snapshot.currentNode === "completed").at(-1),
    ];
    assert.equal(selected.every(Boolean), true);
    const actual = selected.map((projection) => {
      const projectionBytes = JSON.stringify({ ...projection, revision: "<canonical-revision>" });
      const markup = withDeterministicTime(() =>
        renderToStaticMarkup(createElement(ChecklistDashboard, { data: itemData(projection) })));
      const domBytes = serializeCanonical(normalize(parseHtml(markup)));
      return {
        checkpoint: `${projection.currentNode}/${projection.attempt}/${projection.latestResult?.kind ?? "none"}`,
        projectionBytes: Buffer.byteLength(projectionBytes),
        projectionSha256: digest(projectionBytes),
        domBytes: Buffer.byteLength(domBytes),
        domSha256: digest(domBytes),
      };
    });
    const expected = JSON.parse(await readFile(loopGoldenPath, "utf8"));
    assert.deepEqual(actual, expected);
  } finally {
    await Promise.all([
      rm(outputDir, { force: true, recursive: true }),
      rm(repoRoot, { force: true, recursive: true }),
    ]);
  }
});

test("terminal, paused, stale, and corrupt Loop states retain frozen full Checklist DOMs", async () => {
  const outputDir = await mkdtemp(join(process.cwd(), ".checklist-loop-state-golden-test-"));
  const repoRoot = await mkdtemp(join(process.cwd(), ".checklist-loop-state-run-"));
  try {
    const componentOutput = join(outputDir, "ChecklistDashboard.mjs");
    const normalizerOutput = join(outputDir, "dom-normalize.mjs");
    await Promise.all([
      build({ entryPoints: [componentPath], bundle: true, format: "esm", outfile: componentOutput, platform: "node", alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18" }),
      build({ entryPoints: [normalizerPath], bundle: true, format: "esm", outfile: normalizerOutput, platform: "node", target: "node18" }),
    ]);
    const [{ ChecklistDashboard }, { normalize, parseHtml, serializeCanonical }] = await Promise.all([
      import(`${new URL(`file://${componentOutput}`).href}?test=${Date.now()}`),
      import(`${new URL(`file://${normalizerOutput}`).href}?test=${Date.now()}`),
    ]);
    const { final } = await runM4ProgressFixture({ repoRoot, outcomes: ["complete", "pass", "approve"] });
    const variants = [
      ["paused", { state: "paused" }], ["failed", { state: "failed" }], ["stopped", { state: "stopped" }],
      ["needs-human", { state: "needs-human" }], ["exhausted", { state: "budget-exhausted" }],
      ["stale", { diagnostic: "stale" }], ["corrupt", { state: "corrupt" }], ["completed", { state: "converged" }],
    ];
    const actual = variants.map(([checkpoint, patch]) => {
      const markup = withDeterministicTime(() => renderToStaticMarkup(createElement(ChecklistDashboard, {
        data: itemData({ ...final, ...patch }),
      })));
      const domBytes = serializeCanonical(normalize(parseHtml(markup)));
      return { checkpoint, domBytes: Buffer.byteLength(domBytes), domSha256: digest(domBytes) };
    });
    assert.deepEqual(actual, JSON.parse(await readFile(loopStateGoldenPath, "utf8")));
  } finally {
    await Promise.all([rm(outputDir, { force: true, recursive: true }), rm(repoRoot, { force: true, recursive: true })]);
  }
});
