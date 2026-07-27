import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { writeBinding } from "../../../src/server/oven-bindings.mjs";
import {
  commitAgentMonitorSnapshot,
  ensureAgentMonitorFeedRoot,
  loadAgentMonitorFeed,
  resolveAgentMonitorIdentity,
} from "./agent-monitor-feed.mjs";
import { discoverAgentMonitorSessions, runAgentMonitorOnce } from "./agent-monitor-producer.mjs";

const NOW = "2026-07-26T12:00:00.000Z";

function record(type, payload, timestamp = NOW) {
  return JSON.stringify({ timestamp, type, payload });
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-agent-monitor-producer-"));
  const foreign = mkdtempSync(join(tmpdir(), "burnlist-agent-monitor-foreign-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
  execFileSync("git", ["init", "--quiet"], { cwd: foreign, stdio: "ignore" });
  const sessionRoot = join(root, "sessions");
  const day = join(sessionRoot, "2026", "01", "01");
  mkdirSync(day, { recursive: true });
  const writeSession = (name, session, cwd, detail) => {
    const path = join(day, `${name}-${session}.jsonl`);
    writeFileSync(path, [
      record("session_meta", { session_id: session, cwd }),
      record("response_item", { type: "agent_message", message: detail }),
    ].join("\n") + "\n");
    utimesSync(path, new Date(NOW), new Date(NOW));
    return path;
  };
  return {
    root,
    foreign,
    sessionRoot,
    first: writeSession("rollout-a", "session-a", root, "Working on the exact feed."),
    second: writeSession("rollout-b", "session-b", root, "Second exact thread."),
    ignored: writeSession("rollout-c", "session-c", foreign, "Foreign thread."),
    cleanup() {
      rmSync(root, { recursive: true, force: true });
      rmSync(foreign, { recursive: true, force: true });
    },
  };
}

test("the repository producer publishes separate exact session feeds incrementally", () => {
  const context = fixture();
  try {
    const options = {
      repoRoot: context.root,
      sessionRoot: context.sessionRoot,
      nowMs: Date.parse(NOW),
      now: () => NOW,
    };
    const first = runAgentMonitorOnce(options);
    assert.equal(first.scanned, 2);
    assert.equal(first.changed, 2);
    assert.deepEqual(first.feeds.map((feed) => feed.identity.session).sort(), ["session-a", "session-b"]);
    assert.notEqual(first.feeds[0].manifest.snapshot, first.feeds[1].manifest.snapshot);

    const selected = first.feeds.find((feed) => feed.identity.session === "session-a");
    const firstIdentity = resolveAgentMonitorIdentity({ cwd: context.root, session: "session-a" });
    const secondIdentity = resolveAgentMonitorIdentity({ cwd: context.root, session: "session-b" });
    assert.notEqual(firstIdentity.feedDir, secondIdentity.feedDir);
    const published = loadAgentMonitorFeed(firstIdentity.feedDir);
    assert.deepEqual(published.manifest.identity, selected.identity);
    assert.equal(published.snapshot.monitor.counts.lines, 2);
    assert.equal(published.snapshot.raw.completed.length, 1);
    assert.equal(published.manifest.cursor.line, 2);
    assert.equal(published.manifest.summary.updatedAt, NOW);

    assert.equal(runAgentMonitorOnce(options).changed, 0);
    appendFileSync(context.first, `${record("response_item", {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "git status --short" }),
    }, "2026-07-26T12:00:01.000Z")}\n`);
    utimesSync(context.first, new Date("2026-07-26T12:00:01.000Z"), new Date("2026-07-26T12:00:01.000Z"));
    const incremental = runAgentMonitorOnce({
      ...options,
      nowMs: Date.parse("2026-07-26T12:00:01.000Z"),
      now: () => "2026-07-26T12:00:01.000Z",
    });
    assert.equal(incremental.changed, 1);
    assert.equal(incremental.feeds.find((feed) => feed.changed).identity.session, "session-a");
    assert.equal(loadAgentMonitorFeed(firstIdentity.feedDir).snapshot.monitor.counts.lines, 3);
    assert.equal(loadAgentMonitorFeed(firstIdentity.feedDir).snapshot.raw.completed.length, 2);
    assert.equal(loadAgentMonitorFeed(secondIdentity.feedDir).snapshot.monitor.counts.lines, 2);
  } finally {
    context.cleanup();
  }
});

test("the canonical manifest cursor recovers when the producer mirror is stale", () => {
  const context = fixture();
  try {
    const options = {
      repoRoot: context.root,
      sessionRoot: context.sessionRoot,
      nowMs: Date.parse(NOW),
      now: () => NOW,
    };
    runAgentMonitorOnce(options);
    const identity = resolveAgentMonitorIdentity({ cwd: context.root, session: "session-a" });
    const statePath = join(identity.feedDir, "producer.json");
    const staleState = readFileSync(statePath);
    appendFileSync(context.first, `${record("response_item", {
      type: "function_call",
      name: "exec_command",
      arguments: JSON.stringify({ cmd: "npm run verify" }),
    })}\n`);
    assert.equal(runAgentMonitorOnce(options).errors.length, 0);
    writeFileSync(statePath, staleState);

    const recovered = runAgentMonitorOnce(options);
    assert.equal(recovered.errors.length, 0);
    assert.equal(recovered.changed, 0);
    assert.equal(loadAgentMonitorFeed(identity.feedDir).snapshot.monitor.counts.lines, 3);
  } finally {
    context.cleanup();
  }
});

test("a projection upgrade replays the recent source tail instead of preserving stale card text", () => {
  const context = fixture();
  try {
    const options = {
      repoRoot: context.root,
      sessionRoot: context.sessionRoot,
      nowMs: Date.parse(NOW),
      now: () => NOW,
    };
    runAgentMonitorOnce(options);
    const identity = resolveAgentMonitorIdentity({ cwd: context.root, session: "session-a" });
    const prior = loadAgentMonitorFeed(identity.feedDir);
    const stale = structuredClone(prior.snapshot);
    stale.monitor.projectionVersion = 3;
    stale.raw.completed[0].detail = "Stale executable-only projection";
    commitAgentMonitorSnapshot(identity, stale, () => NOW, prior.manifest.cursor);

    const upgraded = runAgentMonitorOnce(options);
    assert.deepEqual(upgraded.errors, []);
    assert.equal(upgraded.changed, 1);
    assert.equal(upgraded.feeds[0].reprojected, true);
    const current = loadAgentMonitorFeed(identity.feedDir);
    assert.equal(current.snapshot.monitor.projectionVersion, 13);
    assert.equal(current.snapshot.raw.completed[0].detail, "Working on the exact feed.");
  } finally {
    context.cleanup();
  }
});

test("session discovery retries metadata after a partial first record grows", () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-agent-monitor-partial-"));
  try {
    execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
    const sessionRoot = join(root, "sessions");
    const day = join(sessionRoot, "2026", "01", "01");
    mkdirSync(day, { recursive: true });
    const path = join(day, "rollout-partial.jsonl");
    const source = `${record("session_meta", { session_id: "partial-session", cwd: root })}\n`;
    writeFileSync(path, source.slice(0, 40));
    utimesSync(path, new Date(NOW), new Date(NOW));
    const options = { repoRoot: root, sessionRoot, nowMs: Date.parse(NOW) };
    assert.equal(discoverAgentMonitorSessions(options).length, 0);
    appendFileSync(path, source.slice(40));
    assert.deepEqual(
      discoverAgentMonitorSessions(options).map((item) => item.session),
      ["partial-session"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("a quiet live feed publishes one bounded idle transition", () => {
  const context = fixture();
  try {
    const initial = {
      repoRoot: context.root,
      sessionRoot: context.sessionRoot,
      nowMs: Date.parse(NOW),
      now: () => NOW,
    };
    runAgentMonitorOnce(initial);
    const later = "2026-07-26T12:02:00.000Z";
    const transitioned = runAgentMonitorOnce({
      ...initial,
      nowMs: Date.parse(later),
      now: () => later,
    });
    assert.equal(transitioned.changed, 2);
    assert.ok(transitioned.feeds.every((feed) => feed.reprojected));
    const identity = resolveAgentMonitorIdentity({ cwd: context.root, session: "session-a" });
    const idleFeed = loadAgentMonitorFeed(identity.feedDir);
    assert.equal(idleFeed.snapshot.monitor.summary.state, "Idle");
    assert.equal(idleFeed.manifest.updatedAt, later);
    assert.equal(idleFeed.manifest.summary.updatedAt, NOW);
    assert.equal(runAgentMonitorOnce({
      ...initial,
      nowMs: Date.parse(later),
      now: () => later,
    }).changed, 0);
  } finally {
    context.cleanup();
  }
});

test("the producer never silently retains a legacy single-file binding", () => {
  const context = fixture();
  try {
    writeBinding(
      context.root,
      "agent-monitor",
      ".local/burnlist/data/agent-monitor.json",
      NOW,
    );
    assert.throws(
      () => ensureAgentMonitorFeedRoot(context.root, () => NOW),
      /binding must point to \.local\/burnlist\/agent-monitor\/v1/u,
    );
  } finally {
    context.cleanup();
  }
});
