import assert from "node:assert/strict";
import test from "node:test";
import {
  completedItemWorkState,
  projectItemWorkState,
  RECENT_ACTIVITY_MS,
} from "./item-work-state.mjs";

function run(patch = {}) {
  return {
    runId: "run:test",
    state: "running",
    currentNode: "implement",
    hostTask: "claimed",
    graph: { nodes: [{ id: "implement", kind: "agent" }] },
    activity: { hooks: "unavailable", records: [] },
    ...patch,
  };
}

test("checklist position never fabricates active work", () => {
  const pending = projectItemWorkState();
  assert.equal(pending.state, "PENDING");
  assert.equal(pending.progressing, false);
  assert.match(pending.reason, /checklist position does not imply execution/u);
  assert.equal(pending.provenance.state, "canonical-burnlist-and-run-absence");
});

test("canonical Run and claim distinguish waiting, active, blocked, and completed", () => {
  assert.equal(projectItemWorkState({ run: run({ state: "prepared", hostTask: "awaiting-claim" }) }).state, "WAITING");
  assert.equal(projectItemWorkState({ run: run({ hostTask: "awaiting-claim" }) }).state, "WAITING");
  assert.equal(projectItemWorkState({ run: run() }).state, "ACTIVE");
  assert.equal(projectItemWorkState({ run: run({ state: "needs-human" }) }).state, "BLOCKED");
  assert.equal(projectItemWorkState({ diagnostic: "corrupt" }).state, "BLOCKED");
  assert.equal(completedItemWorkState().state, "COMPLETED");
});

test("only recent correlated hooks refine active work to progressing", () => {
  const now = 1_000_000;
  const active = run({ activity: { hooks: "available", records: [
    { at: now - RECENT_ACTIVITY_MS - 1, origin: "runner", kind: "claimed", observedPath: "ignored.mjs" },
    { at: now - 500, origin: "host-hook", kind: "tool-finished", observedPaths: ["src/a.mjs", "src/b.mjs"] },
  ] } });
  const projected = projectItemWorkState({ run: active, now });
  assert.equal(projected.state, "ACTIVE");
  assert.equal(projected.progressing, true);
  assert.deepEqual(projected.observation.codeChanges, ["src/a.mjs", "src/b.mjs"]);
  assert.equal(projected.observation.authority, "observational");

  const waiting = projectItemWorkState({ run: { ...active, hostTask: "awaiting-claim" }, now });
  assert.equal(waiting.state, "WAITING");
  assert.equal(waiting.progressing, false);
});
