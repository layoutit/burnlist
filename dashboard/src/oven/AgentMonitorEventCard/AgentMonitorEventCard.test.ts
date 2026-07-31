import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { AgentMonitorEventCard } from "./AgentMonitorEventCard";

test("command cards separate identity, status, action, target, and search context", () => {
  const markup = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: {
      category: "command",
      detail: "Inspect src/cssface.css, title-head/product.css · search “clean · consumer” · done",
      line: 8434,
      result: "complete",
      time: "2026-07-26T16:34:14.659Z",
    },
  }));

  assert.match(markup, /data-category="command"/u);
  assert.match(markup, /data-result="complete"/u);
  assert.match(markup, /agent-monitor-event-type">COMMAND<\/span> · line 8434 · DONE/u);
  assert.match(markup, /data-slot="alert"/u);
  assert.match(markup, /<strong>Inspect<\/strong>/u);
  assert.match(markup, /src\/cssface\.css, title-head\/product\.css/u);
  assert.match(markup, /<strong>Search:<\/strong>/u);
  assert.match(markup, /“clean · consumer”/u);
  assert.doesNotMatch(markup, /· done/u);
});

test("message cards render safe inline Markdown without splitting prose separators", () => {
  const markup = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: {
      category: "message",
      detail: "B5 is **burned** · canonical `/` only now.",
      eventType: "response_item/agent_message",
      line: 8562,
      result: "observed",
    },
  }));

  assert.match(markup, /agent-monitor-event-type">MESSAGE<\/span> · line 8562 · OBSERVED/u);
  assert.match(markup, /data-message-role="agent"/u);
  assert.match(markup, /B5 is <strong>burned<\/strong> · canonical <code>\/<\/code> only now\./u);
  assert.doesNotMatch(markup, /\*\*burned\*\*|canonical `\/`/u);
});

test("message cards expose user and agent roles for conversation layouts", () => {
  const user = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: { category: "message", detail: "New user instruction", eventType: "event_msg/user_message" },
  }));
  const agent = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: { category: "message", detail: "Working on it.", eventType: "response_item/agent_message" },
  }));

  assert.match(user, /data-message-role="user"/u);
  assert.match(agent, /data-message-role="agent"/u);
});

test("Codex presentation renders literal thread messages and edit summaries", () => {
  const message = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: {
      presentation: "codex",
      kind: "message",
      role: "user",
      content: "the **literal** thread",
    },
  }));
  const edits = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: {
      presentation: "codex",
      kind: "edits",
      count: 1,
      additions: 3,
      removals: 2,
      files: [{ path: "dashboard/src/App.tsx", additions: 3, removals: 2 }],
    },
  }));

  assert.match(message, /class="codex-thread-event codex-message"[\s\S]*data-role="user"/u);
  assert.match(message, /the <strong>literal<\/strong> thread/u);
  assert.match(edits, /Edited 1 file/u);
  assert.match(edits, /dashboard\/src\/App\.tsx/u);
  assert.match(edits, /data-tone="add">\+3/u);
  assert.match(edits, /data-tone="remove">-2/u);
});

test("search cards keep separators inside the quoted pattern", () => {
  const markup = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: {
      category: "command",
      detail: "Search “b1ae453 · runtimeSources · producer.*source” · title-head/playbackPacket.ts · done",
      line: 8767,
      result: "complete",
    },
  }));

  assert.match(markup, /<strong>Search<\/strong> “b1ae453 · runtimeSources · producer\.\*source”/u);
  assert.match(markup, /<strong>Context:<\/strong> title-head\/playbackPacket\.ts/u);
});

test("DIFF cards show exact added and removed patch lines", () => {
  const markup = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: {
      category: "diff",
      detail: "Patch title-head/client.ts · done",
      line: 9001,
      patch: {
        lines: [
          "*** Update File: src/title-head/client.ts",
          "@@",
          "-const frame = playback.frame;",
          "+const frame = interaction.frame;",
        ],
        truncated: false,
      },
      result: "complete",
    },
  }));

  assert.match(markup, /<strong>Patch<\/strong> title-head\/client\.ts/u);
  assert.match(markup, /<details class="agent-monitor-patch" open="">/u);
  assert.match(markup, /Exact patch · 4 lines/u);
  assert.match(markup, /data-kind="remove">-const frame = playback\.frame;/u);
  assert.match(markup, /data-kind="add">\+const frame = interaction\.frame;/u);
});

test("large DIFF excerpts stay collapsed and clearly report truncation", () => {
  const markup = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: {
      category: "diff",
      detail: "Patch src/large.ts · done",
      line: 9002,
      patch: {
        lines: Array.from({ length: 25 }, (_, index) => `+line ${index}`),
        truncated: true,
      },
      result: "complete",
    },
  }));

  assert.match(markup, /<details class="agent-monitor-patch">/u);
  assert.doesNotMatch(markup, /<details class="agent-monitor-patch" open/u);
  assert.match(markup, /Patch excerpt · first 25 lines/u);
  assert.match(markup, /captured patch exceeded the monitor limit/u);
});

test("failed and running cards expose their status independently from their detail", () => {
  const failed = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: { category: "tool", detail: "Wait for running task · failed", line: 1, result: "failed" },
  }));
  const running = renderToStaticMarkup(createElement(AgentMonitorEventCard, {
    event: { category: "tool", detail: "Wait for running task · running", line: 2, result: "started" },
  }));

  assert.match(failed, /data-result="failed"[\s\S]*agent-monitor-event-type">TOOL<\/span> · line 1 · FAILED/u);
  assert.doesNotMatch(failed, /· failed/u);
  assert.match(running, /data-result="started"[\s\S]*agent-monitor-event-type">TOOL<\/span> · line 2 · RUNNING/u);
  assert.doesNotMatch(running, /· running/u);
});
