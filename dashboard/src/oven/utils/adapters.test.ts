import assert from "node:assert/strict";
import test from "node:test";
import { validatedOvenPayload } from "../../lib/canonical-oven-payload.mjs";
import { applyStreamingDiffCardMessage } from "../../hooks/streaming-diff-transport.mjs";
import { snapshotLiveResult } from "./useOvenLiveData";

test("canonical Oven adapters return only validated payloads", () => {
  const payload = { score: 0.98 };
  assert.deepEqual(validatedOvenPayload({ validated: true, payload }, "Visual Parity"), payload);
  for (const json of [{}, { validated: false }, { validated: true }]) {
    assert.throws(() => validatedOvenPayload(json, "Visual Parity"), /was not validated/u);
  }
});

test("snapshot view state retains last good data across transient failure", () => {
  const current = { data: { version: 1 }, error: "", loading: false, stale: false };
  const loading = snapshotLiveResult(current, { data: null, error: "", outcome: "loading" });
  const failed = snapshotLiveResult(loading, { data: null, error: "offline", outcome: "rejected" });
  const recovered = snapshotLiveResult(failed, { data: { version: 2 }, error: "", outcome: "accepted" });
  assert.deepEqual(loading, { data: { version: 1 }, error: "", loading: true, stale: true });
  assert.deepEqual(failed, { data: { version: 1 }, error: "offline", loading: false, stale: true });
  assert.deepEqual(recovered, { data: { version: 2 }, error: "", loading: false, stale: false });
});

test("snapshot view state clears retained data when canonical state is missing", () => {
  const current = { data: { version: 1 }, error: "offline", loading: false, stale: true };
  assert.deepEqual(snapshotLiveResult(current, {
    data: null,
    error: "Oven is unbound.",
    outcome: "missing",
  }), { data: null, error: "Oven is unbound.", loading: false, stale: false });
});

test("Streaming Diff card messages use the real card adapter", () => {
  const card = {
    revId: "revision-1",
    toolUseId: "tool-1",
    ts: "2026-07-15T09:00:00.000Z",
    status: "captured",
    files: [{ path: "src/example.mjs", kind: "modified", diff: "+after" }],
  };

  const cards = applyStreamingDiffCardMessage([], JSON.stringify(card));
  assert.equal(cards.length, 1);
  assert.deepEqual(cards[0], card);
});

test("Streaming Diff card messages reject invalid and unparseable input", () => {
  assert.throws(() => applyStreamingDiffCardMessage([], "{}"), { message: "invalid card" });
  assert.throws(() => applyStreamingDiffCardMessage([], "not-json"));
});
