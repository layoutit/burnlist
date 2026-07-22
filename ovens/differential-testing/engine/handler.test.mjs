import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createOvenJsonSnapshotStore } from "../../../src/server/oven-json-snapshot.mjs";
import { buildPayload } from "../example/adapter.mjs";
import { differentialTestingHandler } from "./handler.mjs";

class FakeResponse extends EventEmitter {
  constructor(block = false) {
    super();
    this.block = block;
    this.status = null;
    this.headers = null;
    this.destroyed = false;
  }

  writeHead(status, headers) { this.status = status; this.headers = headers; }
  write() { const result = !this.block; this.block = false; return result; }
  end() { this.emit("finish"); }
  destroy() { this.destroyed = true; this.emit("close"); }
}

function captures() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../example");
  return ["reference.json", "candidate.json"].map((name) => JSON.parse(readFileSync(join(root, name), "utf8")));
}

function request() {
  const value = new EventEmitter();
  value.headers = {};
  return value;
}

function context(path, store, req, res) {
  return {
    id: "differential-testing",
    req,
    res,
    url: new URL("http://localhost/api/oven-data/differential-testing"),
    bindingPath: path,
    cache: new Map(),
    ovenJsonSnapshots: store,
    ovenDataBindings: new Map([["differential-testing", [{ path, repoKey: null, repoRoot: null }]]]),
    maxOvenDataBytes: 64 * 1024 * 1024,
    discoveredRepos: () => [],
  };
}

test("Differential Testing slow and aborted clients share canonical response admission", (t) => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-differential-admission-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const path = join(root, "current.json");
  writeFileSync(path, `${JSON.stringify(buildPayload(...captures()))}\n`);
  const store = createOvenJsonSnapshotStore({ maxActiveResponses: 1, maxActiveBytes: 64 * 1024 * 1024 });

  const firstReq = request();
  const firstRes = new FakeResponse(true);
  differentialTestingHandler.serveData(context(path, store, firstReq, firstRes));
  assert.equal(firstRes.status, 200);
  assert.equal(store.stats().activeResponses, 1);

  const rejectedRes = new FakeResponse();
  differentialTestingHandler.serveData(context(path, store, request(), rejectedRes));
  assert.equal(rejectedRes.status, 503);
  assert.equal(rejectedRes.headers["retry-after"], "1");

  firstReq.emit("aborted");
  assert.equal(firstRes.destroyed, true);
  assert.equal(store.stats().activeResponses, 0);

  const recoveredRes = new FakeResponse();
  differentialTestingHandler.serveData(context(path, store, request(), recoveredRes));
  assert.equal(recoveredRes.status, 200);
  assert.equal(store.stats().activeResponses, 0);
});
