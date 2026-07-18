import assert from "node:assert/strict";
import test from "node:test";
import { applyStreamingDiffCardMessage } from "../../hooks/streaming-diff-transport.mjs";
import { receiveVisualParity } from "../../hooks/visual-parity-transport.mjs";

test("Visual Parity receive returns validated payloads", () => {
  const payload = { score: 0.98 };
  assert.deepEqual(receiveVisualParity({ ok: true }, { validated: true, payload }), payload);
});

test("Visual Parity receive enforces the validated gate", () => {
  for (const json of [{}, { validated: false }]) {
    assert.throws(
      () => receiveVisualParity({ ok: true }, json),
      { message: "Visual Parity data was not validated by the Oven." },
    );
  }
});

test("Visual Parity receive reports response errors exactly", () => {
  assert.throws(() => receiveVisualParity({ ok: false }, { error: "x" }), { message: "x" });
  assert.throws(
    () => receiveVisualParity({ ok: false }, {}),
    { message: "Could not load Visual Parity." },
  );
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
