import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentMonitorActivityChart, buildAgentMonitorActivity } from "./AgentMonitorActivityChart";

const time = (minute: number) => `2026-07-26T12:${String(minute).padStart(2, "0")}:00.000Z`;

test("activity bins preserve chronological category counts", () => {
  const activity = buildAgentMonitorActivity([
    { category: "result", result: "failed", time: time(6) },
    { category: "tool", time: time(3) },
    { category: "command", time: time(0) },
    { category: "lifecycle", time: time(4) },
    { category: "message", eventType: "event_msg/user_message", time: time(2) },
    { category: "diff", time: time(1) },
  ], 3);

  assert.deepEqual(activity.bins.map((bin) => bin.total), [2, 2, 2]);
  assert.equal(activity.bins[0].counts.command, 1);
  assert.equal(activity.bins[0].counts.diff, 1);
  assert.equal(activity.bins[1].counts.message, 1);
  assert.equal(activity.bins[1].counts.tool, 1);
  assert.equal(activity.bins[2].counts.lifecycle, 1);
  assert.equal(activity.bins[2].counts.result, 1);
  assert.equal(activity.bins[1].userMessages, 1);
  assert.equal(activity.bins[2].failures, 1);
  assert.deepEqual(activity.bins.map((bin) => bin.workTotal), [2, 1, 0]);
  assert.equal(activity.maxWork, 2);
  assert.equal(activity.total, 6);
  assert.equal(activity.durationLabel, "6m");
});

test("activity ignores invalid categories and timestamps", () => {
  const activity = buildAgentMonitorActivity([
    { category: "command", time: time(0) },
    { category: "reasoning", time: time(1) },
    { category: "tool", time: "not-a-time" },
  ]);

  assert.equal(activity.total, 1);
  assert.equal(activity.bins.length, 12);
  assert.equal(activity.bins.at(-1)?.counts.command, 1);
});

test("activity chart separates work bars from intervention and failure markers", () => {
  const events = [
    { category: "command", time: time(0) },
    { category: "diff", time: time(1) },
    { category: "tool", time: time(2) },
    { category: "message", eventType: "event_msg/user_message", time: time(3) },
    { category: "lifecycle", time: time(4) },
    { category: "result", result: "failed", time: time(5) },
  ];
  const markup = renderToStaticMarkup(createElement(AgentMonitorActivityChart, { events }));

  assert.match(markup, /Work rhythm over time/u);
  assert.match(markup, /6 retained events/u);
  assert.match(markup, /role="img"/u);
  assert.match(markup, /Agent work rhythm over time with user messages and failures/u);
  for (const category of ["command", "diff", "message", "tool", "lifecycle", "result"]) {
    assert.match(markup, new RegExp(`data-category="${category}"`, "u"));
  }
  assert.equal((markup.match(/class="agent-monitor-activity-mark"/gu) ?? []).length, 3);
  assert.match(markup, /data-signal="message"/u);
  assert.match(markup, /data-signal="failure"/u);
  assert.match(markup, /data-signal="lifecycle"/u);
});

test("activity chart has a useful empty state", () => {
  const markup = renderToStaticMarkup(createElement(AgentMonitorActivityChart, { events: [] }));
  assert.match(markup, /No timestamped monitor events yet/u);
  assert.doesNotMatch(markup, /role="img"/u);
});
