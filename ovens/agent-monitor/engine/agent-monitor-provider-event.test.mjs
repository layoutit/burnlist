import assert from "node:assert/strict";
import test from "node:test";

import {
  projectAgyRecord,
  projectClaudeRecord,
  projectGrokRecord,
} from "./agent-monitor-provider-event.mjs";

const NOW = "2026-07-27T12:00:00.000Z";
const project = (fn, value) => fn(value, 7, "provider:session", JSON.stringify(value), NOW);

test("Claude tool calls and failures normalize into the shared monitor contract", () => {
  const call = project(projectClaudeRecord, {
    type: "assistant",
    timestamp: NOW,
    message: { content: [{ type: "tool_use", id: "call-1", name: "Bash" }] },
  });
  const result = project(projectClaudeRecord, {
    type: "user",
    timestamp: NOW,
    message: { content: [{ type: "tool_result", tool_use_id: "call-1", is_error: true }] },
  });
  assert.equal(call.category, "tool");
  assert.equal(call.result, "started");
  assert.equal(result.category, "result");
  assert.equal(result.result, "failed");
});

test("Grok lifecycle and tool records normalize without provider-specific UI data", () => {
  const lifecycle = project(projectGrokRecord, { type: "turn_started", ts: NOW });
  const tool = project(projectGrokRecord, { type: "tool_started", ts: NOW, tool_name: "shell" });
  assert.equal(lifecycle.category, "lifecycle");
  assert.equal(tool.category, "tool");
  assert.match(tool.eventType, /^grok\//u);
});

test("Antigravity planner and checkpoint records normalize into visible events", () => {
  const update = project(projectAgyRecord, { type: "PLANNER_RESPONSE", created_at: NOW, content: "Implemented the adapter." });
  const checkpoint = project(projectAgyRecord, { type: "CHECKPOINT", created_at: NOW, status: "complete" });
  assert.equal(update.category, "message");
  assert.equal(checkpoint.category, "lifecycle");
  assert.equal(checkpoint.result, "complete");
});
