import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";

const componentPath = new URL("./ModelLab.tsx", import.meta.url).pathname;
const sourceDir = new URL("../..", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("../../oven", import.meta.url).pathname;
const shippedSourcePath = new URL("../../../../ovens/model-lab/model-lab.oven", import.meta.url);

const payload = {
  schema: "burnlist-model-lab-data@1",
  generatedAt: "2026-07-22T10:00:00Z",
  project: { id: "fixture", label: "Fixture Project" },
  surface: { title: "Fixture Model Lab", url: "http://127.0.0.1:5173/model-lab.html" },
  model: {
    id: "player-a",
    actor: { id: "actor-a", name: "Ada", country: "DE", shirtNumber: 7, sourceTeamSlot: "A" },
    animations: [{ id: "idle", slotId: 0, symbol: "idle", firstFrameIndex: 0, firstFrameId: "idle-0", frameCount: 2 }],
    frameIndex: 0,
    frameId: "idle-0",
    frameCount: 2,
    polygonCount: 12,
    leafCount: 4,
    leafTag: "s",
    topologyMode: "stable-frame-set",
    lodCount: 1,
    droppedSourcePolygonCount: 0,
    topologyHash: "a".repeat(64),
    frameSetHash: "b".repeat(64),
    runtimeConstruction: {
      assetBuildCount: 0,
      geometryBuildCount: 0,
      materialBuildCount: 0,
      sourceParseCount: 0,
      topologyBuildCount: 0,
    },
  },
  evidence: {
    manifestSha256: "c".repeat(64),
    renderPublicationSha256: "d".repeat(64),
    prepareInputsSha256: "e".repeat(64),
  },
};

async function compile(source, file) {
  const result = compileOven(source, { file });
  assert.equal(result.ok, true, result.ok ? "" : JSON.stringify(result.diagnostics));
  return result.ir;
}

async function loadComponent() {
  const outputDir = await mkdtemp(join(process.cwd(), ".model-lab-render-test-"));
  const outputPath = join(outputDir, "ModelLab.mjs");
  await build({
    entryPoints: [componentPath],
    bundle: true,
    format: "esm",
    outfile: outputPath,
    platform: "node",
    alias: { "@": sourceDir, "@lib": libPath, "@oven": ovenPath },
    jsx: "automatic",
    packages: "external",
    target: "node18",
  });
  return {
    component: await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`),
    cleanup: () => rm(outputDir, { force: true, recursive: true }),
  };
}

test("the shipped Model Lab source compiles to the closed specialized widget", async () => {
  const source = await readFile(shippedSourcePath, "utf8");
  const ir = await compile(source, shippedSourcePath.pathname);
  assert.equal(ir.root.length, 1);
  assert.equal(ir.root[0].kind, "model-lab-view");
  assert.equal(ir.root[0].attributes.source, "/");
  assert.deepEqual(ir.requirements.components, ["model-lab-view"]);
});

test("the actual Model Lab page follows its resolved IR", { timeout: 20_000 }, async () => {
  const { component, cleanup } = await loadComponent();
  try {
    const shippedIr = await compile(await readFile(shippedSourcePath, "utf8"), shippedSourcePath.pathname);
    const alternateIr = await compile(`
      <oven id="model-lab" version="0.1.0" contract="burnlist-model-lab-data@1" theme="checklist">
        <section-header title="Vendored Model Lab layout"/>
      </oven>
    `, "vendored/model-lab.oven");
    const render = (ir) => renderToStaticMarkup(createElement(component.ModelLabPageContent, {
      error: "",
      ir,
      loading: false,
      payload,
    }));

    const shipped = render(shippedIr);
    assert.match(shipped, /class="model-lab-oven"/u);
    assert.match(shipped, /Fixture Project · player-a/u);
    assert.match(shipped, /src="http:\/\/127\.0\.0\.1:5173\/model-lab\.html\?embedded=1&amp;model=player-a&amp;frame=0"/u);

    const vendored = render(alternateIr);
    assert.match(vendored, /Vendored Model Lab layout/u);
    assert.doesNotMatch(vendored, /class="model-lab-oven"/u);
    assert.doesNotMatch(vendored, /Fixture Project · player-a/u);
  } finally {
    await cleanup();
  }
});

test("Model Lab polling keeps repository scoping in its data URL", async () => {
  const { component, cleanup } = await loadComponent();
  try {
    assert.equal(component.MODEL_LAB_POLL_MS, 2_000);
    assert.equal(component.modelLabDataUrl(null), "/api/oven-data/model-lab");
    assert.equal(component.modelLabDataUrl("repo/key"), "/api/oven-data/model-lab?repoKey=repo%2Fkey");
  } finally {
    await cleanup();
  }
});
