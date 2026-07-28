import assert from "node:assert/strict";
import test from "node:test";

import { projectCodexRecord } from "./agent-monitor-event.mjs";
import {
  buildAgentMonitorSnapshot,
  coalesceAgentMonitorEvents,
  isVisibleAgentMonitorEvent,
  snapshotMonitorEvents,
} from "./agent-monitor-projection.mjs";

const NOW = "2026-07-26T12:00:00.000Z";
const identity = {
  logicalRepoKey: "111111111111",
  worktreeKey: "222222222222",
  session: "session-a",
};

function projected(payload, line = 1) {
  const record = { timestamp: NOW, type: "response_item", payload };
  const raw = JSON.stringify(record);
  return projectCodexRecord(record, line, identity.session, raw, NOW);
}

function call(name, argumentsValue = {}, line = 1) {
  return projected({
    type: "function_call",
    name,
    arguments: JSON.stringify(argumentsValue),
  }, line);
}

function snapshot(events, line = events.length) {
  return buildAgentMonitorSnapshot({
    activityAt: NOW,
    events,
    file: "session.jsonl",
    generatedAt: NOW,
    identity,
    line,
    newEvents: events,
    nowMs: Date.parse(NOW),
  });
}

test("command projection exposes a safe family while withholding raw arguments", () => {
  const event = call("exec_command", {
    cmd: "API_TOKEN=secret-value npm run verify --token secret-value",
  });
  assert.equal(event.category, "command");
  assert.equal(event.detail, "Run npm verify");
  assert.doesNotMatch(event.detail, /secret-value|API_TOKEN|--token/u);
  assert.match(event.actionKey, /^[a-f0-9]{24}$/u);
});

test("a correlated Loop node labels the monitored agent's current work", () => {
  const loop = {
    runId: "run:example",
    itemRef: "item:260727-001#B1",
    nodeId: "implement",
    attempt: 1,
    role: "maker",
    mode: "task",
    authority: "write",
    model: "gpt-5.6-sol",
    effort: "high",
  };
  const value = buildAgentMonitorSnapshot({
    activityAt: NOW,
    events: [call("exec_command", { cmd: "npm test" })],
    file: "session.jsonl",
    generatedAt: NOW,
    identity,
    line: 1,
    loop,
    newEvents: [],
    nowMs: Date.parse(NOW),
  });
  assert.equal(value.current.title, "implement · COMMAND · line 1");
  assert.deepEqual(value.monitor.loop, loop);
});

test("source inspection commands explain their target instead of naming sed or rg", () => {
  const inspect = call("exec_command", {
    cmd: [
      "sed -n '430,650p' src/title-head/playbackPacket.ts",
      "sed -n '60,140p' src/head-model/polycssScene.ts",
      "sed -n '1,130p' src/title-head/triangleHandles.ts",
    ].join("\n"),
  });
  const search = call("exec_command", {
    cmd: "rg -n \"latestFrame\\\\.animator|frame\\\\.animator|latestFrame\\\\.deformation\" tools test src | head -n 200",
  });

  assert.equal(
    inspect.detail,
    "Inspect title-head/playbackPacket.ts, head-model/polycssScene.ts, title-head/triangleHandles.ts",
  );
  assert.equal(
    search.detail,
    "Search “latestFrame.animator · frame.animator · latestFrame.deformation”",
  );
  assert.equal(call("exec_command", { cmd: "pnpm exec tsc --noEmit" }).detail, "Run TypeScript typecheck");
  assert.equal(call("exec_command", { cmd: "git diff --check -- src/example.ts" }).category, "command");
});

