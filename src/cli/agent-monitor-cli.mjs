#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { realpathSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import {
  agentMonitorPidPath,
  ensureAgentMonitorFeedRoot,
  readAgentMonitorJson,
  resolveAgentMonitorIdentity,
  writeAgentMonitorJson,
} from "../../ovens/agent-monitor/engine/agent-monitor-feed.mjs";
import { runAgentMonitorOnce } from "../../ovens/agent-monitor/engine/agent-monitor-producer.mjs";
import { resolveUmbrella } from "./umbrella.mjs";
import { repoKey } from "../server/registry.mjs";

const tokens = process.argv.slice(2);
if (tokens[0] === "agent-monitor") tokens.shift();
const subcommand = tokens.shift() ?? "help";

const HELP = `burnlist agent-monitor — publish one feed per exact Codex thread

Usage:
  burnlist agent-monitor start [--repo <path>] [--session-root <path>] [--interval-ms <ms>]
  burnlist agent-monitor stop [--repo <path>]
  burnlist agent-monitor status [--repo <path>]
  burnlist agent-monitor run [--repo <path>] [--session-root <path>]
  burnlist agent-monitor url [--repo <path>] [--session <id>]

The producer discovers recent Codex sessions by their recorded repository cwd.
The bare Oven route auto-opens one feed or lists exact sessions when several exist.
Codex integrations pass their exact thread id to url --session; Burnlist never
guesses a current thread.`;

function fail(message, status = 1) {
  console.error(`burnlist agent-monitor: ${message}`);
  process.exit(status);
}

function parseFlags(values) {
  const flags = new Map();
  for (let index = 0; index < values.length; index += 2) {
    const name = values[index];
    const value = values[index + 1];
    if (!name?.startsWith("--") || value === undefined || value === "") {
      fail(`invalid option near ${name ?? "end of input"}`, 2);
    }
    const key = name.slice(2);
    if (flags.has(key)) fail(`${name} may only be supplied once`, 2);
    flags.set(key, value);
  }
  return flags;
}

function allowed(flags, names) {
  const unknown = [...flags.keys()].find((name) => !names.includes(name));
  if (unknown) fail(`unsupported option --${unknown}`, 2);
}

function logicalRepoRoot(value = process.cwd()) {
  return realpathSync(resolveUmbrella(resolve(value)));
}

function producerOptions(flags) {
  return {
    repoRoot: logicalRepoRoot(flags.get("repo")),
    sessionRoot: resolve(flags.get("session-root") ?? join(homedir(), ".codex", "sessions")),
  };
}

