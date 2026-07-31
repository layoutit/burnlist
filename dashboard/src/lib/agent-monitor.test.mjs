import assert from "node:assert/strict";
import test from "node:test";

import {
  agentMonitorAutoOpenHref,
  agentMonitorSnapshotNotice,
  mapAgentMonitorFeeds,
  mapAgentMonitorLandingFeeds,
  parseAgentMonitorSnapshot,
} from "./agent-monitor.mjs";

const identity = {
  logicalRepoKey: "aaaaaaaaaaaa",
  worktreeKey: "bbbbbbbbbbbb",
  session: "019f9e6a-e2e8-7973-8b8f-66311ce69bef",
};

test("Agent Monitor feed discovery preserves exact session identity", () => {
  const feeds = mapAgentMonitorFeeds({
    feeds: [{
      identity,
      updatedAt: "2026-07-26T12:00:00.000Z",
      summary: {
        state: "Live",
        current: "COMMAND · line 42",
        lines: 42,
        failures: 1,
        updatedAt: "2026-07-26T12:00:00.000Z",
        provider: "codex",
        threadSource: "user",
        topLevel: true,
        turnOpen: true,
        caughtUp: true,
      },
    }],
  });
  assert.deepEqual(feeds[0].identity, identity);
  assert.equal(
    feeds[0].href,
    "/r/aaaaaaaaaaaa/o/agent-monitor?worktreeKey=bbbbbbbbbbbb&session=019f9e6a-e2e8-7973-8b8f-66311ce69bef",
  );
  assert.equal(feeds[0].title, "Live · COMMAND · line 42");
  assert.equal(feeds[0].detail, "Thread …1ce69bef · 42 events · 1 failure");
  assert.equal(feeds[0].state, "Live");
  assert.equal(feeds[0].activityAt, "2026-07-26T12:00:00.000Z");
  assert.equal(feeds[0].provider, "codex");
  assert.equal(feeds[0].threadSource, "user");
  assert.equal(feeds[0].topLevel, true);
  assert.equal(feeds[0].turnOpen, true);
  assert.equal(feeds[0].caughtUp, true);
  assert.equal(agentMonitorAutoOpenHref(feeds), feeds[0].href);
  assert.equal(agentMonitorAutoOpenHref([...feeds, ...feeds]), null);
});

test("Agent Monitor landing discovery cannot cross repository identity", () => {
  const feeds = mapAgentMonitorLandingFeeds([{
    repository: { repoKey: "cccccccccccc", label: "Other" },
    payload: { feeds: [{ identity, updatedAt: "2026-07-26T12:00:00.000Z" }] },
  }]);
  assert.deepEqual(feeds, []);
});

test("Agent Monitor accepts only the selected canonical session snapshot", () => {
  const payload = { contract: "burnlist-agent-monitor-data@1", identity };
  assert.equal(parseAgentMonitorSnapshot({ payload }, {
    repoKey: identity.logicalRepoKey,
    worktreeKey: identity.worktreeKey,
    session: identity.session,
  }), payload);
  assert.equal(parseAgentMonitorSnapshot({ payload }, {
    repoKey: identity.logicalRepoKey,
    worktreeKey: identity.worktreeKey,
    session: "another-session",
  }), null);
});

test("Agent Monitor background refreshes do not insert a layout-shifting notice", () => {
  const data = { contract: "burnlist-agent-monitor-data@1" };
  assert.equal(agentMonitorSnapshotNotice({
    data,
    error: "",
    loading: true,
    stale: true,
  }), null);
  assert.deepEqual(agentMonitorSnapshotNotice({
    data: null,
    error: "",
    loading: true,
    stale: false,
  }), { kind: "loading", text: "Loading thread statistics." });
  assert.deepEqual(agentMonitorSnapshotNotice({
    data,
    error: "Refresh failed.",
    loading: false,
    stale: true,
  }), { kind: "error", text: "Refresh failed." });
});
