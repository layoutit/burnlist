#!/usr/bin/env node
import { captureStreamingDiff } from "../../ovens/streaming-diff/engine/streaming-diff-feed-capture.mjs";
import { ensureStreamingDiffFeed } from "../../ovens/streaming-diff/engine/streaming-diff-ensure-feed.mjs";
import { resolveStreamingDiffIdentity } from "../../ovens/streaming-diff/engine/streaming-diff-feed.mjs";

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
    if (!value || value.startsWith("--")) fail(`${token} requires a value.`, 2);
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
  burnlist streaming-diff capture --session <id> --tool-use-id <id> --phase <pre|post> [--path <repo-path> ...]
  burnlist streaming-diff url --session <id>

The producer writes only under the logical repository's ignored .local state.
Capture is intentionally hook-adapter-neutral; agent hook installation lands later.`;

try {
  if (subcommand === "help" || tokens.includes("--help") || tokens.includes("-h")) {
    console.log(HELP);
    process.exit(0);
  }
  const flags = parseFlags(tokens);
  if (subcommand === "ensure-feed") {
    const session = one(flags, "session", { required: true });
    if ([...flags.keys()].some((key) => key !== "session")) fail("ensure-feed accepts only --session.", 2);
    const result = ensureStreamingDiffFeed({ session });
    console.log(`Feed: ${result.identity.feedDir}`);
    console.log(`Binding: ${result.binding.created ? "created" : "existing"} (${result.binding.binding.path})`);
    process.exit(0);
  }
  if (subcommand === "capture") {
    const session = one(flags, "session", { required: true });
    const toolUseId = one(flags, "tool-use-id", { required: true });
    const phase = one(flags, "phase", { required: true });
    if ([...flags.keys()].some((key) => !["session", "tool-use-id", "phase", "path"].includes(key))) fail("capture received an unsupported option.", 2);
    if (phase !== "pre" && phase !== "post") fail("--phase must be pre or post.", 2);
    const result = captureStreamingDiff({ session, toolUseId, phase, hintedPaths: flags.get("path") ?? [] });
    if (result.error) fail(result.error.message);
    if (phase === "pre") console.log(`Snapshot: ${result.snapshot.path}`);
    else console.log(`Card: ${result.card.revId} (${result.card.status})`);
    process.exit(0);
  }
  if (subcommand === "url") {
    const session = one(flags, "session", { required: true });
    if ([...flags.keys()].some((key) => key !== "session")) fail("url accepts only --session.", 2);
    const identity = resolveStreamingDiffIdentity({ session });
    console.log(`/ovens/streaming-diff/view?repoKey=${encodeURIComponent(identity.logicalRepoKey)}&worktreeKey=${encodeURIComponent(identity.worktreeKey)}&session=${encodeURIComponent(identity.session)}`);
    process.exit(0);
  }
  fail(`unknown subcommand "${subcommand}". Run \`burnlist streaming-diff help\`.`, 2);
} catch (error) {
  fail(error.message);
}
