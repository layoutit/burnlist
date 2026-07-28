#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const results = resolve(root, "results", "tool-runs");
const nestedGit = resolve(root, ".git");
const createdNestedGit = !existsSync(nestedGit);
const claudeDirectory = resolve(root, ".claude");
const claudeConfig = resolve(claudeDirectory, "settings.json");
const createdClaudeConfig = !existsSync(claudeConfig);
const token = `burnlist-tool-probe-${randomUUID()}`;
const prompt = [
  "You must use exactly one shell tool to run pwd.",
  "Do not run any other command or modify files.",
  "Then reply with exactly PROBE_TOOL_OK.",
].join(" ");

function run(command, args, environment = {}, timeout = 180_000) {
  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
      BURNLIST_PROBE_TOKEN: token,
    },
    maxBuffer: 8 * 1024 * 1024,
    timeout,
  });
  return {
    command,
    args,
    startedAt: new Date(startedAt).toISOString(),
    durationMs: Date.now() - startedAt,
    status: result.status,
    signal: result.signal,
    error: result.error?.message ?? null,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function eventFiles(provider) {
  const directory = resolve(root, "results", "events", provider);
  try {
    return readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => JSON.parse(readFileSync(resolve(directory, name), "utf8")))
      .filter((event) => event.probeEnvironmentDigest === digest)
      .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt));
  } catch {
    return [];
  }
}

rmSync(results, { recursive: true, force: true });
mkdirSync(results, { recursive: true });
if (createdClaudeConfig) {
  mkdirSync(claudeDirectory, { recursive: true });
  const temporary = `${claudeConfig}.${process.pid}.tmp`;
  writeFileSync(temporary, readFileSync(resolve(root, "fixtures", "claude-settings.json")));
  renameSync(temporary, claudeConfig);
}
if (createdNestedGit) {
  spawnSync("git", ["init", "-q"], { cwd: root });
}
const digest = await import("node:crypto").then(({ createHash }) =>
  createHash("sha256").update(token).digest("hex"));
const claudeSession = randomUUID();
const grokSession = randomUUID();
const runs = {
  codex: run("codex", [
    "exec", "--json", "--sandbox", "read-only", "--enable", "hooks",
    "--dangerously-bypass-hook-trust", prompt,
  ]),
  claude: run("claude", [
    "--print", "--output-format", "stream-json", "--verbose",
    "--allowedTools", "Bash", "--permission-mode", "bypassPermissions",
    "--session-id", claudeSession, prompt,
  ]),
  grok: run("grok", [
    "--single", prompt, "--output-format", "streaming-json",
    "--session-id", grokSession, "--trust",
  ]),
  agy: run("agy", [
    "--print", prompt, "--add-dir", root, "--mode", "accept-edits",
    "--dangerously-skip-permissions",
  ]),
};

for (const [provider, result] of Object.entries(runs)) {
  writeFileSync(resolve(results, `${provider}.stdout`), result.stdout);
  writeFileSync(resolve(results, `${provider}.stderr`), result.stderr);
}
const summary = {
  schema: "burnlist-provider-tool-probe-summary@1",
  generatedAt: new Date().toISOString(),
  expected: { claudeSession, grokSession, probeEnvironmentDigest: digest },
  providers: Object.fromEntries(Object.entries(runs).map(([provider, result]) => [
    provider,
    { ...result, stdout: undefined, stderr: undefined, events: eventFiles(provider) },
  ])),
};
writeFileSync(
  resolve(results, "summary.json"),
  `${JSON.stringify(summary, null, 2)}\n`,
);
if (createdNestedGit) rmSync(nestedGit, { recursive: true, force: true });
if (createdClaudeConfig) rmSync(claudeDirectory, { recursive: true, force: true });
console.log(resolve(results, "summary.json"));