test("wrapped exec calls expose their nested command intent", () => {
  const command = "sed -n '1,260p' src/cssface.css; rg -n \"clean|consumer\" test/cssface-package.test.mjs";
  const event = projected({
    type: "custom_tool_call",
    name: "exec",
    input: `const r = await tools.exec_command(${JSON.stringify({
      cmd: command,
      workdir: "/workspace",
    })}); text(r.output);`,
    status: "completed",
    call_id: "call-wrapped-exec",
  });

  assert.equal(event.category, "command");
  assert.equal(
    event.detail,
    "Inspect src/cssface.css, test/cssface-package.test.mjs · search “clean · consumer”",
  );
  assert.equal(event.result, "complete");
  assert.match(event.actionKey, /^[a-f0-9]{24}$/u);
});

test("patch calls retain the exact bounded changed lines", () => {
  const event = call("apply_patch", {
    input: `*** Begin Patch
*** Update File: src/title-head/client.ts
@@
-const frame = playback.frame;
+const frame = interaction.frame;
*** End Patch`,
  });

  assert.equal(event.category, "diff");
  assert.equal(event.detail, "Patch title-head/client.ts");
  assert.deepEqual(event.patch, {
    lines: [
      "*** Update File: src/title-head/client.ts",
      "@@",
      "-const frame = playback.frame;",
      "+const frame = interaction.frame;",
    ],
    truncated: false,
  });
  assert.deepEqual(snapshot([event]).raw.completed[0].patch, event.patch);
});

test("sensitive patches are withheld before entering the persisted snapshot shape", () => {
  const secret = "lowercase-password-value";
  const event = call("apply_patch", {
    input: `*** Begin Patch
*** Add File: .env
+password = ${secret}
+-----BEGIN PRIVATE KEY-----
+${secret}
+-----END PRIVATE KEY-----
*** End Patch`,
  });
  const persisted = JSON.stringify(snapshot([event]));
  assert.equal(event.patch, null);
  assert.equal(persisted.includes(secret), false);
  assert.equal(persisted.includes("PRIVATE KEY"), false);
});

test("git diff output is attached to its originating DIFF event", () => {
  const callRecord = projected({
    type: "function_call",
    name: "exec_command",
    call_id: "call-diff",
    arguments: JSON.stringify({ cmd: "git diff -- src/title-head/client.ts" }),
  }, 1);
  const resultRecord = projected({
    type: "function_call_output",
    call_id: "call-diff",
    output: `Process exited with code 0
Output:
diff --git a/src/title-head/client.ts b/src/title-head/client.ts
--- a/src/title-head/client.ts
+++ b/src/title-head/client.ts
@@ -1 +1 @@
-const frame = playback.frame;
+const frame = interaction.frame;`,
  }, 2);
  const [event] = coalesceAgentMonitorEvents([callRecord, resultRecord]);

  assert.equal(event.category, "diff");
  assert.equal(event.result, "complete");
  assert.equal(event.patch.lines[0], "diff --git a/src/title-head/client.ts b/src/title-head/client.ts");
  assert.equal(event.patch.lines.at(-1), "+const frame = interaction.frame;");
});

test("tool results complete their originating action instead of becoming another card", () => {
  const callRecord = projected({
    type: "function_call",
    name: "exec_command",
    call_id: "call-safe",
    arguments: JSON.stringify({ cmd: "git status --short" }),
  }, 1);
  const resultRecord = projected({
    type: "function_call_output",
    call_id: "call-safe",
    output: "Process exited with code 0\nOutput:\nprivate details",
  }, 2);
  const events = coalesceAgentMonitorEvents([callRecord, resultRecord]);

  assert.equal(events.length, 1);
  assert.equal(events[0].detail, "Check Git status · done");
  assert.equal(events[0].result, "complete");
  assert.doesNotMatch(events[0].detail, /private details/u);
});

test("destructive command detection handles either recursive-force flag order", () => {
  assert.equal(call("exec_command", { cmd: "rm -rf ./fixture" }).risk, "destructive");
  assert.equal(call("exec_command", { cmd: "rm -fr ./fixture" }).risk, "destructive");
  assert.equal(call("exec_command", { cmd: "rm -r ./fixture" }).risk, null);
});

