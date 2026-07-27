import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { discoverAgentSessionSources } from "./agent-monitor-sources.mjs";

const NOW = "2026-07-27T12:00:00.000Z";
const limits = {
  days: 14,
  maxCandidateFiles: 100,
  maxDirectories: 100,
  maxFileBytes: 1_000_000,
  maxSessions: 100,
  metadataBytes: 100_000,
};

test("provider discovery returns a common source shape for Codex, Claude, AGY, and Grok", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-monitor-sources-"));
  try {
    const repo = join(root, "repo");
    mkdirSync(repo);
    execFileSync("git", ["init", "--quiet"], { cwd: repo });
    const roots = Object.fromEntries(["codex", "claude", "agy", "grok"].map((name) => {
      const path = join(root, name);
      mkdirSync(path);
      return [name, path];
    }));
    const codex = join(roots.codex, "2026", "07", "27", "session.jsonl");
    mkdirSync(join(roots.codex, "2026", "07", "27"), { recursive: true });
    writeFileSync(codex, `${JSON.stringify({ type: "session_meta", payload: { session_id: "c1", cwd: repo } })}\n`);
    const claude = join(roots.claude, "project", "d1.jsonl");
    mkdirSync(join(roots.claude, "project"));
    writeFileSync(claude, `${JSON.stringify({ type: "user", sessionId: "d1", cwd: repo })}\n`);
    const agy = join(roots.agy, "a1", ".system_generated", "logs", "transcript.jsonl");
    mkdirSync(join(roots.agy, "a1", ".system_generated", "logs"), { recursive: true });
    writeFileSync(agy, `${JSON.stringify({ type: "USER_INPUT", conversationId: "a1", workspacePath: repo })}\n`);
    const encoded = encodeURIComponent(repo);
    const grok = join(roots.grok, encoded, "g1", "events.jsonl");
    mkdirSync(join(roots.grok, encoded, "g1"), { recursive: true });
    writeFileSync(grok, `${JSON.stringify({ type: "turn_started", ts: NOW })}\n`);
    for (const path of [codex, claude, agy, grok]) utimesSync(path, new Date(NOW), new Date(NOW));

    const found = discoverAgentSessionSources({
      roots, limits, nowMs: Date.parse(NOW), providers: ["codex", "claude", "agy", "grok"],
    });
    assert.deepEqual(found.map((item) => item.provider).sort(), ["agy", "claude", "codex", "grok"]);
    assert.ok(found.every((item) => item.cwd === repo));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