function alive(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

function ownsProcess(state) {
  if (!alive(state?.pid) || typeof state?.token !== "string") return false;
  const result = spawnSync("ps", ["-p", String(state.pid), "-o", "command="], {
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 2_000,
  });
  return result.status === 0
    && result.stdout.includes("agent-monitor")
    && result.stdout.includes(state.token);
}

function routeFor(root) {
  return `/r/${encodeURIComponent(repoKey(root))}/o/agent-monitor`;
}

function sessionRouteFor(root, session) {
  const resolved = resolveAgentMonitorIdentity({ cwd: process.cwd(), session });
  if (resolved.logicalRepoRoot !== root) {
    throw new Error("Agent Monitor thread does not belong to the selected repository");
  }
  return `${routeFor(root)}?${new URLSearchParams({
    worktreeKey: resolved.identity.worktreeKey,
    session: resolved.identity.session,
  })}`;
}

function pidState(root) {
  return readAgentMonitorJson(agentMonitorPidPath(root));
}

function writePid(root, value) {
  writeAgentMonitorJson(agentMonitorPidPath(root), value);
}

function start(flags) {
  allowed(flags, ["repo", "session-root", "interval-ms"]);
  const options = producerOptions(flags);
  ensureAgentMonitorFeedRoot(options.repoRoot);
  const prior = pidState(options.repoRoot);
  if (ownsProcess(prior)) {
    console.log(`Agent Monitor already running (pid ${prior.pid}).`);
    console.log(routeFor(options.repoRoot));
    return;
  }
  const intervalMs = Math.max(500, Number(flags.get("interval-ms") ?? 2_000) || 2_000);
  const token = randomBytes(16).toString("hex");
  const childArgs = [
    process.argv[1], "agent-monitor", "watch",
    "--repo", options.repoRoot,
    "--session-root", options.sessionRoot,
    "--interval-ms", String(intervalMs),
    "--token", token,
  ];
  const child = spawn(process.execPath, childArgs, {
    cwd: options.repoRoot,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  writePid(options.repoRoot, {
    pid: child.pid,
    token,
    status: "starting",
    startedAt: new Date().toISOString(),
    repoRoot: options.repoRoot,
  });
  console.log(`Started Agent Monitor (pid ${child.pid}).`);
  console.log(routeFor(options.repoRoot));
}

function stop(flags) {
  allowed(flags, ["repo"]);
  const root = logicalRepoRoot(flags.get("repo"));
  const path = agentMonitorPidPath(root);
  const state = pidState(root);
  const running = ownsProcess(state);
  if (running) process.kill(state.pid, "SIGTERM");
  rmSync(path, { force: true });
  console.log(running ? "Stopping Agent Monitor." : "Agent Monitor was not running.");
}

function status(flags) {
  allowed(flags, ["repo"]);
  const root = logicalRepoRoot(flags.get("repo"));
  const state = pidState(root);
  if (!ownsProcess(state)) {
    console.log("Agent Monitor: stopped");
    return;
  }
  console.log(`Agent Monitor: ${state.status ?? "running"} (pid ${state.pid})`);
  if (state.lastCycleAt) console.log(`Last cycle: ${state.lastCycleAt} · ${state.scanned ?? 0} feeds scanned · ${state.changed ?? 0} changed`);
  if (state.lastError) console.log(`Last error: ${state.lastError}`);
  console.log(routeFor(root));
}

function run(flags) {
  allowed(flags, ["repo", "session-root"]);
  const result = runAgentMonitorOnce(producerOptions(flags));
  console.log(`Scanned ${result.scanned} session feed(s); published ${result.changed}.`);
  for (const error of result.errors) console.error(`${error.session}: ${error.error}`);
  if (result.errors.length) process.exitCode = 1;
}

async function watch(flags) {
  allowed(flags, ["repo", "session-root", "interval-ms", "token"]);
  const options = producerOptions(flags);
  const token = flags.get("token");
  if (!token || !/^[a-f0-9]{32}$/u.test(token)) fail("watch requires an internal producer token", 2);
  const intervalMs = Math.max(500, Number(flags.get("interval-ms") ?? 2_000) || 2_000);
  const preparedRoot = ensureAgentMonitorFeedRoot(options.repoRoot).logicalRepoRoot;
  let stopping = false;
  const halt = () => { stopping = true; };
  process.once("SIGTERM", halt);
  process.once("SIGINT", halt);
  const startedAt = new Date().toISOString();
  while (!stopping) {
    const state = { pid: process.pid, token, status: "running", startedAt, repoRoot: options.repoRoot };
    try {
      const result = runAgentMonitorOnce({ ...options, preparedRoot });
      writePid(options.repoRoot, {
        ...state,
        lastCycleAt: new Date().toISOString(),
        scanned: result.scanned,
        changed: result.changed,
        errors: result.errors.length,
        ...(result.errors[0] ? { lastError: result.errors[0].error } : {}),
      });
    } catch (error) {
      writePid(options.repoRoot, {
        ...state,
        status: "degraded",
        lastCycleAt: new Date().toISOString(),
        lastError: error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500),
      });
    }
    if (!stopping) await new Promise((resolveWait) => setTimeout(resolveWait, intervalMs));
  }
  const current = pidState(options.repoRoot);
  if (current?.pid === process.pid && current?.token === token) rmSync(agentMonitorPidPath(options.repoRoot), { force: true });
}

try {
  if (subcommand === "help" || tokens.includes("--help") || tokens.includes("-h")) console.log(HELP);
  else {
    const flags = parseFlags(tokens);
    if (subcommand === "start") start(flags);
    else if (subcommand === "stop") stop(flags);
    else if (subcommand === "status") status(flags);
    else if (subcommand === "run") run(flags);
    else if (subcommand === "url") {
      allowed(flags, ["repo", "session"]);
      const root = logicalRepoRoot(flags.get("repo"));
      const session = flags.get("session");
      console.log(session ? sessionRouteFor(root, session) : routeFor(root));
    } else if (subcommand === "watch") await watch(flags);
    else fail(`unknown subcommand "${subcommand}"`, 2);
  }
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
