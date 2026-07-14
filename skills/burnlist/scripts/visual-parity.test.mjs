import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
  differentialExactPrefixFrameDeltaMetrics,
  startDifferentialTestingLiveUpdates,
} from "../dashboard/differential-testing-renderer.js";
import { renderVisualParityComparison } from "../dashboard/visual-parity-renderer.js";
import { buildPayload } from "../examples/differential-testing/adapter.mjs";
import {
  assertVisualParityData,
  visualParityDeltaChartMetrics,
  VISUAL_PARITY_SCHEMA,
} from "./visual-parity-contract.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const serverPath = resolve(scriptDirectory, "burnlist-dashboard-server.mjs");
const differentialTestingRendererPath = resolve(scriptDirectory, "../dashboard/differential-testing-renderer.js");
const visualParityPagePath = resolve(scriptDirectory, "../dashboard/src/visual-parity.tsx");
const visualParityCssPath = resolve(scriptDirectory, "../dashboard/visual-parity.css");
const pixel = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function fixture({ status = "fail" } = {}) {
  const frameCount = status === "pass" ? 1 : 1_000;
  const reference = {
    captureId: "visual-reference",
    generatedAt: "2026-07-14T12:00:00.000Z",
    fields: [{
      id: "pixel-difference",
      label: "Pixel difference",
      sourceOwner: "visual-comparator",
      meaning: "Changed-pixel count for the aligned screenshot pair",
      unit: "pixels",
      tolerance: 0,
    }],
    samples: Array.from({ length: frameCount }, (_, tick) => ({ tick, values: { "pixel-difference": 0 } })),
  };
  const candidate = {
    captureId: "visual-candidate",
    generatedAt: reference.generatedAt,
    samples: Array.from({ length: frameCount }, (_, tick) => ({ tick, values: { "pixel-difference": status === "pass" ? 0 : 1 } })),
  };
  const differentialTesting = buildPayload(reference, candidate);
  differentialTesting.title = "Visual Parity";
  for (const row of [...differentialTesting.progress, ...differentialTesting.log]) {
    row.frame = status === "pass" ? frameCount : 0;
    row.frameDelta = null;
  }
  return {
    schema: VISUAL_PARITY_SCHEMA,
    differentialTesting,
    comparisons: Array.from({ length: frameCount }, (_, frame) => {
      const captured = frame % 100 === 0 && frame < 1_000;
      return {
        id: `frame-${frame}`,
        label: `Frame ${frame}`,
        frame,
        status,
        reference: { label: "Native", src: captured ? pixel : null, width: 1, height: 1 },
        candidate: { label: "Browser", src: captured ? pixel : null, width: 1, height: 1 },
        diff: { label: "Changed pixels", src: captured ? pixel : null, width: 1, height: 1 },
        difference: status === "pass"
          ? { changedPixels: 0, totalPixels: 1, ratio: 0, meanAbsoluteDelta: 0, maximumAbsoluteDelta: 0 }
          : { changedPixels: 1, totalPixels: 1, ratio: 1, meanAbsoluteDelta: 1, maximumAbsoluteDelta: 1 },
      };
    }),
  };
}

test("Visual Parity validates all frame deltas and one screenshot triplet every 100 frames", () => {
  const payload = fixture();
  assert.equal(assertVisualParityData(payload), payload);
  assert.equal(payload.schema, "burnlist-visual-parity-data@1");

  const mismatched = structuredClone(payload);
  mismatched.comparisons[0].diff.width = 2;
  assert.throws(() => assertVisualParityData(mismatched), /identical dimensions/u);

  const inconsistent = structuredClone(payload);
  inconsistent.comparisons[0].difference.ratio = 0.5;
  assert.throws(() => assertVisualParityData(inconsistent), /must equal changedPixels/u);

  const skipped = structuredClone(payload);
  skipped.comparisons[0].reference.src = null;
  skipped.comparisons[0].candidate.src = null;
  skipped.comparisons[0].diff.src = null;
  assert.throws(() => assertVisualParityData(skipped), /every 100 frames/u);

  const independent = fixture({ status: "pass" });
  assert.equal(assertVisualParityData(independent), independent);
});

