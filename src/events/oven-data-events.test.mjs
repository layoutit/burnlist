import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  OVEN_DATA_PUBLISHED_KIND,
  OVEN_DATA_PUBLISHED_PHASE,
  ovenDataPublishedInput,
  publishOvenDataPublishedEvent,
  publishOvenEvent,
  readOvenEvents,
} from "./oven-events.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-data-events-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function input(overrides = {}) {
  return {
    ovenId: "visual-parity",
    subjectId: "scenario-1",
    cursor: `sha256-${"a".repeat(64)}`,
    occurredAt: "2026-07-22T12:00:00.000Z",
    payload: { changed: true },
    ...overrides,
  };
}

test("data publication input fixes the generic invalidation vocabulary", () => {
  const event = ovenDataPublishedInput(input());
  assert.deepEqual(event, {
    ...input(),
    kind: OVEN_DATA_PUBLISHED_KIND,
    phase: OVEN_DATA_PUBLISHED_PHASE,
  });
  assert.equal(Object.hasOwn(event, "schema"), false);
  assert.equal(Object.hasOwn(event, "authority"), false);
  assert.throws(
    () => ovenDataPublishedInput(input({ payload: { proof: "x".repeat(4_097) } })),
    /longer than 4096 characters/u,
  );
});

test("data publication is idempotent per stable canonical cursor", (t) => {
  const repo = fixture(t);
  const first = publishOvenDataPublishedEvent(repo, input());
  const retry = publishOvenDataPublishedEvent(repo, input({
    occurredAt: "2026-07-22T12:01:00.000Z",
    payload: { changed: false },
  }));
  const next = publishOvenDataPublishedEvent(repo, input({
    cursor: `sha256-${"b".repeat(64)}`,
    occurredAt: "2026-07-22T12:02:00.000Z",
  }));
  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(retry.event, first.event);
  assert.notEqual(next.event.eventId, first.event.eventId);
  assert.deepEqual(readOvenEvents(repo), [first.event, next.event]);
  assert.ok(readOvenEvents(repo).every((event) => event.authority === "observational"));
});

test("data publication remains compatible with generic Oven event replay", (t) => {
  const repo = fixture(t);
  const progress = publishOvenEvent(repo, {
    ovenId: "visual-parity",
    subjectId: "scenario-1",
    kind: "iteration",
    phase: "running",
    cursor: "run-1",
    occurredAt: "2026-07-22T11:59:00.000Z",
    payload: {},
  });
  const publication = publishOvenDataPublishedEvent(repo, input());
  assert.deepEqual(readOvenEvents(repo), [progress.event, publication.event]);
});
