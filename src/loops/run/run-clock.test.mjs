import assert from "node:assert/strict";
import test from "node:test";
import { processStartWall } from "./run-clock.mjs";

test("process start wall is stable across delayed module observation", () => {
  assert.equal(processStartWall({ nowMilliseconds: 10_000, uptimeSeconds: 5 }), 5_000);
  assert.equal(processStartWall({ nowMilliseconds: 20_000, uptimeSeconds: 15 }), 5_000);
  assert.equal(processStartWall({ nowMilliseconds: 10_000, uptimeSeconds: 5.0006 }), 4_999);
});

test("process start wall rejects non-canonical inputs", () => {
  assert.throws(() => processStartWall({ nowMilliseconds: -1, uptimeSeconds: 0 }), /invalid/u);
  assert.throws(() => processStartWall({ nowMilliseconds: 1, uptimeSeconds: Number.NaN }), /invalid/u);
});

test("elapsed authority stays in journal budgets, not a process-local clock sample", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./run-clock.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /clockSample|processClock/u);
});
