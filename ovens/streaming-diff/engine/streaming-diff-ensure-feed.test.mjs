import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { readBindingStore } from "../../../src/server/oven-bindings.mjs";
import { ensureStreamingDiffFeed } from "./streaming-diff-ensure-feed.mjs";

function git(cwd, ...args) {
  execFileSync("git", ["-C", cwd, ...args], { stdio: "ignore" });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-streaming-ensure-"));
  git(root, "init", "--quiet");
  git(root, "config", "user.email", "test@example.invalid");
  git(root, "config", "user.name", "Test");
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test("ensure-feed creates a session directory and binds the oven only once", () => {
  const context = fixture();
  try {
    const first = ensureStreamingDiffFeed({ cwd: context.root, session: "first", now: () => "2026-07-15T09:00:00.000Z" });
    const second = ensureStreamingDiffFeed({ cwd: context.root, session: "second", now: () => "2026-07-15T09:01:00.000Z" });
    assert.equal(existsSync(first.identity.feedDir), true);
    assert.equal(existsSync(second.identity.feedDir), true);
    assert.equal(first.binding.created, true);
    assert.equal(second.binding.created, false);
    assert.deepEqual(readBindingStore(context.root).bindings["streaming-diff"], {
      path: ".local/burnlist/streaming-diff/v2",
      boundAt: "2026-07-15T09:00:00.000Z",
    });
  } finally { context.cleanup(); }
});