test("Visual Parity maps its recorded frame deltas into the shared Delta chart contract", () => {
  const payload = fixture();
  const metrics = visualParityDeltaChartMetrics(payload.comparisons);
  assert.equal(metrics.frameDeviationRatios.length, 1_000);
  assert.equal(metrics.frameSignedResiduals.length, 1_000);
  assert.deepEqual(metrics.frameDeviationRatios.slice(0, 2), [1, 1]);
  assert.deepEqual(metrics.frameSignedResiduals.slice(0, 2), [1, 1]);
  assert.equal(metrics.firstFailingFrame, 0);
  assert.match(metrics.ariaLabel, /Mean absolute RGB channel delta/u);
  assert.equal(differentialExactPrefixFrameDeltaMetrics(payload.differentialTesting, metrics)?.frameSignedResiduals.length, 1_000);
});

test("Visual Parity renders 10 scenario-wide samples as shared field-list cards", () => {
  const payload = fixture();
  const html = renderVisualParityComparison({ payload: { visualParity: payload } });
  assert.match(html, /hybrid-list visual-parity-frame-list/u);
  assert.equal((html.match(/hybrid-row fail expanded visual-parity-frame-card/gu) ?? []).length, 10);
  assert.doesNotMatch(html, /<figcaption>/u);
  assert.equal((html.match(/<img /gu) ?? []).length, 30);
  assert.match(html, /Frame 0/u);
  assert.match(html, /Frame 900/u);
  assert.match(html, />1 mean<\/span><span class="hybrid-value-delta">1 max<\/span>/u);
  assert.doesNotMatch(html, /mean ·/u);
  assert.doesNotMatch(html, /data-frame="1"/u);
});

