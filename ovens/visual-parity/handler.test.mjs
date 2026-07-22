import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { visualParityFixture } from "../../dashboard/src/components/VisualParity/VisualParity.fixture.mjs";
import { httpGet, withServer } from "../../src/server/dashboard-routes-fixtures.mjs";
import { repoKey } from "../../src/server/registry.mjs";
import { visualParityHandler } from "./handler.mjs";

function threeFramePayload() {
  const payload = structuredClone(visualParityFixture);
  const scenarioId = payload.differentialTesting.scenarioCatalog.selectedScenarioId;
  payload.differentialTesting.scenarioCatalog.scenarios[0].frameCount = 3;
  payload.differentialTesting.refresh.report.frameCount = 3;
  payload.comparisons = [0, 1, 2].map((frame) => {
    const comparison = structuredClone(visualParityFixture.comparisons[0]);
    comparison.id = `${scenarioId}-frame-${frame}`;
    comparison.label = `Fixture frame ${frame}`;
    comparison.frame = frame;
    if (frame === 2) {
      comparison.status = "fail";
      comparison.domains.cars.status = "fail";
      comparison.domains.cars.difference.maximumAbsoluteDelta = 2;
    }
    return comparison;
  });
  return payload;
}

function responseRecorder() {
  return {
    status: null,
    headers: null,
    chunks: [],
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    write(chunk) {
      this.chunks.push(String(chunk));
    },
    end(chunk = "") {
      if (chunk) this.chunks.push(String(chunk));
    },
    get body() {
      return this.chunks.join("");
    },
  };
}

function handlerContext(path, cache, headers = {}) {
  return {
    bindingPath: path,
    cache,
    maxOvenDataBytes: 1024 * 1024,
    req: { headers },
    res: responseRecorder(),
  };
}

test("Visual Parity caches one validated source and invalidates it when the file changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-visual-handler-"));
  const path = join(root, "visual-parity.json");
  const cache = new Map();
  try {
    await writeFile(path, JSON.stringify(threeFramePayload()));
    const initial = handlerContext(path, cache);
    assert.equal(visualParityHandler.serveData(initial), undefined);
    assert.equal(initial.res.status, 200);
    assert.equal(JSON.parse(initial.res.body).validated, true);
    const initialEtag = initial.res.headers.etag;
    const cached = [...cache.values()][0];

    const unchanged = handlerContext(path, cache, { "if-none-match": initialEtag });
    visualParityHandler.serveData(unchanged);
    assert.equal(unchanged.res.status, 304);
    assert.equal(unchanged.res.body, "");
    assert.equal([...cache.values()][0], cached);

    const changedPayload = threeFramePayload();
    changedPayload.comparisons[0].label = "Updated fixture frame zero";
    await writeFile(path, JSON.stringify(changedPayload));
    const changed = handlerContext(path, cache, { "if-none-match": initialEtag });
    visualParityHandler.serveData(changed);
    assert.equal(changed.res.status, 200);
    assert.notEqual(changed.res.headers.etag, initialEtag);
    assert.equal(JSON.parse(changed.res.body).payload.comparisons[0].label, "Updated fixture frame zero");
    assert.notEqual([...cache.values()][0], cached);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Visual Parity route returns 304 and keeps a rounded dashboard summary", { timeout: 20_000 }, async () => {
  await withServer({
    burnlists: [{ repoPath: "app" }],
    ovenData: [{
      id: "visual-parity",
      payload: threeFramePayload(),
      repoPath: "app",
      persisted: true,
      override: false,
    }],
  }, async ({ baseUrl, repoRoot }) => {
    const key = repoKey(repoRoot);
    const endpoint = new URL(`/api/oven-data/visual-parity?repoKey=${key}`, baseUrl);
    const initial = await fetch(endpoint);
    assert.equal(initial.status, 200);
    const etag = initial.headers.get("etag");
    assert.match(etag, /^W\/"vp-[a-f0-9]{64}"$/u);
    assert.equal((await initial.json()).validated, true);

    const unchanged = await fetch(endpoint, { headers: { "If-None-Match": etag } });
    assert.equal(unchanged.status, 304);
    assert.equal(await unchanged.text(), "");

    const rows = JSON.parse((await httpGet(baseUrl, "/api/burnlists")).body).burnlists;
    const row = rows.find((entry) => entry.ovenId === "visual-parity" && entry.repoKey === key);
    assert.ok(row);
    assert.equal(row.statusLabel, "Open");
    assert.equal(row.percent, 67);
    assert.equal(row.progressLabel, "2/3 target frames");
  });
});
