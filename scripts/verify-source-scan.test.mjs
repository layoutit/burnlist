import assert from "node:assert/strict";
import test from "node:test";
import { shouldScanSourceRelativePath } from "./verify-source-scan.mjs";

test("source leak scanning excludes local and nested checkout state", () => {
  for (const path of [
    ".git/config",
    ".local/burnlist/state.json",
    ".burnlist/loop-capabilities.json",
    ".worktrees/feature/.git",
    ".worktrees/feature/src/private.mjs",
    "node_modules/package/index.js",
  ]) {
    assert.equal(shouldScanSourceRelativePath(path), false, path);
  }
});

test("source leak scanning retains repository source and similarly named paths", () => {
  for (const path of [
    "src/loops/view/render.mjs",
    "scripts/verify.mjs",
    "worktrees/committed-example.mjs",
    "src/.git-example.mjs",
  ]) {
    assert.equal(shouldScanSourceRelativePath(path), true, path);
  }
});
