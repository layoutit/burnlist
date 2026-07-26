import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionRunAuthority, fixtureItemRef } from "../run/run-test-fixtures.mjs";
import { readOvenEvents } from "../../events/oven-event-store.mjs";
import { readLatestRunForItem } from "../run/read-projection.mjs";
import { publishNativeLoopObservation } from "./hook-observation.mjs";
import { updateHookConfigs } from "../../cli/hooks-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const cli = join(root, "bin", "burnlist.mjs");
function command(repo, args) {
  const result = spawnSync(process.execPath, [cli, "loop", ...args, "--repo", repo],
    { cwd: repo, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}
function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "loop-hook-observation-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo } = createProductionRunAuthority(join(directory, "repo"));
  const runId = JSON.parse(command(repo, ["create", fixtureItemRef])).runId;
  return { repo, runId };
}
function codexPayload(repo, event, patch = {}) {
  return {
    session_id: "codex-session", transcript_path: null, cwd: repo,
    permission_mode: "default", hook_event_name: event,
    model: "gpt-5.6-sol", turn_id: "turn-1", ...patch,
  };
}
function observe(repo, provider, payload) {
  const path = join(repo, provider === "codex" ? ".codex/hooks.json" : ".claude/settings.json");
  if (!existsSync(path))
    updateHookConfigs({ repoRoot: repo, agents: [provider], install: true });
  const config = JSON.parse(readFileSync(path, "utf8"));
  const installed = config.hooks[payload.hook_event_name].flatMap((entry) => entry.hooks)
    .find((entry) => entry.command === `burnlist hooks observe --agent ${provider}`);
  assert.ok(installed, `${provider} installed config routes ${payload.hook_event_name}`);
  const [binary, ...args] = installed.command.split(" ");
  assert.equal(binary, "burnlist");
  const result = spawnSync(process.execPath, [cli, ...args],
    { cwd: repo, encoding: "utf8", input: JSON.stringify(payload) });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
}
function nativeClaim(repo, runId, provider, payloadFor) {
  const toolUseId = `${provider}-claim-tool`;
  const toolInput = { command: `burnlist loop claim ${runId} --repo ${repo}` };
  const pre = payloadFor("PreToolUse", { tool_name: "Bash", tool_use_id: toolUseId,
    tool_input: toolInput });
  observe(repo, provider, pre);
  const execution = JSON.parse(command(repo, ["claim", runId])).execution;
  observe(repo, provider, payloadFor("PostToolUse", {
    tool_name: "Bash", tool_use_id: toolUseId, tool_input: toolInput,
    tool_response: provider === "codex"
      ? { output: JSON.stringify({ execution }), exit_code: 0 }
      : { stdout: JSON.stringify({ execution }), stderr: "", interrupted: false },
    ...(provider === "claude" ? { duration_ms: 12 } : {}),
  }));
  return execution;
}

test("native lifecycle and tool hooks publish correlated observational events", (t) => {
  const { repo, runId } = fixture(t);
  nativeClaim(repo, runId, "codex", (event, patch) => codexPayload(repo, event, patch));
  const tool = publishNativeLoopObservation({
    repoRoot: repo, provider: "codex",
    payload: codexPayload(repo, "PostToolUse", {
      tool_name: "apply_patch", tool_use_id: "tool-1",
      tool_input: { command: "*** Begin Patch\n*** Update File: src/example.mjs\n*** End Patch" },
    }),
  });
  assert.equal(tool.authority, "observational");
  assert.equal(tool.payload.model, "gpt-5.6-sol");
  assert.deepEqual(tool.payload.observedPaths, ["src/example.mjs"]);
  assert.equal(tool.payload.effort, null);
  assert.equal(tool.payload.inputTokens, null);
  assert.doesNotMatch(JSON.stringify(tool), /codex-session|claimId|invocationId|dispatchAuthority/u);

  const projection = readLatestRunForItem({ repoRoot: repo, itemRef: fixtureItemRef });
  assert.equal(projection.runId, runId);
  assert.equal(projection.currentNode, "implement");
  assert.equal(projection.activity.hooks, "available");
  assert.ok(projection.activity.records.some((entry) =>
    entry.kind === "tool-finished" && entry.observedPaths[0] === "src/example.mjs"));
});

test("Claude facts retain exposed effort and usage while missing fields stay null", (t) => {
  const { repo, runId } = fixture(t);
  const claudePayload = (event, patch = {}) => ({
    session_id: "claude-session", transcript_path: join(repo, "transcript.jsonl"),
    cwd: repo, permission_mode: "default", hook_event_name: event,
    prompt_id: "prompt-1", ...patch,
  });
  nativeClaim(repo, runId, "claude", claudePayload);
  const event = publishNativeLoopObservation({
    repoRoot: repo, provider: "claude",
    payload: claudePayload("PostToolUse", {
      effort: { level: "xhigh" }, tool_name: "Agent",
      tool_use_id: "tool-agent-1", tool_input: {},
      tool_response: {
        resolvedModel: "claude-sonnet-4-6",
        usage: { input_tokens: 8320, output_tokens: 412 },
      },
    }),
  });
  assert.equal(event.payload.model, "claude-sonnet-4-6");
  assert.equal(event.payload.effort, "xhigh");
  assert.equal(event.payload.inputTokens, 8320);
  assert.equal(event.payload.outputTokens, 412);
  const records = readLatestRunForItem({ repoRoot: repo, itemRef: fixtureItemRef }).activity.records;
  const observed = records.find((entry) => entry.tool === "Agent");
  assert.deepEqual({
    model: observed.model, effort: observed.effort,
    inputTokens: observed.inputTokens, outputTokens: observed.outputTokens,
  }, {
    model: "claude-sonnet-4-6", effort: "xhigh",
    inputTokens: 8320, outputTokens: 412,
  });
  assert.equal(readOvenEvents(repo, { ovenIds: ["checklist"], limit: 100 })
    .filter((entry) => entry.payload?.runId === runId).length, 2,
  "claim PostToolUse and Agent PostToolUse publish through the native session binding");
});

test("hook replay cannot report outcomes or advance canonical Run state", (t) => {
  const { repo, runId } = fixture(t);
  nativeClaim(repo, runId, "codex", (event, patch) => codexPayload(repo, event, patch));
  const payload = codexPayload(repo, "SubagentStop", {
    agent_id: "agent-1", agent_type: "worker", outcome: "complete",
  });
  const first = publishNativeLoopObservation({ repoRoot: repo, provider: "codex", payload });
  const second = publishNativeLoopObservation({ repoRoot: repo, provider: "codex", payload });
  assert.equal(first.eventId, second.eventId);
  assert.equal(Object.hasOwn(first.payload, "outcome"), false);
  assert.equal(JSON.parse(command(repo, ["status", runId])).currentNode, "implement");
  command(repo, ["submit", runId, "--outcome", "complete"]);
  assert.equal(publishNativeLoopObservation({
    repoRoot: repo, provider: "codex",
    payload: codexPayload(repo, "PostToolUse", {
      tool_name: "Bash", tool_use_id: "late-tool", tool_input: {},
    }),
  }), null);
});

test("an unmatched singleton session cannot claim the only live Loop context", (t) => {
  const { repo, runId } = fixture(t);
  nativeClaim(repo, runId, "codex", (event, patch) =>
    codexPayload(repo, event, { session_id: "matched-session", ...patch }));
  assert.equal(publishNativeLoopObservation({
    repoRoot: repo, provider: "codex",
    payload: codexPayload(repo, "SessionStart", {
      session_id: "unmatched-session", source: "startup",
    }),
  }), null);
  const before = readOvenEvents(repo, { ovenIds: ["checklist"], limit: 100 })
    .filter((entry) => entry.payload?.runId === runId).length;
  const matched = publishNativeLoopObservation({
    repoRoot: repo, provider: "codex",
    payload: codexPayload(repo, "SessionStart", {
      session_id: "matched-session", source: "startup",
    }),
  });
  assert.equal(matched.payload.runId, runId);
  assert.equal(readOvenEvents(repo, { ovenIds: ["checklist"], limit: 100 })
    .filter((entry) => entry.payload?.runId === runId).length, before + 1);
  assert.equal(publishNativeLoopObservation({
    repoRoot: repo, provider: "codex",
    payload: codexPayload(repo, "PostToolUse", {
      session_id: "unmatched-session", tool_name: "Bash", tool_use_id: "wrong-correlation",
      tool_input: { command: "git status --short" }, tool_response: { output: "", exit_code: 0 },
    }),
  }), null);
});

test("providers without a verified native hook contract are unsupported", (t) => {
  const { repo } = fixture(t);
  assert.equal(publishNativeLoopObservation({
    repoRoot: repo, provider: "agy",
    payload: { session_id: "session", hook_event_name: "SessionStart" },
  }), null);
  assert.equal(publishNativeLoopObservation({
    repoRoot: repo, provider: "grok",
    payload: { session_id: "session", hook_event_name: "SessionStart" },
  }), null);
});
