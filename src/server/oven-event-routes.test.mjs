import assert from "node:assert/strict";
import { request } from "node:http";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { publishOvenEvent } from "../events/oven-event-store.mjs";
import { repoKey } from "./registry.mjs";
import { httpGet, withServer } from "./dashboard-routes-fixtures.mjs";

function event(cursor, occurredAt) {
  return {
    ovenId: "future-oven",
    subjectId: "subject-1",
    kind: "iteration",
    phase: "complete",
    cursor,
    occurredAt,
    payload: { cursor },
  };
}

function nextSseEvent(baseUrl, path, afterOpen) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timed out waiting for Oven event SSE")), 5_000);
    const req = request(new URL(path, baseUrl), { headers: { accept: "text/event-stream" } });
    req.once("response", (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buffer += chunk;
        const blocks = buffer.split("\n\n");
        buffer = blocks.pop() ?? "";
        for (const block of blocks) {
          if (!block.includes("event: oven-event")) continue;
          const data = block.split("\n").find((line) => line.startsWith("data: "))?.slice(6);
          if (!data) continue;
          clearTimeout(timer);
          req.destroy();
          resolve(JSON.parse(data));
          return;
        }
      });
      afterOpen();
    });
    req.once("error", (error) => {
      if (error.code !== "ECONNRESET") reject(error);
    });
    req.end();
  });
}

test("/api/events returns filtered replay with stable delivery cursors", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl, repoRoot }) => {
    const first = publishOvenEvent(repoRoot, event("run-1", "2026-07-21T12:00:00.000Z"));
    const second = publishOvenEvent(repoRoot, event("run-2", "2026-07-21T12:01:00.000Z"));
    const key = repoKey(repoRoot);
    const firstPage = await httpGet(baseUrl, `/api/events?repoKey=${key}&ovenId=future-oven&limit=1`);
    assert.equal(firstPage.status, 200);
    const firstPayload = JSON.parse(firstPage.body);
    assert.equal(firstPayload.events[0].eventId, first.event.eventId);
    assert.equal(firstPayload.truncated, true);
    const response = await httpGet(baseUrl, `/api/events?repoKey=${key}&ovenId=future-oven&after=${encodeURIComponent(firstPayload.cursor)}`);
    assert.equal(response.status, 200);
    const payload = JSON.parse(response.body);
    assert.equal(payload.schema, "burnlist-oven-event-feed@1");
    assert.equal(payload.total, 1);
    assert.equal(payload.events[0].eventId, second.event.eventId);
    assert.equal(payload.events[0].deliveryId, `${key}:future-oven:2:${second.event.eventId}`);
    assert.equal(Object.hasOwn(payload.events[0], "repoRoot"), false);
  });
});

test("/api/events never advances one Oven past an earlier sequence when producer clocks regress", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl, repoRoot }) => {
    const first = publishOvenEvent(repoRoot, event("sequence-1", "2026-07-21T12:00:00.000Z"));
    publishOvenEvent(repoRoot, event("sequence-2", "2026-07-21T11:00:00.000Z"));
    const page = JSON.parse((await httpGet(baseUrl, "/api/events?ovenId=future-oven&limit=1")).body);
    assert.equal(page.events[0].eventId, first.event.eventId);
    const replay = JSON.parse((await httpGet(baseUrl, `/api/events?ovenId=future-oven&after=${encodeURIComponent(page.cursor)}`)).body);
    assert.equal(replay.events[0].cursor, "sequence-2");
  });
});

test("/api/events streams a newly published event without an agent heartbeat", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl, repoRoot }) => {
    const key = repoKey(repoRoot);
    const received = await nextSseEvent(baseUrl, `/api/events?stream=1&repoKey=${key}`, () => {
      setTimeout(() => publishOvenEvent(repoRoot, event("live-run", new Date().toISOString())), 50);
    });
    assert.equal(received.cursor, "live-run");
    assert.equal(received.repoKey, key);
  });
});

test("/api/events rejects malformed replay cursors and unknown project keys", { timeout: 20_000 }, async () => {
  await withServer({ withBurnlist: true }, async ({ baseUrl }) => {
    const unknownRepo = await httpGet(baseUrl, `/api/events?repoKey=${"f".repeat(12)}`);
    assert.equal(unknownRepo.status, 404);
    const malformedCursor = await httpGet(baseUrl, "/api/events?after=not-a-cursor");
    assert.equal(malformedCursor.status, 400);
  });
});

test("/api/events vector cursor replays a later cross-repo write with an earlier producer time", { timeout: 20_000 }, async () => {
  let repoA;
  let repoB;
  await withServer({
    burnlists: [{ repoPath: "repo-a", id: "first" }, { repoPath: "repo-b", id: "second" }],
    setup({ fixtureRoot }) {
      repoA = realpathSync(join(fixtureRoot, "repo-a"));
      repoB = realpathSync(join(fixtureRoot, "repo-b"));
      publishOvenEvent(repoA, event("repo-a-run", "2026-07-21T12:00:00.000Z"));
    },
  }, async ({ baseUrl }) => {
    const firstPage = JSON.parse((await httpGet(baseUrl, "/api/events?limit=1")).body);
    assert.equal(firstPage.events[0].repoKey, repoKey(repoA));
    publishOvenEvent(repoB, event("repo-b-late-write", "2026-07-21T11:00:00.000Z"));
    const replay = JSON.parse((await httpGet(baseUrl, `/api/events?after=${encodeURIComponent(firstPage.cursor)}`)).body);
    assert.equal(replay.events.length, 1);
    assert.equal(replay.events[0].cursor, "repo-b-late-write");
    assert.equal(replay.events[0].repoKey, repoKey(repoB));
  });
});
