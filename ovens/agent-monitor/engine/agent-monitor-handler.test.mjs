import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { buildAgentMonitorSnapshot } from "./agent-monitor-projection.mjs";
import {
  commitAgentMonitorSnapshot,
  resolveAgentMonitorIdentity,
} from "./agent-monitor-feed.mjs";
import { agentMonitorHandler } from "./agent-monitor-handler.mjs";

const NOW = "2026-07-26T12:00:00.000Z";

class ResponseRecorder extends EventEmitter {
  constructor(headers = {}) {
    super();
    this.requestHeaders = headers;
    this.status = null;
    this.headers = null;
    this.chunks = [];
  }

  writeHead(status, headers) {
    this.status = status;
    this.headers = headers;
  }

  write(chunk) {
    this.chunks.push(Buffer.from(chunk));
    return true;
  }

  end(chunk) {
    if (chunk) this.chunks.push(Buffer.from(chunk));
    this.emit("finish");
  }
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-agent-monitor-handler-"));
  execFileSync("git", ["init", "--quiet"], { cwd: root, stdio: "ignore" });
  const identity = resolveAgentMonitorIdentity({ cwd: root, session: "session-exact" });
  const event = {
    id: "session-exact:1:aaaaaaaaaaaa",
    line: 1,
    time: NOW,
    category: "lifecycle",
    eventType: "event_msg/task_started",
    title: "LIFECYCLE · line 1",
    detail: "Agent task started",
    result: "started",
    signature: "a".repeat(64),
  };
  const snapshot = buildAgentMonitorSnapshot({
    events: [event],
    file: "rollout-session-exact.jsonl",
    generatedAt: NOW,
    identity: identity.identity,
    line: 1,
    newEvents: [event],
    nowMs: Date.parse(NOW),
  });
  const manifest = commitAgentMonitorSnapshot(identity, snapshot, () => NOW, {
    file: "rollout-session-exact.jsonl",
    dev: 1,
    ino: 1,
    offset: 1,
    line: 1,
  });
  return {
    root,
    identity,
    manifest,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function context(value, url, response = new ResponseRecorder()) {
  return {
    binding: { repoRoot: value.root },
    bindingPath: value.identity.feedRoot,
    cache: new Map(),
    maxOvenDataBytes: 8 * 1024 * 1024,
    req: { headers: response.requestHeaders },
    res: response,
    url,
  };
}

function selectionUrl(value, session = value.identity.identity.session) {
  return new URL(`http://localhost/?${new URLSearchParams({
    repoKey: value.identity.identity.logicalRepoKey,
    worktreeKey: value.identity.identity.worktreeKey,
    session,
  })}`);
}

test("Agent Monitor lists manifests and serves only the exact canonical session snapshot", () => {
  const value = fixture();
  try {
    const manifestPath = join(value.identity.feedDir, "manifest.json");
    const before = statSync(manifestPath).mtimeMs;
    const listed = agentMonitorHandler.serveData(context(
      value,
      new URL(`http://localhost/?list&repoKey=${value.identity.identity.logicalRepoKey}`),
    ));
    assert.deepEqual(listed.feeds, [{
      identity: value.identity.identity,
      updatedAt: NOW,
      summary: {
        state: "Live",
        current: "LIFECYCLE · line 1",
        lines: 1,
        failures: 0,
        updatedAt: NOW,
      },
    }]);
    assert.equal(statSync(manifestPath).mtimeMs, before);

    const response = new ResponseRecorder();
    agentMonitorHandler.serveData(context(value, selectionUrl(value), response));
    assert.equal(response.status, 200);
    assert.match(response.headers.etag, /^W\/"oven-json-[a-f0-9]{64}"$/u);
    const body = JSON.parse(Buffer.concat(response.chunks));
    assert.deepEqual(body.identity, value.identity.identity);
    assert.equal(body.payload.contract, "burnlist-agent-monitor-data@1");
    assert.equal(body.payload.monitor.counts.lines, 1);
    assert.equal(body.payload.identity.session, "session-exact");

    const unchanged = new ResponseRecorder({ "if-none-match": response.headers.etag });
    agentMonitorHandler.serveData(context(value, selectionUrl(value), unchanged));
    assert.equal(unchanged.status, 304);
    assert.equal(unchanged.chunks.length, 0);
  } finally {
    value.cleanup();
  }
});

test("Agent Monitor aggregates recent sessions and rejects an unselected or wrong session", () => {
  const value = fixture();
  try {
    assert.equal(agentMonitorHandler.dataInput, "producer-managed");
    assert.equal(agentMonitorHandler.validateData, undefined);
    const aggregate = agentMonitorHandler.serveData(context(
      value,
      new URL(`http://localhost/?aggregate&repoKey=${value.identity.identity.logicalRepoKey}`),
    ));
    assert.equal(aggregate.payload.identity.session, "all");
    assert.equal(aggregate.payload.raw.completed.length, 1);
    assert.match(aggregate.payload.raw.completed[0].detail, /…on-exact · Agent task started/u);
    assert.throws(
      () => agentMonitorHandler.serveData(context(value, new URL("http://localhost/"))),
      (error) => error.status === 400 && /selection requires/u.test(error.message),
    );
    assert.throws(
      () => agentMonitorHandler.serveData(context(value, selectionUrl(value, "wrong-session"))),
      (error) => error.status === 404 && /not available/u.test(error.message),
    );
  } finally {
    value.cleanup();
  }
});
