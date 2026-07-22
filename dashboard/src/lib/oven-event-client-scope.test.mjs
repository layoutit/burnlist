import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { encodeOvenEventReplayCursor } from "../../../src/events/oven-event-feed.mjs";
import { createOvenEventObserver } from "../../../src/events/oven-event-observer.mjs";
import { publishOvenEvent } from "../../../src/events/oven-event-store.mjs";
import { createOvenSnapshotClient } from "./oven-event-client.mjs";

const settle = () => new Promise((resolve) => setImmediate(resolve));

function response(body) {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    async json() { return body; },
  };
}

function timers() {
  return {
    setInterval() { return { unref() {} }; },
    clearInterval() {},
    setTimeout() { return { unref() {} }; },
    clearTimeout() {},
  };
}

class FakeEventSource {
  constructor(url) {
    this.url = url;
    this.closed = false;
    this.listeners = new Map();
  }

  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type) { this.listeners.delete(type); }
  close() { this.closed = true; }
}

function descriptor(ovenId) {
  return {
    repoKey: "aaaaaaaaaaaa",
    ovenId,
    subjectId: "subject-a",
    url: `/api/oven-data/${ovenId}?repoKey=aaaaaaaaaaaa`,
    receive(res, json) { if (!res.ok) throw new Error("invalid"); return json.payload; },
  };
}

test("one mounted Oven remains live after more than 64 historical streams", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-browser-scoped-events-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = { root, repoKey: "aaaaaaaaaaaa", name: "fixture" };
  for (let index = 0; index < 64; index += 1) {
    publishOvenEvent(root, {
      ovenId: `historical-${index}`,
      subjectId: "subject-a",
      kind: "iteration",
      phase: "complete",
      cursor: `historical-${index}`,
      occurredAt: "2026-07-22T12:00:00.000Z",
      payload: {},
    });
  }
  publishOvenEvent(root, {
    ovenId: "visual-parity",
    subjectId: "subject-a",
    kind: "iteration",
    phase: "complete",
    cursor: "visual-parity",
    occurredAt: "2026-07-22T12:00:01.000Z",
    payload: {},
  });

  const observer = createOvenEventObserver({ resolveRepos: () => [repo], timers: timers() });
  assert.throws(
    () => observer.baseline({ repos: [repo], ovenIds: [] }),
    (error) => error.status === 413 || error.code === "ESTREAMLIMIT",
  );

  const baselineUrls = [];
  const sources = [];
  const client = createOvenSnapshotClient({
    timers: timers(),
    focusTarget: null,
    eventSourceFactory(url) {
      const source = new FakeEventSource(url);
      sources.push(source);
      return source;
    },
    async fetchImpl(url) {
      const parsed = new URL(url, "http://burnlist.test");
      if (parsed.searchParams.get("tail") === "1") {
        baselineUrls.push(parsed);
        const selection = {
          repos: parsed.searchParams.getAll("repoKey").map((key) => {
            assert.equal(key, repo.repoKey);
            return repo;
          }),
          ovenIds: parsed.searchParams.getAll("ovenId"),
        };
        const baseline = observer.baseline(selection);
        return response({ cursor: encodeOvenEventReplayCursor(baseline.watermarks) });
      }
      return response({ payload: { url } });
    },
  });

  client.start();
  await settle();
  assert.equal(baselineUrls.length, 0, "the shell does not open an unfiltered feed");

  const visual = client.subscribe(descriptor("visual-parity"), () => {});
  await settle();
  assert.equal(sources.length, 1);
  assert.deepEqual(baselineUrls[0].searchParams.getAll("ovenId"), ["visual-parity"]);
  assert.deepEqual(baselineUrls[0].searchParams.getAll("repoKey"), [repo.repoKey]);

  const performance = client.subscribe(descriptor("performance-tracing"), () => {});
  await settle();
  assert.equal(sources[0].closed, true, "a changed mounted scope reconnects the singleton");
  assert.equal(sources.length, 2);
  const next = new URL(sources[1].url, "http://burnlist.test");
  assert.deepEqual(next.searchParams.getAll("ovenId"), ["performance-tracing", "visual-parity"]);

  performance.unsubscribe();
  await settle();
  assert.equal(sources[1].closed, true);
  assert.equal(sources.length, 3);
  visual.unsubscribe();
  assert.equal(sources[2].closed, true, "the final unmount closes the live feed");
  client.stop();
  observer.close();
});
