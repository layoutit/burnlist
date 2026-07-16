#!/usr/bin/env node
import { captureStreamingDiff } from "../../ovens/streaming-diff/engine/streaming-diff-feed-capture.mjs";
import { ensureStreamingDiffFeed } from "../../ovens/streaming-diff/engine/streaming-diff-ensure-feed.mjs";
import { resolveStreamingDiffIdentity } from "../../ovens/streaming-diff/engine/streaming-diff-feed.mjs";
import { mapStreamingDiffHook } from "../../ovens/streaming-diff/engine/streaming-diff-hook-adapters.mjs";
import { execFile } from "node:child_process";

const tokens = process.argv.slice(2);
if (tokens[0] === "streaming-diff") tokens.shift();
const subcommand = tokens.shift() ?? "help";

function fail(message, status = 1) {
  console.error(`burnlist streaming-diff: ${message}`);
  process.exit(status);
}

function parseFlags(values) {
  const flags = new Map();
  for (let index = 0; index < values.length; index += 1) {
    const token = values[index];
    if (!token.startsWith("--")) fail(`unexpected argument: ${token}`, 2);
    const name = token.slice(2);
    const value = values[index + 1];
    // Values occupy the slot immediately following their flag, so a filename
    // such as --path is data, never a second flag.
    if (value === undefined || value === "") fail(`${token} requires a value.`, 2);
    const entries = flags.get(name) ?? [];
    entries.push(value);
    flags.set(name, entries);
    index += 1;
  }
  return flags;
}

function one(flags, name, { required = false } = {}) {
  const values = flags.get(name) ?? [];
  if (values.length > 1) fail(`--${name} may only be supplied once.`, 2);
  if (required && values.length === 0) fail(`--${name} is required.`, 2);
  return values[0];
}

const HELP = `burnlist streaming-diff — write a bounded, session-scoped diff feed

Usage:
  burnlist streaming-diff ensure-feed --session <id>
  burnlist streaming-diff capture --session <id> --tool-use-id <id> --phase <pre|post> [--terminal-reason <reason>] [--path <repo-path> ...]
  burnlist streaming-diff url --session <id>
  burnlist streaming-diff hook --agent <codex|claude> --event <ensure|pre|post|failure>

The producer writes only under the logical repository's ignored .local state.
Hook adapters always return success so an agent hook cannot block the agent.`;

const MAX_HOOK_PAYLOAD_BYTES = 256 * 1024;
const HOOK_CAPTURE_TIMEOUT_MS = 2_000;
const HOOK_STDIN_TIMEOUT_MS = 750;

function readStdinCapped(limit) {
  return new Promise((resolveRead) => {
    const chunks = [];
    let bytes = 0;
    let settled = false;
    const finish = (text, degradedReason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      process.stdin.off("error", onError);
      resolveRead({ text, degradedReason });
    };
    const stop = (reason) => {
      finish(null, reason);
      try { process.stdin.destroy(); } catch { /* The hook must remain advisory. */ }
    };
    const onData = (chunk) => {
      bytes += chunk.length;
      if (bytes > limit) return stop("hook payload exceeded byte limit");
      chunks.push(Buffer.from(chunk));
    };
    const onEnd = () => finish(Buffer.concat(chunks, bytes).toString("utf8"));
    const onError = () => finish(null, "hook payload was incomplete");
    const timer = setTimeout(() => stop("hook payload read timed out"), HOOK_STDIN_TIMEOUT_MS);
    process.stdin.on("data", onData);
    process.stdin.once("end", onEnd);
    process.stdin.once("error", onError);
    process.stdin.resume();
  });
}

async function hookPayload() {
  const fromEnvironment = process.env.BURNLIST_HOOK_PAYLOAD ?? process.env.CODEX_HOOK_PAYLOAD ?? process.env.CLAUDE_HOOK_PAYLOAD;
  const input = fromEnvironment === undefined
    ? await readStdinCapped(MAX_HOOK_PAYLOAD_BYTES).catch(() => ({ text: null, degradedReason: "hook payload was incomplete" }))
    : { text: fromEnvironment };
  const { text } = input;
  if (text === null) return { payload: {}, degradedReason: input.degradedReason ?? "hook payload was incomplete" };
  if (Buffer.byteLength(text, "utf8") > MAX_HOOK_PAYLOAD_BYTES) return { payload: {}, degradedReason: "hook payload exceeded byte limit" };
  if (!text?.trim()) return { payload: {}, degradedReason: "missing hook payload" };
  try {
    const payload = JSON.parse(text);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { payload: {}, degradedReason: "hook payload was not an object" };
    return { payload };
  } catch { return { payload: {}, degradedReason: "hook payload was invalid" }; }
}

