#!/usr/bin/env node
import { join } from "node:path";
import { createServer, request } from "node:http";
import { visualParityFixture } from "../dashboard/src/components/VisualParity/VisualParity.fixture.mjs";
import { MODEL_LAB_SCHEMA } from "../ovens/model-lab/engine/model-lab-contract.mjs";
import { publishOvenDataPublishedEvent } from "../src/events/oven-data-events.mjs";
import { withServer } from "../src/server/dashboard-routes-fixtures.mjs";
import { publishOvenData } from "../src/server/oven-data-store.mjs";
import { repoKey } from "../src/server/registry.mjs";

function modelLabPayload(version = 1) {
  return {
    schema: MODEL_LAB_SCHEMA,
    generatedAt: `2026-07-22T13:0${version}:00.000Z`,
    project: { id: "fixture-project", label: version === 1 ? "Canonical Fixture" : `Canonical Fixture v${version}` },
    surface: { title: `Canonical Model Lab v${version}`, url: "http://127.0.0.1/model-lab" },
    model: {
      id: "fixture-model",
      actor: {
        id: "fixture-actor",
        name: "Fixture Actor",
        country: "fixture",
        shirtNumber: 1,
        sourceTeamSlot: "A",
      },
      animations: [{
        id: "mc-001",
        slotId: 1,
        symbol: "FIXTURE_ANIMATION",
        firstFrameIndex: 0,
        firstFrameId: "fixture-frame-0",
        frameCount: 2,
      }],
      frameIndex: 0,
      frameId: "fixture-frame-0",
      frameCount: 2,
      polygonCount: 13,
      leafCount: 13,
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
}

function startEvidenceProxy(targetBaseUrl, repoRoot) {
  const target = new URL(targetBaseUrl);
  const entries = [];
  const controls = [];
  const eventResponses = new Set();
  let nextId = 1;
  let controlGeneration = 0;
  const respond = (res, status, value) => {
    const body = JSON.stringify(value);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "content-length": Buffer.byteLength(body),
      "cache-control": "no-store",
    });
    res.end(body);
  };
  const recordControl = (action, run) => {
    const startedAt = new Date().toISOString();
    try {
      const result = run();
      const entry = { action, startedAt, completedAt: new Date().toISOString(), ok: true, result };
      controls.push(entry);
      return entry;
    } catch (error) {
      const entry = { action, startedAt, completedAt: new Date().toISOString(), ok: false, error: error.message };
      controls.push(entry);
      return entry;
    }
  };
  const timestamp = () => new Date(Date.now() + (++controlGeneration * 1_000)).toISOString();
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://evidence.local");
    if (url.pathname === "/__evidence") {
      respond(res, 200, { entries, controls, activeEventStreams: eventResponses.size });
      return;
    }
    if (req.method === "POST" && url.pathname.startsWith("/__control/")) {
      const action = url.pathname.slice("/__control/".length);
      const control = recordControl(action, () => {
        if (/^publish-model-v[24]$/u.test(action)) {
          const version = Number(action.at(-1));
          const publication = publishOvenData(repoRoot, "model-lab", JSON.stringify(modelLabPayload(version)), timestamp());
          return { version, changed: publication.changed, cursor: publication.cursor, eventId: publication.event?.event?.eventId ?? null };
        }
        if (action === "publish-unchanged-event") {
          const publication = publishOvenDataPublishedEvent(repoRoot, {
            ovenId: "model-lab",
            subjectId: "model-lab",
            cursor: `browser-unchanged-${controlGeneration + 1}`,
            occurredAt: timestamp(),
            payload: {},
          });
          return { eventId: publication.event.eventId, sequence: publication.event.sequence };
        }
        if (action === "manual-model-v3") {
          const publication = publishOvenData(repoRoot, "model-lab", JSON.stringify(modelLabPayload(3)), timestamp(), {
            publishDataEvent() { throw new Error("injected observational publication failure"); },
          });
          return { version: 3, changed: publication.changed, eventPublished: publication.event !== null };
        }
        if (action === "disconnect-events") {
          const disconnected = eventResponses.size;
          for (const response of eventResponses) response.destroy();
          return { disconnected };
        }
        throw Object.assign(new Error(`Unknown evidence control: ${action}`), { status: 404 });
      });
      respond(res, control.ok ? 200 : 500, control);
      return;
    }
    const entry = {
      id: nextId,
      requestedAt: new Date().toISOString(),
      method: req.method ?? "GET",
      path: `${url.pathname}${url.search}`,
      ifNoneMatch: String(req.headers["if-none-match"] ?? ""),
      status: null,
      etag: "",
      contentLength: null,
      responseBytes: 0,
      completed: false,
      clientClosed: false,
    };
    nextId += 1;
    entries.push(entry);
    const upstream = request(new URL(entry.path, target), {
      method: entry.method,
      headers: { ...req.headers, host: target.host },
    }, (upstreamResponse) => {
      entry.status = upstreamResponse.statusCode ?? null;
      entry.etag = String(upstreamResponse.headers.etag ?? "");
      entry.contentLength = upstreamResponse.headers["content-length"] === undefined
        ? null
        : Number(upstreamResponse.headers["content-length"]);
      res.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.headers);
      const eventStream = String(upstreamResponse.headers["content-type"] ?? "").startsWith("text/event-stream");
      if (eventStream) eventResponses.add(res);
      upstreamResponse.on("data", (chunk) => {
        entry.responseBytes += Buffer.byteLength(chunk);
        if (!res.write(chunk)) upstreamResponse.pause();
      });
      res.on("drain", () => upstreamResponse.resume());
      upstreamResponse.on("end", () => {
        entry.completed = true;
        entry.completedAt = new Date().toISOString();
        res.end();
      });
      res.once("close", () => {
        eventResponses.delete(res);
        if (!entry.completed) {
          entry.clientClosed = true;
          entry.completedAt = new Date().toISOString();
          upstreamResponse.destroy();
        }
      });
    });
    upstream.on("error", (error) => {
      entry.error = error.message;
      entry.completed = true;
      entry.completedAt = new Date().toISOString();
      if (!res.headersSent) res.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      res.end("fixture proxy error");
    });
    req.on("aborted", () => upstream.destroy());
    req.pipe(upstream);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("Could not bind evidence proxy."));
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}/`,
        close: () => new Promise((done) => {
          server.close(done);
          server.closeAllConnections?.();
        }),
      });
    });
  });
}

await withServer({
  burnlists: [{ repoPath: "app", id: "browser-evidence", title: "Browser Evidence" }],
  ovenData: [{
    id: "model-lab",
    payload: modelLabPayload(),
    repoPath: "app",
    persisted: true,
    override: false,
  }, {
    id: "visual-parity",
    payload: visualParityFixture,
    repoPath: "app",
    persisted: true,
    override: false,
  }],
}, async ({ baseUrl, repoRoot }) => {
  const proxy = await startEvidenceProxy(baseUrl, repoRoot);
  try {
    const key = repoKey(repoRoot);
    process.stdout.write(`${JSON.stringify({
      baseUrl: proxy.baseUrl,
      backendUrl: baseUrl,
      evidenceUrl: new URL("/__evidence", proxy.baseUrl).href,
      repoRoot,
      dataPath: join(repoRoot, "model-lab-0.json"),
      route: `/r/${key}/o/model-lab`,
      visualParityRoute: `/r/${key}/o/visual-parity`,
      repoKey: key,
    })}\n`);
    await new Promise((resolve) => {
      process.once("SIGINT", resolve);
      process.once("SIGTERM", resolve);
    });
  } finally {
    await proxy.close();
  }
});
