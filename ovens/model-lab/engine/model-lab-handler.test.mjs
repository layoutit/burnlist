import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { MODEL_LAB_SCHEMA } from "./model-lab-contract.mjs";
import { modelLabHandler } from "./model-lab-handler.mjs";

function payload() {
  return {
    schema: MODEL_LAB_SCHEMA,
    generatedAt: "2026-07-18T12:00:00.000Z",
    project: { id: "cssoccer", label: "css.soccer" },
    surface: { title: "Player Model Lab", url: "http://127.0.0.1:5173/model-lab.html" },
    model: {
      id: "actor-player-f2",
      actor: {
        id: "argentina-player-10", name: "G. Batistuta", country: "argentina",
        shirtNumber: 10, sourceTeamSlot: "B",
      },
      animations: [{
        id: "mc-122", slotId: 122, symbol: "MC_122", firstFrameIndex: 0,
        firstFrameId: "mc-122-f-000", frameCount: 2,
      }],
      frameIndex: 1,
      frameId: "mc-122-f-001",
      frameCount: 2,
      polygonCount: 13,
      leafCount: 13,
      leafTag: "s",
      topologyMode: "stable-frame-set",
      lodCount: 1,
      droppedSourcePolygonCount: 1,
      topologyHash: "a".repeat(64),
      frameSetHash: "b".repeat(64),
      runtimeConstruction: {
        assetBuildCount: 0, geometryBuildCount: 0, materialBuildCount: 0,
        sourceParseCount: 0, topologyBuildCount: 0,
      },
    },
    evidence: {
      manifestSha256: "c".repeat(64),
      renderPublicationSha256: "d".repeat(64),
      prepareInputsSha256: "e".repeat(64),
    },
  };
}

class ResponseRecorder extends EventEmitter {
  constructor() {
    super();
    this.status = null;
    this.headers = null;
    this.chunks = [];
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  write(chunk) {
    this.chunks.push(Buffer.from(chunk));
    return true;
  }

  end() {
    this.emit("finish");
  }
}

function context(path, cache, bindings, etag) {
  const req = new EventEmitter();
  req.headers = etag ? { "if-none-match": etag } : {};
  return {
    bindingPath: path,
    cache,
    maxOvenDataBytes: 1024 * 1024,
    ovenDataBindings: bindings,
    discoveredRepos: () => [],
    req,
    res: new ResponseRecorder(),
  };
}

test("Model Lab shares validated snapshots between its data route and dashboard summary", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-model-lab-handler-"));
  const path = join(root, "model-lab.json");
  const cache = new Map();
  const bindings = new Map([["model-lab", [{ path, repoKey: null, repoRoot: root }]]]);
  try {
    await writeFile(path, JSON.stringify(payload()));
    const initial = context(path, cache, bindings);
    modelLabHandler.serveData(initial);
    assert.equal(initial.res.status, 200);
    assert.equal(JSON.parse(Buffer.concat(initial.res.chunks)).validated, true);
    assert.match(initial.res.headers.etag, /^W\/"oven-json-[a-f0-9]{64}"$/u);

    const unchanged = context(path, cache, bindings, initial.res.headers.etag);
    modelLabHandler.serveData(unchanged);
    assert.equal(unchanged.res.status, 304);
    assert.equal(unchanged.res.chunks.length, 0);

    const [entry] = modelLabHandler.dashboardEntries(context(path, cache, bindings));
    assert.equal(entry.title, "Player Model Lab");
    assert.equal(entry.statusLabel, "Inspect");
    assert.equal(entry.progressLabel, "13 <s> leaves · no LOD");
    assert.equal(entry.done, 12);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Model Lab rejects invalid, missing, and over-limit bindings", async () => {
  const root = await mkdtemp(join(tmpdir(), "burnlist-model-lab-errors-"));
  const path = join(root, "model-lab.json");
  const cache = new Map();
  const bindings = new Map([["model-lab", [{ path, repoKey: null, repoRoot: root }]]]);
  try {
    await writeFile(path, "{}");
    assert.throws(() => modelLabHandler.serveData(context(path, cache, bindings)), /must use/u);

    await rm(path);
    assert.throws(
      () => modelLabHandler.serveData(context(path, cache, bindings)),
      (error) => error.status === 404 && /data is missing/u.test(error.message),
    );

    await writeFile(path, JSON.stringify(payload()));
    const limited = context(path, cache, bindings);
    limited.maxOvenDataBytes = 32;
    assert.throws(() => modelLabHandler.serveData(limited), /over the 32 byte limit/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
