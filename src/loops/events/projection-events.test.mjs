import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loopProjectionChangedInput } from "./projection-events.mjs";
import { normalizeOvenEvent } from "../../events/oven-event-contract.mjs";
import { readLatestRunForItem } from "../run/read-projection.mjs";

test("Loop invalidations identify only the committed projection revision", () => {
  const projection = { itemRef: "item:260722-001#M7", runId: "run:01arz3ndektsv4rrffq69g5fav" };
  const first = loopProjectionChangedInput({ projection, revision: `sha256:${"a".repeat(64)}`, occurredAt: "2026-07-24T10:00:00Z" });
  const second = loopProjectionChangedInput({ projection, revision: `sha256:${"a".repeat(64)}`, occurredAt: "2026-07-24T10:01:00Z" });
  assert.deepEqual(first.payload, { revision: `sha256:${"a".repeat(64)}` });
  assert.equal(first.subjectId, projection.itemRef);
  assert.equal(first.cursor, first.payload.revision);
  assert.equal(normalizeOvenEvent(first).eventId, normalizeOvenEvent(second).eventId, "retry is deduplicated by revision");
  assert.doesNotMatch(JSON.stringify(first), /currentNode|graph|transition|budget/u);
});

test("projection reads ignore only recognized concurrent creation staging directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "loop-projection-staging-"));
  try {
    await mkdir(join(root, ".local", "burnlist", "loop", "m2", "runs", ".create-0123456789abcdef.tmp"), { recursive: true });
    assert.equal(readLatestRunForItem({ repoRoot: root, itemRef: "item:260722-001#M7" }), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("projection reads reject excessive recognized creation staging directories", async () => {
  const root = await mkdtemp(join(tmpdir(), "loop-projection-staging-bound-"));
  try {
    const runs = join(root, ".local", "burnlist", "loop", "m2", "runs");
    await Promise.all(Array.from({ length: 129 }, (_, index) =>
      mkdir(join(runs, `.create-${index.toString(16).padStart(16, "0")}.tmp`), { recursive: true })));
    assert.throws(() => readLatestRunForItem({ repoRoot: root, itemRef: "item:260722-001#M7" }), /exceeds bounds/u);
  } finally { await rm(root, { recursive: true, force: true }); }
});