test("Visual Parity carries the shared expanded field-list card layout after detail injection", async () => {
  const css = await readFile(visualParityCssPath, "utf8");
  const page = await readFile(visualParityPagePath, "utf8");
  const renderer = await readFile(differentialTestingRendererPath, "utf8");
  assert.match(page, /initialProgressChart:\s*"delta"/u);
  assert.match(renderer, /grid-template-columns:\s*20% 10% minmax\(0, 70%\);/u);
  assert.match(renderer, /\.hybrid-row\.expanded\s*\{[\s\S]*?height:\s*220px;/u);
  assert.doesNotMatch(css, /\.visual-parity-frame-card \.hybrid-metric/u);
  assert.doesNotMatch(css, /\.visual-parity-frame-card \.hybrid-count/u);
  assert.match(css, /\.visual-parity-frame-card\.hybrid-row\.expanded\s*\{[\s\S]*?height:\s*auto;/u);
  assert.doesNotMatch(css, /\.visual-parity-frame-card\.hybrid-row\.expanded\s*\{[^}]*grid-template-columns/u);
  assert.match(css, /\.visual-parity-shot\s*\{[\s\S]*?border:\s*0;/u);
  assert.doesNotMatch(css, /\.visual-parity-shot figcaption/u);
  assert.match(css, /\.visual-parity-frame-card \.hybrid-chart\s*\{[\s\S]*?aspect-ratio:\s*24 \/ 5;/u);
  assert.match(css, /\.visual-parity-shot::before\s*\{[\s\S]*?left:\s*0;[\s\S]*?width:\s*1px;[\s\S]*?background:\s*var\(--line\);/u);
  assert.match(renderer, /const detailRows = root\.querySelector\("#hybrid-rows"\);/u);
  assert.match(renderer, /detailRows\.innerHTML = detailRenderer/u);
});

test("Visual Parity binds its selected scenario through the view query", async () => {
  const payload = fixture();
  const scenarioId = payload.differentialTesting.scenarioCatalog.selectedScenarioId;
  const requests = [];
  const replacements = [];
  let mountOptions = null;
  const frameDeltaMetrics = visualParityDeltaChartMetrics(payload.comparisons);
  const controller = startDifferentialTestingLiveUpdates({ innerHTML: "" }, {
    ovenId: "visual-parity",
    ovenName: "Visual Parity",
    scenarioParam: "view",
    locationImpl: {
      search: `?view=${scenarioId}`,
      href: `http://localhost/ovens/visual-parity/view?view=${scenarioId}`,
    },
    historyImpl: { replaceState: (_state, _title, href) => replacements.push(href) },
    fetchImpl: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        async json() {
          return url === "/api/ovens/visual-parity"
            ? { oven: { detail: { cells: [] } } }
            : { payload, frameDeltaMetrics };
        },
      };
    },
    setIntervalImpl: () => 17,
    clearIntervalImpl() {},
    payloadTransform: (response) => ({
      ...response.payload.differentialTesting,
      visualParity: response.payload,
    }),
    mount: (_root, _oven, _payload, options) => {
      mountOptions = options;
      return { update() {}, setClientRefreshStatus() {} };
    },
  });

  await controller.ready;
  assert.ok(requests.includes(`/api/oven-data/visual-parity?view=${scenarioId}`));
  assert.deepEqual(mountOptions.frameDeltaMetrics, frameDeltaMetrics);
  await controller.selectScenario(scenarioId);
  assert.equal(replacements.at(-1), `/ovens/visual-parity/view?view=${scenarioId}`);
  controller.stop();
});

test("Visual Parity is exposed as a validated read-only Oven route", { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-parity-"));
  const repo = join(root, "fixture-repo");
  const payloadPath = join(repo, ".local", "visual-parity", "current.json");
  let child;
  try {
    await mkdir(dirname(payloadPath), { recursive: true });
    await writeFile(payloadPath, `${JSON.stringify(fixture())}\n`);
    const port = await availablePort();
    child = spawn(process.execPath, [
      serverPath,
      "--port", String(port),
      "--scan-root", repo,
      "--state-dir", join(root, "state"),
      "--oven-data", `visual-parity=${payloadPath}`,
    ], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    const baseUrl = await waitForServer(child);

    assert.equal((await fetch(`${baseUrl}ovens/visual-parity/view`)).status, 200);
    const dataResponse = await fetch(`${baseUrl}api/oven-data/visual-parity`);
    assert.equal(dataResponse.status, 200);
    const data = await dataResponse.json();
    assert.equal(data.payload.schema, VISUAL_PARITY_SCHEMA);
    assert.equal(data.payload.comparisons.length, 1_000);
    assert.equal(data.payload.comparisons[0].id, "frame-0");
    assert.equal(data.frameDeltaMetrics.frameSignedResiduals.length, 1_000);
    assert.equal(data.frameDeltaMetrics.firstFailingFrame, 0);
    const scenarioId = data.payload.differentialTesting.scenarioCatalog.selectedScenarioId;
    assert.equal((await fetch(`${baseUrl}api/oven-data/visual-parity?view=${scenarioId}`)).status, 200);
    assert.equal((await fetch(`${baseUrl}api/oven-data/visual-parity?view=../../etc/passwd`)).status, 400);
    assert.equal((await fetch(`${baseUrl}api/oven-data/visual-parity?view=aaaaaaaaaaaaaaaa`)).status, 404);

    const index = await (await fetch(`${baseUrl}api/burnlists`)).json();
    const row = index.burnlists.find((entry) => entry.ovenId === "visual-parity");
    assert.equal(row?.href, `/ovens/visual-parity/view?view=${scenarioId}`);
    assert.equal(row?.statusLabel, "Fail");
    assert.equal(row?.errors, 1_000);
    assert.equal(row?.title, "1000 frame deltas");

    await writeFile(payloadPath, `${JSON.stringify({ schema: "wrong" })}\n`);
    const invalid = await fetch(`${baseUrl}api/oven-data/visual-parity`);
    assert.equal(invalid.status, 422);
    assert.match((await invalid.json()).error, /schema/u);
  } finally {
    await stop(child);
    await rm(root, { recursive: true, force: true });
  }
});

function availablePort() {
  return new Promise((resolvePort, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : null;
      probe.close((error) => error ? reject(error) : resolvePort(port));
    });
  });
}

function waitForServer(child) {
  return new Promise((resolveReady, reject) => {
    let output = "";
    const timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 8_000);
    child.stdout.on("data", (chunk) => {
      output += chunk.toString();
      const match = output.match(/http:\/\/127\.0\.0\.1:\d+\//u);
      if (!match) return;
      clearTimeout(timer);
      resolveReady(match[0]);
    });
    child.stderr.on("data", (chunk) => { output += chunk.toString(); });
    child.once("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Server exited with ${code}: ${output}`));
    });
  });
}

async function stop(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise((resolveStop) => child.once("exit", resolveStop));
}
