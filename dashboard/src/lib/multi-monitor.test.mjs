import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMultiMonitorSelections,
  shortThreadSession,
  multiMonitorAvailableFeeds,
  multiMonitorConversationItems,
  multiMonitorConversationPayload,
  multiMonitorDefaultSelections,
  multiMonitorFeedKey,
  multiMonitorHasExplicitEmpty,
  multiMonitorHref,
  multiMonitorThreadTitle,
} from "./multi-monitor.mjs";

const repoKey = "aaaaaaaaaaaa";
const first = {
  logicalRepoKey: repoKey,
  worktreeKey: "bbbbbbbbbbbb",
  session: "019fa-session-one",
};
const second = {
  logicalRepoKey: repoKey,
  worktreeKey: "cccccccccccc",
  session: "claude:session-two",
};
const currentActivity = "2026-07-31T12:00:00.000Z";
const currentNow = Date.parse("2026-07-31T12:10:00.000Z");

test("Multi Monitor preserves ordered exact session identities in repeated URL fields", () => {
  const href = multiMonitorHref({ repoKey, selections: [first, second] });
  assert.equal(
    href,
    "/r/aaaaaaaaaaaa/o/multi-monitor?thread=aaaaaaaaaaaa%3Abbbbbbbbbbbb%3A019fa-session-one&thread=aaaaaaaaaaaa%3Acccccccccccc%3Aclaude%3Asession-two",
  );
  assert.deepEqual(
    parseMultiMonitorSelections({ repoKey, search: href.slice(href.indexOf("?")) }),
    [first, second],
  );
});

test("Multi Monitor preserves cross-repository selections and accepts legacy URLs", () => {
  const crossRepository = {
    logicalRepoKey: "dddddddddddd",
    worktreeKey: "eeeeeeeeeeee",
    session: "019fa-session-three",
  };
  const href = multiMonitorHref({ repoKey, selections: [first, crossRepository] });
  assert.deepEqual(
    parseMultiMonitorSelections({ repoKey, search: href.slice(href.indexOf("?")) }),
    [first, crossRepository],
  );
  assert.deepEqual(
    parseMultiMonitorSelections({ repoKey, search: "?thread=bbbbbbbbbbbb%3A019fa-session-one" }),
    [first],
  );
});

test("Multi Monitor preserves an explicitly empty workspace across navigation", () => {
  const href = multiMonitorHref({ repoKey, selections: [], explicitEmpty: true });
  assert.equal(href, "/r/aaaaaaaaaaaa/o/multi-monitor?columns=empty");
  assert.equal(multiMonitorHasExplicitEmpty(href.slice(href.indexOf("?"))), true);
  assert.deepEqual(
    parseMultiMonitorSelections({ repoKey, search: href.slice(href.indexOf("?")) }),
    [],
  );
  assert.equal(multiMonitorHasExplicitEmpty(""), false);
});

test("Multi Monitor rejects malformed and duplicate selection tokens", () => {
  const search = new URLSearchParams();
  search.append("thread", multiMonitorFeedKey(first));
  search.append("thread", multiMonitorFeedKey(first));
  search.append("thread", "not-a-worktree:session");
  search.append("thread", "bbbbbbbbbbbb:");
  assert.deepEqual(parseMultiMonitorSelections({ repoKey, search }), [first]);
  assert.deepEqual(parseMultiMonitorSelections({ repoKey: "wrong", search }), []);
});

test("Multi Monitor offers only feeds not already mounted", () => {
  const selectable = (identity) => ({
    identity,
    activityAt: currentActivity,
    provider: "codex",
    topLevel: true,
    caughtUp: true,
  });
  const feeds = [
    selectable(first),
    selectable(second),
    { ...selectable({ ...second, session: "subagent" }), topLevel: false },
    { ...selectable({ ...second, session: "claude" }), provider: "claude" },
    { ...selectable({ ...second, session: "catching-up" }), caughtUp: false },
  ];
  assert.deepEqual(multiMonitorAvailableFeeds(feeds, [first], currentNow), [selectable(second)]);
});

