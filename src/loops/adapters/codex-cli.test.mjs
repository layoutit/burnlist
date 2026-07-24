import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { probeCodexCli, startCodexInvocation } from "./codex-cli.mjs";
import { resolveStageOneRoutes } from "../agents/profile.mjs";

const fakeSource = `#!/usr/bin/env node
const args = process.argv.slice(2);
const mode = process.env.FAKE_MODE || "ok";
if (mode === "hang") { process.on("SIGTERM",()=>{}); setInterval(() => {}, 1000); }
if (mode === "nonzero") { process.exit(7); }
if (mode === "bad") { process.stdout.write("not-json\\n"); process.exit(0); }
if (mode === "invalid-utf8") { process.stdout.write(Buffer.from([255,10])); process.exit(0); }
if (mode === "oversize") { process.stdout.write(Buffer.alloc(1048577,97)); process.exit(0); }
const session = mode === "same-session" ? "same" : "fresh-" + process.pid;
process.stdout.write(JSON.stringify({type:"thread.started",thread_id:session,model:args[args.indexOf("-m") + 1],version:"fake-1"})+"\\n");
process.stdout.write(JSON.stringify({type:"burnlist.capability",guarantees:{freshSession:"enforced",filesystemWriteDeny:"enforced",foregroundHandle:"enforced",cancellation:"enforced",lifecycle:"enforced"}})+"\\n");
const usage = mode === "overflow" ? {input_tokens:Number.MAX_SAFE_INTEGER,output_tokens:1} : mode === "missing-usage" ? null : {input_tokens:11,output_tokens:7,cached_input_tokens:3};
process.stdout.write(JSON.stringify(usage ? {type:"turn.completed",usage} : {type:"turn.completed"})+"\\n");
`;

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-codex-adapter-")); const binary = join(directory, "fake-codex.mjs");
  writeFileSync(binary, fakeSource, { mode: 0o700 }); chmodSync(binary, 0o700);
  return { directory, binary, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}
function profile(binary, id, authority, model = "gpt-5.6-terra", effort = "high") { return { schema: "burnlist-loop-agent-profile@1", id, adapter: "builtin:codex-cli", binary, model, effort, authority }; }
function unprovenIsolation() {
  return { guarantees: { freshSession: "unsupported", filesystemWriteDeny: "unsupported", foregroundHandle: "supervised", cancellation: "supervised", lifecycle: "unsupported" }, terminate: (child, signal) => signal === "SIGTERM" ? true : child.kill(signal), proveEmpty: async () => false };
}
function weakButEmptyIsolation() { return { ...unprovenIsolation(), proveEmpty: async () => true }; }
async function withMode(mode, fn) {
  const before = process.env.FAKE_MODE;
  try { process.env.FAKE_MODE = mode; return await fn(); }
  finally { if (before === undefined) delete process.env.FAKE_MODE; else process.env.FAKE_MODE = before; }
}

test("adapter uses exact ephemeral argv and ignores child capability claims", async () => {
  const context = fixture();
  try {
    const maker = profile(context.binary, "maker", "write");
    const result = await startCodexInvocation({ profile: maker, cwd: context.directory, prompt: "Implement." }).completion;
    assert.deepEqual(result.technicallyProven.argv.slice(1, -1), ["exec", "--json", "--ephemeral", "-m", "gpt-5.6-terra", "-c", "model_reasoning_effort=high", "-s", "workspace-write", "-C", context.directory, "--skip-git-repo-check", "--"]);
    assert.equal(result.technicallyProven.argv.at(-1), "Implement."); assert.equal(result.technicallyProven.pidObserved, true);
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7, cachedInputTokens: 3, totalTokens: 18 });

    const direct = await startCodexInvocation({ profile: profile(context.binary, "reviewer", "read"), cwd: context.directory, prompt: "Direct." }).completion;
    assert.equal(direct.outcome, "completed"); assert.equal(direct.termination.emptyProven, false);
  } finally { context.cleanup(); }
});

test("cancellation uses bounded TERM/KILL and reports a closed direct child without descendant claims", async () => {
  const context = fixture();
  try {
    await withMode("hang", async () => {
      const direct = startCodexInvocation({ profile: profile(context.binary, "maker", "write"), cwd: context.directory, prompt: "Wait.", trustedIsolation: unprovenIsolation() });
      assert.equal(direct.cancel(), true); assert.equal(direct.cancel(), false); const uncertain = await direct.completion;
      assert.equal(uncertain.outcome, "cancelled"); assert.equal(uncertain.quarantineRequired, false); assert.equal(uncertain.termination.killSent, true); assert.equal(uncertain.termination.emptyProven, false);

    });
  } finally { context.cleanup(); }
});

