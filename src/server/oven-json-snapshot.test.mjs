import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import {
  mkdtempSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { readTextFileWithIdentity } from "./fs-safe.mjs";
import {
  createOvenJsonSnapshotStore,
  ifNoneMatchMatches,
  readStableJsonSource,
} from "./oven-json-snapshot.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-json-snapshot-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value)}\n`);
}

function fileIdentity(path) {
  const stat = statSync(path);
  return {
    dev: stat.dev,
    ino: stat.ino,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
}

function readOptions(path, overrides = {}) {
  return {
    path,
    label: "Fixture data",
    maxSourceBytes: 1_024,
    validate(value) {
      assert.equal(typeof value.version, "number");
    },
    ...overrides,
  };
}

class FakeResponse extends EventEmitter {
  constructor(writeResults = []) {
    super();
    this.writeResults = [...writeResults];
    this.chunks = [];
    this.status = null;
    this.headers = null;
    this.destroyed = false;
    this.ended = false;
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  write(chunk) {
    this.chunks.push(Buffer.from(chunk));
    return this.writeResults.length ? this.writeResults.shift() : true;
  }

  end() {
    this.ended = true;
    this.emit("finish");
  }

  destroy() {
    this.destroyed = true;
    this.emit("close");
  }
}

function request(etag) {
  const req = new EventEmitter();
  req.headers = etag ? { "if-none-match": etag } : {};
  return req;
}

test("stable reads retry an atomic replacement and return one complete version", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  const replacement = join(root, "replacement.json");
  writeJson(path, { version: 1 });
  writeJson(replacement, { version: 2 });
  let reads = 0;

  const stable = readStableJsonSource(path, 1_024, "Fixture data", {
    readSource(...args) {
      const result = readTextFileWithIdentity(...args);
      if (reads++ === 0) renameSync(replacement, path);
      return result;
    },
  });

  assert.equal(JSON.parse(stable.text).version, 2);
  assert.equal(reads, 2);
});

test("stable reads reject bytes whose descriptor belongs to another file", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  const other = join(root, "other.json");
  const expected = JSON.stringify({ version: 1 });
  const mismatched = JSON.stringify({ version: 2 });
  writeFileSync(path, expected);
  writeFileSync(other, mismatched);
  let reads = 0;

  const stable = readStableJsonSource(path, 1_024, "Fixture data", {
    readSource() {
      reads += 1;
      return reads === 1
        ? { text: mismatched, identity: fileIdentity(other) }
        : { text: expected, identity: fileIdentity(path) };
    },
  });

  assert.equal(reads, 2);
  assert.equal(stable.text, expected);
});

test("cache hits skip reparsing, while freshness changes revalidate dependencies", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  writeJson(path, { version: 1 });
  const store = createOvenJsonSnapshotStore();
  let validations = 0;
  const options = readOptions(path, {
    freshnessKey: "dependency-a",
    validate() { validations += 1; },
  });

  const first = store.read(options);
  assert.equal(store.read(options), first);
  assert.equal(validations, 1);
  const changed = store.read({ ...options, freshnessKey: "dependency-b" });
  assert.notEqual(changed, first);
  assert.equal(validations, 2);

  assert.throws(() => store.read({
    ...options,
    freshnessKey: "dependency-c",
    validate() { throw new Error("stale dependency"); },
  }), /stale dependency/u);
  assert.equal(store.stats().entries, 0);
});

test("an atomic file replacement retires the cached snapshot", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  const replacement = join(root, "next.json");
  writeJson(path, { version: 1 });
  writeJson(replacement, { version: 2 });
  const store = createOvenJsonSnapshotStore();

  const first = store.read(readOptions(path));
  renameSync(replacement, path);
  const second = store.read(readOptions(path));
  assert.equal(first.payload.version, 1);
  assert.equal(second.payload.version, 2);
  assert.notEqual(second.signature, first.signature);
});

test("bounded LRU eviction and active-binding reconciliation retire snapshots", (t) => {
  const root = fixture(t);
  const [one, two, three] = ["one", "two", "three"].map((name, index) => {
    const path = join(root, `${name}.json`);
    writeJson(path, { version: index + 1 });
    return path;
  });
  const store = createOvenJsonSnapshotStore({ maxEntries: 2, maxCacheBytes: 1_024 });

  store.read(readOptions(one));
  store.read(readOptions(two));
  store.read(readOptions(one));
  const third = store.read(readOptions(three));
  assert.equal(store.invalidate(two), false);
  assert.equal(store.stats().entries, 2);
  store.reconcile([three]);
  assert.deepEqual(store.stats(), {
    entries: 1, cacheBytes: third.costBytes, activeResponses: 0, activeBytes: 0,
  });
  assert.equal(store.invalidate(one), false);
  assert.equal(store.invalidate(three), true);
});

test("byte limits omit oversized entries and source limits reject oversized files", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  writeJson(path, { version: 1, detail: "large" });
  const store = createOvenJsonSnapshotStore({ maxCacheBytes: 8 });

  const snapshot = store.read(readOptions(path));
  assert.equal(snapshot.payload.version, 1);
  assert.equal(store.stats().entries, 0);
  assert.throws(() => store.read(readOptions(path, { maxSourceBytes: 4 })), /over the 4 byte limit/u);
  assert.equal(store.read(readOptions(path, { cache: false })).payload.version, 1);
  assert.equal(store.stats().entries, 0);
});