test("Multi Monitor defaults to recent caught-up top-level Codex tasks", () => {
  const third = {
    logicalRepoKey: repoKey,
    worktreeKey: "dddddddddddd",
    session: "019fa-session-three",
  };
  const feeds = [
    {
      identity: first,
      activityAt: currentActivity,
      provider: "codex",
      threadSource: "user",
      topLevel: true,
      turnOpen: true,
      caughtUp: true,
      state: "Live",
    },
    {
      identity: second,
      activityAt: currentActivity,
      provider: "codex",
      threadSource: "user",
      topLevel: true,
      turnOpen: false,
      caughtUp: true,
      state: "Live",
    },
    {
      identity: third,
      activityAt: currentActivity,
      provider: "codex",
      threadSource: "subagent",
      topLevel: false,
      turnOpen: true,
      caughtUp: true,
      state: "Live",
    },
  ];

  assert.deepEqual(multiMonitorDefaultSelections(feeds, currentNow), [first, second]);
  assert.deepEqual(multiMonitorDefaultSelections(
    feeds.map((feed) => ({ ...feed, turnOpen: false })),
    currentNow,
  ), [first, second]);
  assert.deepEqual(multiMonitorDefaultSelections([
    { ...feeds[0], state: "Idle" },
  ], currentNow), [first]);
  assert.deepEqual(multiMonitorDefaultSelections([
    { ...feeds[0], caughtUp: false },
    { ...feeds[0], identity: third, provider: "claude" },
  ], currentNow), []);
  assert.deepEqual(multiMonitorDefaultSelections([
    { ...feeds[0], activityAt: "2026-07-31T11:00:00.000Z" },
  ], currentNow), []);
  assert.deepEqual(multiMonitorDefaultSelections([{ identity: null, state: "Live" }], currentNow), []);
});

test("Multi Monitor projects Codex turns with the worked row before the final answer", () => {
  const events = [
    {
      key: "complete",
      eventType: "event_msg/task_complete",
      category: "lifecycle",
      time: "2026-07-30T12:01:34.000Z",
    },
    {
      key: "final",
      eventType: "event_msg/agent_message",
      category: "message",
      message: "Fixed.",
      phase: "final_answer",
    },
    {
      key: "patch",
      category: "diff",
      patch: {
        lines: [
          "*** Update File: dashboard/src/App.tsx",
          "@@",
          "-const oldValue = true;",
          "+const newValue = true;",
        ],
      },
    },
    {
      key: "user",
      eventType: "event_msg/user_message",
      category: "message",
      message: "Fix it.",
    },
    {
      key: "start",
      eventType: "event_msg/task_started",
      category: "lifecycle",
      time: "2026-07-30T12:00:00.000Z",
    },
  ];
  const payload = { raw: { total: events.length, done: events.length, completed: events } };
  const adapted = multiMonitorConversationPayload(payload);
  const items = multiMonitorConversationItems(payload);

  assert.deepEqual(items.map(({ kind }) => kind), ["message", "worked", "message", "edits"]);
  assert.equal(items[0].role, "user");
  assert.equal(items[0].content, "Fix it.");
  assert.equal(items[1].label, "Worked for 1m 34s");
  assert.equal(items[2].phase, "final_answer");
  assert.equal(items[3].count, 1);
  assert.deepEqual(items[3].files, [{
    path: "dashboard/src/App.tsx",
    additions: 1,
    removals: 1,
  }]);
  assert.equal(adapted.raw.total, 4);
  assert.deepEqual(payload.raw.completed.map(({ key }) => key), events.map(({ key }) => key));
});

test("Multi Monitor uses compact stable session labels", () => {
  assert.equal(shortThreadSession("019f9e6a-e2e8-7973-8b8f-66311ce69bef"), "…1ce69bef");
  assert.equal(shortThreadSession("session-a"), "session-a");
});

test("Multi Monitor titles a column from its earliest retained user request", () => {
  const payload = {
    raw: {
      completed: [
        { eventType: "event_msg/user_message", message: "latest follow-up" },
        { eventType: "event_msg/agent_message", message: "working" },
        {
          eventType: "event_msg/user_message",
          message: "Build a multi-column Codex task surface with stable identity headers and actions.",
        },
      ],
    },
  };

  assert.equal(
    multiMonitorThreadTitle(payload),
    "Build a multi-column Codex task surface with stable identity headers…",
  );
  assert.equal(multiMonitorThreadTitle({
    raw: {
      completed: [{
        eventType: "event_msg/user_message",
        message: "[layoutit/burnlist#22](https://github.com/layoutit/burnlist/pull/22)",
      }],
    },
  }), "layoutit/burnlist#22");
  assert.equal(multiMonitorThreadTitle(null, "Thread …1ce69bef"), "Thread …1ce69bef");
});