function parseHookFlags(values) {
  const flags = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const token = values[index];
    const value = values[index + 1];
    if (!token?.startsWith("--") || !value || value.startsWith("--")) return null;
    flags.set(token.slice(2), value);
  }
  return flags;
}

function runHookCapture(args) {
  return new Promise((resolve) => {
    execFile(process.execPath, [process.argv[1], "streaming-diff", ...args], {
      cwd: process.cwd(),
      env: process.env,
      shell: false,
      timeout: HOOK_CAPTURE_TIMEOUT_MS,
      maxBuffer: 64 * 1024,
    }, () => resolve());
  });
}

function withTerminalReason(args, reason) {
  if (!reason) return args;
  const index = args.indexOf("--terminal-reason");
  if (index === -1) return [...args, "--terminal-reason", "adapter-incomplete"];
  return args;
}

function incompleteHookCapture(event, reason) {
  if (!["pre", "post", "failure"].includes(event)) return null;
  return {
    action: "capture",
    args: ["capture", "--session", "unknown-session", "--tool-use-id", "unknown-tool-use", "--phase", event === "pre" ? "pre" : "post", "--terminal-reason", reason.includes("byte limit") ? "payload-too-large" : reason.includes("timed out") ? "payload-read-timed-out" : "adapter-incomplete"],
    degraded: true,
  };
}

async function main() {
try {
  if (subcommand === "help" || tokens.includes("--help") || tokens.includes("-h")) {
    console.log(HELP);
    return;
  }
  if (subcommand === "hook") {
    const flags = parseHookFlags(tokens);
    const agent = flags?.get("agent");
    const event = flags?.get("event");
    if (!agent || !event || [...flags.keys()].some((key) => !["agent", "event"].includes(key))) return;
    try {
      const input = await hookPayload();
      const mapped = input.degradedReason
        ? incompleteHookCapture(event, input.degradedReason)
        : mapStreamingDiffHook({ agent, event, payload: input.payload, cwd: process.cwd() });
      if (mapped?.action === "ensure-feed" || mapped?.action === "capture") {
        await runHookCapture(withTerminalReason(mapped.args, mapped.degraded ? mapped.terminalReason ?? "adapter-incomplete" : undefined));
      }
    } catch { /* Hooks are advisory and must never block their host agent. */ }
    return;
  }
  const flags = parseFlags(tokens);
  if (subcommand === "ensure-feed") {
    const session = one(flags, "session", { required: true });
    if ([...flags.keys()].some((key) => key !== "session")) fail("ensure-feed accepts only --session.", 2);
    const result = ensureStreamingDiffFeed({ session });
    console.log(`Feed: ${result.identity.feedDir}`);
    console.log(`Binding: ${result.binding.created ? "created" : "existing"} (${result.binding.binding.path})`);
    return;
  }
  if (subcommand === "capture") {
    const session = one(flags, "session", { required: true });
    const toolUseId = one(flags, "tool-use-id", { required: true });
    const phase = one(flags, "phase", { required: true });
    if ([...flags.keys()].some((key) => !["session", "tool-use-id", "phase", "path", "terminal-reason"].includes(key))) fail("capture received an unsupported option.", 2);
    if (phase !== "pre" && phase !== "post") fail("--phase must be pre or post.", 2);
    const result = captureStreamingDiff({ session, toolUseId, phase, hintedPaths: flags.get("path") ?? [], terminalReason: one(flags, "terminal-reason") });
    if (result.error) fail(result.error.message);
    if (phase === "pre") console.log(`Snapshot: ${result.snapshot.path}`);
    else console.log(`Card: ${result.card.revId} (${result.card.status})`);
    return;
  }
  if (subcommand === "url") {
    const session = one(flags, "session", { required: true });
    if ([...flags.keys()].some((key) => key !== "session")) fail("url accepts only --session.", 2);
    const identity = resolveStreamingDiffIdentity({ session });
    console.log(`/ovens/streaming-diff/view?repoKey=${encodeURIComponent(identity.logicalRepoKey)}&worktreeKey=${encodeURIComponent(identity.worktreeKey)}&session=${encodeURIComponent(identity.session)}`);
    return;
  }
  fail(`unknown subcommand "${subcommand}". Run \`burnlist streaming-diff help\`.`, 2);
} catch (error) {
  fail(error.message);
}
}

await main();
