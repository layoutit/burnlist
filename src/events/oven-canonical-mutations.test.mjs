import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  ovenDefinitionChangedInput,
  ovenLifecycleChangedInput,
  publishCanonicalMutation,
} from "./oven-canonical-mutations.mjs";
import { readOvenEvents } from "./oven-event-store.mjs";

function repository(t) {
  const root = mkdtempSync(join(tmpdir(), "burnlist-canonical-mutation-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test("definition generations are retry-idempotent and later generations remain distinct", (t) => {
  const root = repository(t);
  const base = {
    ovenId: "visual-parity",
    action: "updated",
    revision: "sha256-source",
    generation: "generation-1",
  };
  const first = publishCanonicalMutation(root, ovenDefinitionChangedInput({
    ...base, occurredAt: "2026-07-22T14:30:00-03:00",
  }));
  const retry = publishCanonicalMutation(root, ovenDefinitionChangedInput({
    ...base, occurredAt: "2026-07-22T14:31:00-03:00",
  }));
  const next = publishCanonicalMutation(root, ovenDefinitionChangedInput({
    ...base, generation: "generation-2", occurredAt: "2026-07-22T14:32:00-03:00",
  }));

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.equal(next.created, true);
  assert.deepEqual(readOvenEvents(root, { ovenIds: [base.ovenId] }).map((event) => event.sequence), [1, 2]);
});

test("lifecycle retries retain one transition identity", (t) => {
  const root = repository(t);
  const transition = { burnlistId: "260722-001", from: "ready", to: "inprogress" };
  const first = publishCanonicalMutation(root, ovenLifecycleChangedInput({
    ...transition, occurredAt: "2026-07-22T14:30:00-03:00",
  }));
  const retry = publishCanonicalMutation(root, ovenLifecycleChangedInput({
    ...transition, occurredAt: "2026-07-22T14:31:00-03:00",
  }));

  assert.equal(first.created, true);
  assert.equal(retry.created, false);
  assert.deepEqual(readOvenEvents(root, { ovenIds: ["checklist"] }).map((event) => event.payload), [
    { from: "ready", to: "inprogress" },
  ]);
});
