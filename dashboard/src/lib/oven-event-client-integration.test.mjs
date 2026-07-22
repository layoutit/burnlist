import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { publishOvenData } from "../../../src/server/oven-data-store.mjs";
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

function fakeTimers() {
  const timeouts = [];
  return {
    setInterval() { return { unref() {} }; },
    clearInterval() {},
    setTimeout(callback) {
      const handle = { callback, cleared: false, unref() {} };
      timeouts.push(handle);
      return handle;
    },
    clearTimeout(handle) { handle.cleared = true; },
    flush() {
      const handle = timeouts.find((candidate) => !candidate.cleared);
      assert.ok(handle, "expected a coalesced canonical refresh");
      handle.cleared = true;
      handle.callback();
    },
  };
}

class FakeEventSource {
  constructor() { this.listeners = new Map(); }
  addEventListener(type, callback) { this.listeners.set(type, callback); }
  removeEventListener(type) { this.listeners.delete(type); }
  close() {}
  emit(type, value) { this.listeners.get(type)?.({ data: JSON.stringify(value) }); }
}

test("a real Oven-wide data publication invalidates every scenario query and resets reconcile canonically", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-browser-real-event-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const publication = publishOvenData(
    root,
    "visual-parity",
    '{"version":2}\n',
    "2026-07-22T12:00:00.000Z",
  ).event.event;
  assert.equal(publication.subjectId, "visual-parity", "the producer emits the Oven subject, not a scenario");

  const timers = fakeTimers();
  const source = new FakeEventSource();
  let snapshotRequests = 0;
  const client = createOvenSnapshotClient({
    timers,
    focusTarget: null,
    eventSourceFactory: () => source,
    async fetchImpl(url) {
      if (url === "/api/events?tail=1") return response({ cursor: "oev1-current" });
      snapshotRequests += 1;
      return response({ validated: true, payload: { request: snapshotRequests } });
    },
  });
  client.start();
  await settle();
  source.onopen?.();
  const subscription = client.subscribe({
    repoKey: "aaaaaaaaaaaa",
    ovenId: "visual-parity",
    subjectId: "scenario-a",
    url: "/api/oven-data/visual-parity?repoKey=aaaaaaaaaaaa&scenario=scenario-a",
    receive(res, json) { if (!res.ok || !json.validated) throw new Error("invalid"); return json.payload; },
  }, () => {});
  await settle();
  assert.equal(snapshotRequests, 1);

  source.emit("oven-event", { repoKey: "aaaaaaaaaaaa", ...publication });
  timers.flush();
  await settle();
  assert.equal(snapshotRequests, 2, "the real Oven subject invalidates the scenario-specific query");

  source.emit("oven-reset", { repoKey: "aaaaaaaaaaaa", ovenId: "visual-parity", reason: "retention-gap" });
  timers.flush();
  await settle();
  assert.equal(snapshotRequests, 3, "an explicit replay reset forces a canonical snapshot read");
  subscription.unsubscribe();
  client.stop();
});