test("an exact configured maximum snapshot streams while one extra byte is rejected", (t) => {
  const root = fixture(t);
  const path = join(root, "maximum.json");
  const maxSourceBytes = 128 * 1024;
  const shell = JSON.stringify({ version: 1, detail: "" });
  const source = JSON.stringify({
    version: 1,
    detail: "x".repeat(maxSourceBytes - Buffer.byteLength(shell)),
  });
  assert.equal(Buffer.byteLength(source), maxSourceBytes);
  writeFileSync(path, source);
  const store = createOvenJsonSnapshotStore({ maxCacheBytes: maxSourceBytes * 3 });
  const options = readOptions(path, { maxSourceBytes });
  const snapshot = store.read(options);
  const res = new FakeResponse();

  assert.equal(snapshot.sourceBytes, maxSourceBytes);
  assert.equal(store.serve({
    req: request(), res, snapshot, envelope: { id: "maximum" }, chunkBytes: 4_096,
  }).status, 200);
  assert.equal(Number(res.headers["content-length"]), Buffer.concat(res.chunks).length);
  assert.ok(res.chunks.every((chunk) => chunk.length <= 4_096));

  store.invalidate(path);
  writeFileSync(path, `${source} `);
  assert.throws(() => store.read(options), /over the 131072 byte limit/u);
});

test("response ETags produce 304 without reparsing canonical data", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  writeJson(path, { version: 1 });
  const store = createOvenJsonSnapshotStore();
  let validations = 0;
  const options = readOptions(path, { validate() { validations += 1; } });
  const snapshot = store.read(options);
  const first = new FakeResponse();

  const served = store.serve({
    req: request(),
    res: first,
    snapshot,
    envelope: { id: "fixture", source: "canonical" },
  });
  assert.equal(served.status, 200);
  assert.equal(first.status, 200);
  assert.equal(first.headers["content-length"], Buffer.concat(first.chunks).length);
  assert.deepEqual(JSON.parse(Buffer.concat(first.chunks).toString()), {
    id: "fixture", source: "canonical", payload: { version: 1 },
  });

  const cached = store.read(options);
  const second = new FakeResponse();
  const notModified = store.serve({
    req: request(served.etag),
    res: second,
    snapshot: cached,
    envelope: { id: "fixture", source: "canonical" },
  });
  assert.equal(notModified.status, 304);
  assert.equal(second.status, 304);
  assert.equal(second.chunks.length, 0);
  assert.equal(validations, 1);
  assert.equal(ifNoneMatchMatches(`"other", ${served.etag}`, served.etag), true);
  assert.equal(ifNoneMatchMatches("*", served.etag), true);
});

test("active response budgets reject excess clients and recover after drain", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  writeJson(path, { version: 1 });
  const store = createOvenJsonSnapshotStore({ maxActiveResponses: 1, maxActiveBytes: 1_024 });
  const snapshot = store.read(readOptions(path));
  const envelope = { id: "fixture" };
  const first = new FakeResponse([false]);
  const firstReq = request();

  assert.equal(store.serve({ req: firstReq, res: first, snapshot, envelope }).status, 200);
  assert.equal(store.stats().activeResponses, 1);
  const rejected = new FakeResponse();
  assert.equal(store.serve({ req: request(), res: rejected, snapshot, envelope }).status, 503);
  assert.equal(rejected.status, 503);
  assert.equal(rejected.headers["retry-after"], "1");

  first.emit("drain");
  assert.equal(first.ended, true);
  assert.equal(store.stats().activeResponses, 0);
  const recovered = new FakeResponse();
  assert.equal(store.serve({ req: request(), res: recovered, snapshot, envelope }).status, 200);
  assert.equal(recovered.status, 200);
  assert.equal(store.stats().activeResponses, 0);
});

test("a response larger than the active byte budget fails before streaming", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  writeJson(path, { version: 1 });
  const store = createOvenJsonSnapshotStore({ maxActiveBytes: 1 });
  const snapshot = store.read(readOptions(path));
  const res = new FakeResponse();
  assert.equal(store.serve({
    req: request(), res, snapshot, envelope: { id: "fixture" },
  }).status, 503);
  assert.equal(res.chunks.length, 0);
  assert.equal(store.stats().activeResponses, 0);
});

test("serialized projections share exact byte admission without cloning their source", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  writeJson(path, { version: 1 });
  const builder = createOvenJsonSnapshotStore();
  const snapshot = builder.read(readOptions(path));
  const projection = builder.serializeProjection(snapshot, { version: 1, detail: "projected" });
  const representation = builder.response(projection, { id: "projected" }, { etag: 'W/"projected-v1"' });
  assert.equal(representation.source, projection.source);
  assert.equal(projection.canonicalSourceDigest, snapshot.sourceDigest);

  const store = createOvenJsonSnapshotStore({
    maxActiveResponses: 2,
    maxActiveBytes: representation.responseBytes,
  });
  const firstReq = request();
  const first = new FakeResponse([false]);
  assert.equal(store.serveResponse({ req: firstReq, res: first, representation }).status, 200);
  assert.equal(store.stats().activeBytes, representation.responseBytes);

  const rejected = new FakeResponse();
  assert.equal(store.serveResponse({ req: request(), res: rejected, representation }).status, 503);
  firstReq.emit("aborted");
  assert.equal(store.stats().activeBytes, 0);

  const unchanged = new FakeResponse();
  assert.equal(store.serveResponse({
    req: request('W/"projected-v1"'), res: unchanged, representation,
  }).status, 304);
  assert.equal(unchanged.chunks.length, 0);
});

test("response envelopes cannot shadow the canonical payload", (t) => {
  const root = fixture(t);
  const path = join(root, "data.json");
  writeJson(path, { version: 1 });
  const store = createOvenJsonSnapshotStore();
  const snapshot = store.read(readOptions(path));
  assert.throws(() => store.response(snapshot, { payload: "shadow" }), /without payload/u);
  assert.throws(() => store.response(snapshot, []), /must be an object/u);
});
