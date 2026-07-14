import assert from "node:assert/strict";
import test from "node:test";
import { warmOvenHandler } from "./oven-warm.mjs";

test("warm guard swallows binding refresh and warm callback failures", () => {
  const handler = { id: "sample-oven", warm() { throw new Error("unavailable"); } };
  assert.doesNotThrow(() => warmOvenHandler(handler, () => { throw new Error("refresh failed"); }, () => ({})));
  assert.doesNotThrow(() => warmOvenHandler(handler, () => new Map([[handler.id, [{ path: "/tmp/data.json", repoKey: null, repoRoot: null }]]]), () => ({})));
});
