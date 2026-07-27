#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const passive = readJson("results/summary.json");
const tools = readJson("results/tool-runs/summary.json");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function jsonLines(path) {
  return readFileSync(resolve(root, path), "utf8")
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
}

function ownEvents(summary, provider) {
  const digest = summary.expected.probeEnvironmentDigest;
  return summary.providers[provider].events.filter((event) =>
    event.provider === provider
    && event.probeEnvironmentDigest === digest
    && (provider !== "claude" || !event.nativeEnvironment.GROK_SESSION_ID));
}

for (const summary of [passive, tools]) {
  for (const [provider, result] of Object.entries(summary.providers)) {
    assert.equal(result.status, 0, `${provider} exited successfully`);
    assert.ok(ownEvents(summary, provider).length > 0, `${provider} emitted hooks`);
    assert.ok(
      ownEvents(summary, provider).every((event) =>
        event.probeEnvironmentPresent
        && event.probeEnvironmentDigest === summary.expected.probeEnvironmentDigest),
      `${provider} hooks inherited the launch environment`,
    );
  }
}

const codexThread = jsonLines("results/tool-runs/codex.stdout")
  .find((entry) => entry.type === "thread.started")?.thread_id;
const codexEvents = ownEvents(tools, "codex");
assert.equal(codexEvents[0].payload.session_id, codexThread);
assert.deepEqual(
  codexEvents.filter((event) =>
    ["PreToolUse", "PostToolUse"].includes(event.configuredEvent))
    .map((event) => event.payload.tool_use_id),
  [codexEvents[1].payload.tool_use_id, codexEvents[1].payload.tool_use_id],
);
assert.equal(codexEvents[1].payload.tool_input.command, "pwd");

const claudeEvents = ownEvents(tools, "claude");
assert.ok(claudeEvents.every((event) =>
  event.payload.session_id === tools.expected.claudeSession));
assert.deepEqual(
  claudeEvents.filter((event) =>
    ["PreToolUse", "PostToolUse"].includes(event.configuredEvent))
    .map((event) => event.payload.tool_use_id),
  [claudeEvents[1].payload.tool_use_id, claudeEvents[1].payload.tool_use_id],
);
assert.equal(claudeEvents[1].payload.tool_input.command, "pwd");

const grokEvents = ownEvents(tools, "grok");
assert.ok(grokEvents.every((event) =>
  event.payload.sessionId === tools.expected.grokSession));
const grokEnd = jsonLines("results/tool-runs/grok.stdout")
  .find((entry) => entry.type === "end");
assert.equal(grokEnd?.sessionId, tools.expected.grokSession);
assert.equal(grokEvents[1].payload.toolUseId, grokEvents[2].payload.toolUseId);
assert.equal(grokEvents[1].payload.toolInput.command, "pwd");
const grokClaudeCompatibility = tools.providers.claude.events.filter((event) =>
  event.nativeEnvironment.GROK_SESSION_ID === tools.expected.grokSession);
assert.ok(grokClaudeCompatibility.length >= 3, "Grok also loaded Claude hooks");

const agyEvents = ownEvents(tools, "agy");
const agyIds = new Set(agyEvents.map((event) => event.payload.conversationId));
assert.equal(agyIds.size, 1);
const [agyId] = agyIds;
assert.ok(agyEvents.every((event) =>
  event.payload.workspacePaths?.includes(root)
  && event.payload.transcriptPath?.includes(agyId)));
const agyTool = agyEvents.find((event) =>
  event.payload.toolCall?.name === "run_command");
assert.equal(agyTool?.payload.toolCall.args.CommandLine, "pwd");

console.log("PASS: Codex direct-learn identity and tool hooks");
console.log("PASS: Claude direct-set identity and tool hooks");
console.log("PASS: Grok direct-set identity and tool hooks");
console.log("PASS: AGY workspace identity and invocation/tool hooks");
console.log("OBSERVED: Grok also executes compatible Claude project hooks");
