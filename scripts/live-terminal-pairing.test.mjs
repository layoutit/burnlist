import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));

test("live Storybook pair interaction suite passes", () => {
  const result = spawnSync(
    resolve(root, "tui/node_modules/.bin/bun"),
    ["test", "dashboard/src/components/TerminalFrame/TerminalPairPreview.test.tsx"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