test("JSONL is strict UTF-8 and usage overflow or absence is unavailable", async () => {
  const context = fixture();
  try {
    assert.throws(() => startCodexInvocation({ profile: profile(join(context.directory, "missing-codex"), "maker", "write"), cwd: context.directory, prompt: "Missing." }), (error) => error.code === "ELOOP_CODEX_HANDLE");
    const maker = profile(context.binary, "maker", "write");
    await withMode("nonzero", async () => {
      const result = await startCodexInvocation({ profile: maker, cwd: context.directory, prompt: "Nonzero." }).completion;
      assert.equal(result.outcome, "failed"); assert.equal(result.exitCode, 7);
    });
    await withMode("bad", async () => assert.rejects(startCodexInvocation({ profile: maker, cwd: context.directory, prompt: "Bad." }).completion, (error) => error.code === "ELOOP_CODEX_OUTPUT"));
    await withMode("invalid-utf8", async () => assert.rejects(startCodexInvocation({ profile: maker, cwd: context.directory, prompt: "Bad bytes." }).completion, (error) => error.code === "ELOOP_CODEX_OUTPUT"));
    await withMode("oversize", async () => assert.rejects(startCodexInvocation({ profile: maker, cwd: context.directory, prompt: "Too much." }).completion, (error) => ["ELOOP_CODEX_OUTPUT_LIMIT", "ELOOP_CODEX_OUTPUT"].includes(error.code)));
    for (const mode of ["missing-usage", "overflow"]) await withMode(mode, async () => {
      const result = await startCodexInvocation({ profile: maker, cwd: context.directory, prompt: "Usage." }).completion;
      assert.equal(result.usage, null); assert.equal(result.usageStatus, "unavailable");
    });
  } finally { context.cleanup(); }
});

test("each direct reviewer invocation has a fresh foreground PID and provider session", async () => {
  const context = fixture();
  try {
    const reviewer = profile(context.binary, "reviewer", "read");
    const first = startCodexInvocation({ profile: reviewer, cwd: context.directory, prompt: "Review one." });
    const second = startCodexInvocation({ profile: reviewer, cwd: context.directory, prompt: "Review two." });
    const [left, right] = await Promise.all([first.completion, second.completion]);
    assert.notEqual(first.pid, second.pid);
    assert.notEqual(left.providerReported.sessionId, right.providerReported.sessionId);
  } finally { context.cleanup(); }
});

test("route binding requires host-enforced isolation and independent provider sessions", async () => {
  const context = fixture();
  try {
    const maker = profile(context.binary, "maker", "write"); const reviewer = profile(context.binary, "reviewer", "read", "gpt-5.6-sol", "medium");
    const weakMaker = await probeCodexCli({ profile: maker, cwd: context.directory, trustedIsolation: weakButEmptyIsolation() }); const weakReviewer = await probeCodexCli({ profile: reviewer, cwd: context.directory, trustedIsolation: weakButEmptyIsolation() });
    assert.throws(() => resolveStageOneRoutes({ profiles: [maker, reviewer], routes: { "implementation.standard": "maker", "review.strong": "reviewer" }, probes: { maker: weakMaker, reviewer: weakReviewer } }), (error) => error.code === "ELOOP_REVIEWER_ISOLATION");

    const strongMaker = await probeCodexCli({ profile: maker, cwd: context.directory });
    const strongReviewer = await probeCodexCli({ profile: reviewer, cwd: context.directory });
    assert.equal(resolveStageOneRoutes({ profiles: [maker, reviewer], routes: { "implementation.standard": "maker", "review.strong": "reviewer" }, probes: { maker: strongMaker, reviewer: strongReviewer } }).review.guarantees.filesystemWriteDeny, "supervised");

    await withMode("same-session", async () => {
      const first = await probeCodexCli({ profile: maker, cwd: context.directory });
      const second = await probeCodexCli({ profile: reviewer, cwd: context.directory });
      assert.throws(() => resolveStageOneRoutes({ profiles: [maker, reviewer], routes: { "implementation.standard": "maker", "review.strong": "reviewer" }, probes: { maker: first, reviewer: second } }), (error) => error.code === "ELOOP_REVIEWER_ISOLATION");
    });
  } finally { context.cleanup(); }
});

test("direct foreground controllers are accepted without Docker authority", async () => {
  const context = fixture();
  try {
    const direct = await startCodexInvocation({ profile: profile(context.binary, "reviewer", "read"),
      cwd: context.directory, prompt: "Fake.", trustedIsolation: {
        guarantees: { freshSession: "enforced", filesystemWriteDeny: "enforced", foregroundHandle: "enforced", cancellation: "enforced", lifecycle: "enforced" },
        terminate: () => true, proveEmpty: async () => true,
      } }).completion;
    assert.equal(direct.outcome, "completed");
  } finally { context.cleanup(); }
});
