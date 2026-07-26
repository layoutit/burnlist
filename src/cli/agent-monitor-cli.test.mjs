import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { resolveAgentMonitorIdentity } from "../../ovens/agent-monitor/engine/agent-monitor-feed.mjs";

const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-agent-monitor-cli-"));
  execFileSync("git", ["init", "--quiet", root]);
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(context, ...args) {
  return execFileSync(process.execPath, [binPath, "agent-monitor", ...args], {
    cwd: context.root,
    encoding: "utf8",
  }).trim();
}

test("Agent Monitor CLI returns an exact URL-addressed Codex thread handoff", () => {
  const context = fixture();
  try {
    const identity = resolveAgentMonitorIdentity({ cwd: context.root, session: "thread-exact" });
    assert.equal(
      run(context, "url", "--session", "thread-exact"),
      `/r/${identity.identity.logicalRepoKey}/o/agent-monitor?worktreeKey=${identity.identity.worktreeKey}&session=thread-exact`,
    );
  } finally { context.cleanup(); }
});

test("Agent Monitor CLI preserves the explicit landing route without a thread handoff", () => {
  const context = fixture();
  try {
    const identity = resolveAgentMonitorIdentity({ cwd: context.root, session: "thread-exact" });
    assert.equal(
      run(context, "url"),
      `/r/${identity.identity.logicalRepoKey}/o/agent-monitor`,
    );
  } finally { context.cleanup(); }
});

test("Agent Monitor CLI rejects a thread handoff across repository identity", () => {
  const context = fixture();
  const foreign = fixture();
  try {
    assert.throws(
      () => run(context, "url", "--repo", foreign.root, "--session", "thread-exact"),
      (error) => error.status === 1
        && /thread does not belong to the selected repository/u.test(error.stderr),
    );
  } finally {
    context.cleanup();
    foreign.cleanup();
  }
});