test("generic tool calls do not create a repeated-action false positive", () => {
  const events = Array.from({ length: 5 }, (_, index) => call("js", { code: `step-${index}` }));
  assert.ok(events.every((event) => event.actionKey === null));
  assert.equal(snapshot(events).monitor.summary.driftLevel, "clear");
});

test("five exact commands produce an actionable repeated-action warning", () => {
  const events = Array.from({ length: 5 }, (_, index) => call(
    "exec_command",
    { cmd: "npm run verify" },
    index + 1,
  ));
  const result = snapshot(events);
  assert.equal(result.monitor.summary.driftLevel, "watch");
  assert.equal(result.monitor.summary.drift, "WATCH · repeated action");
});

test("object tool results preserve nonzero exit failures without exposing output", () => {
  const event = projected({
    type: "function_call_output",
    output: { exit_code: 2, output: "private output" },
  });
  assert.equal(event.category, "result");
  assert.equal(event.result, "failed");
  assert.equal(event.detail, "Tool call failed");
  assert.doesNotMatch(event.detail, /private output/u);
  assert.equal(isVisibleAgentMonitorEvent(event), true);
});

test("routine envelopes are collapsed while useful conversation markers remain", () => {
  const instruction = projected({ type: "user_message", message: "private request" });
  const update = projected({ type: "agent_message", message: "Implemented the parser" });
  const messageEnvelope = projected({ type: "message", role: "assistant", content: "duplicate" });
  const successfulResult = projected({ type: "function_call_output", output: { exit_code: 0 } });

  assert.equal(instruction.detail, "New user instruction");
  assert.equal(isVisibleAgentMonitorEvent(instruction), true);
  assert.equal(isVisibleAgentMonitorEvent(update), true);
  assert.equal(isVisibleAgentMonitorEvent(messageEnvelope), false);
  assert.equal(isVisibleAgentMonitorEvent(successfulResult), false);
});

test("version 2 snapshots migrate latest-first and normalize privacy placeholders", () => {
  const events = snapshotMonitorEvents({
    monitor: { projectionVersion: 2 },
    raw: {
      completed: [
        {
          key: "newest",
          line: 4,
          time: NOW,
          category: "message",
          eventType: "event_msg/user_message",
          title: "MESSAGE · line 4",
          detail: "User message received · content withheld",
          result: "observed",
          signature: "a".repeat(64),
        },
        {
          key: "duplicate",
          line: 3,
          time: NOW,
          category: "message",
          eventType: "response_item/message",
          title: "MESSAGE · line 3",
          detail: "assistant message recorded · content withheld",
          result: "observed",
          signature: "b".repeat(64),
        },
        {
          key: "failure",
          line: 2,
          time: NOW,
          category: "result",
          eventType: "response_item/function_call_output",
          title: "RESULT · line 2",
          detail: "Tool result · failed · output withheld",
          result: "failed",
          signature: "c".repeat(64),
        },
      ],
    },
  });

  assert.deepEqual(events.map((event) => event.line), [4, 2]);
  assert.deepEqual(events.map((event) => event.detail), ["New user instruction", "Tool call failed"]);
});

test("projection retains only the latest 300 monitorable events", () => {
  const events = Array.from({ length: 360 }, (_, index) => {
    const event = projected({
      type: "agent_message",
      message: `Visible update ${index + 1}`,
    }, 360 - index);
    return event;
  });
  const hidden = projected({ type: "reasoning" }, 361);
  assert.equal(isVisibleAgentMonitorEvent(hidden), false);
  const result = snapshot([hidden, ...events], 361);
  assert.equal(result.raw.completed.length, 300);
  assert.equal(result.monitor.retained, 300);
  assert.equal(result.monitor.truncated, true);
  assert.equal(result.raw.completed[0].line, 360);
  assert.equal(result.raw.completed.at(-1).line, 61);
});
