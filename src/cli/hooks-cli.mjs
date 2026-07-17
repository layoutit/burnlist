#!/usr/bin/env node
import { hookConfigStatus, updateHookConfigs } from "./hooks-config.mjs";

const tokens = process.argv.slice(2);
if (tokens[0] === "hooks") tokens.shift();
const subcommand = tokens.shift() ?? "status";

function fail(message) { console.error(`burnlist hooks: ${message}`); process.exitCode = 2; }
function agents(values) {
  const names = values ?? "codex,claude";
  const result = names.split(",").filter(Boolean);
  if (!result.length || result.some((name) => !["codex", "claude"].includes(name))) throw new Error("--agent must be codex, claude, or a comma-separated pair");
  return [...new Set(result)];
}
function parse() {
  let requestedAgents;
  let untracked = false;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "--agent") requestedAgents = tokens[++index];
    else if (tokens[index] === "--untracked") untracked = true;
    else throw new Error(`unexpected argument: ${tokens[index]}`);
  }
  return { agents: agents(requestedAgents), untracked };
}
function print(result, { install = false } = {}) {
  for (const entry of result) {
    const shared = entry.mode === "tracked" ? "shared with the team; info/exclude cannot hide tracked config" : entry.excluded ? "local (listed in .git/info/exclude)" : "local (not listed in .git/info/exclude)";
    console.log(`${entry.agent}: ${entry.state ?? (entry.installed ? "installed" : "none")}; ${shared}; config ${entry.path}`);
    const capability = entry.capability;
    console.log(`${entry.agent} cli: ${capability.state}${capability.minimumVersion ? ` (needs >= ${capability.minimumVersion})` : ""}`);
    if (install && capability.state === "installed-but-hooks-unsupported") console.warn(`${entry.agent}: hooks were configured but this installed CLI cannot run them.`);
    if (entry.forcedUntracked) console.warn(`${entry.agent}: --untracked cannot hide an already tracked config.`);
  }
}
try {
  if (["--help", "-h"].includes(subcommand) || tokens.includes("--help") || tokens.includes("-h")) console.log("Usage: burnlist hooks <install|uninstall|status> [--agent codex,claude] [--untracked]");
  else {
    const options = parse();
    if (subcommand === "install") print(updateHookConfigs({ ...options, install: true }), { install: true });
    else if (subcommand === "uninstall") {
      const result = updateHookConfigs({ ...options, install: false });
      print(result);
      if (result.every((entry) => !entry.removed)) console.log("Burnlist: nothing installed to remove.");
    }
    else if (subcommand === "status") print(hookConfigStatus(options));
    else fail(`unknown subcommand \"${subcommand}\"`);
  }
} catch (error) { console.error(`burnlist hooks: ${error.message}`); process.exitCode = 1; }
