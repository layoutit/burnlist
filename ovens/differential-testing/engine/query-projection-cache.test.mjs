import assert from "node:assert/strict";
import test from "node:test";
import { createDifferentialQueryProjectionCache } from "./query-projection-cache.mjs";

function response(id, responseBytes) {
  return { id, responseBytes };
}

test("query projections use bounded byte-accounted LRU eviction", () => {
  const cache = createDifferentialQueryProjectionCache({ maxEntries: 2, maxBytes: 10 });
  const one = response("one", 4);
  const two = response("two", 4);
  const three = response("three", 4);

  cache.set("one", one);
  cache.set("two", two);
  assert.equal(cache.get("one"), one);
  cache.set("three", three);

  assert.equal(cache.get("two"), null);
  assert.equal(cache.get("one"), one);
  assert.equal(cache.get("three"), three);
  assert.deepEqual(cache.stats(), { entries: 2, bytes: 8, maxEntries: 2, maxBytes: 10 });
});

test("oversized projections are served without being retained", () => {
  const cache = createDifferentialQueryProjectionCache({ maxEntries: 2, maxBytes: 5 });
  const oversized = response("oversized", 6);

  assert.equal(cache.set("oversized", oversized), oversized);
  assert.equal(cache.get("oversized"), null);
  assert.equal(cache.stats().bytes, 0);
});
