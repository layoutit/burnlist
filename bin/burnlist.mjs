#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { runSkillsInstallCli } from "../src/cli/skills-install-cli.mjs";

const args = process.argv.slice(2);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const knownSubcommands = new Set([
  "install",
  "uninstall",
  "differential-testing",
  "streaming-diff",
  "hooks",
  "oven",
  "new",
  "show",
  "ready",
  "start",
  "close",
  "burn",
  "loop",
  "agent",
  "route",
  "register",
  "unregister",
  "roots",
  "init",
]);

function printSkillUsage(command) {
  const usage = command === "install"
    ? "Usage: burnlist install [--global] [--commit] [--force] [--agent codex,claude] [--dry-run]"
    : "Usage: burnlist uninstall [--global] [--agent codex,claude] [--dry-run] [--purge]";
  console.log(`${usage}\n\nInstall and remove Burnlist-managed agent skills for Codex and Claude.`);
}

async function main() {
if (args[0] === "install" || args[0] === "uninstall") {
  if (args.includes("--help") || args.includes("-h")) {
    printSkillUsage(args[0]);
    return;
  }
  process.exitCode = runSkillsInstallCli({ args, packageRoot });
  return;
}

if (args[0] === "differential-testing" && args[1] === "schema") {
  console.log(resolve(packageRoot, "ovens", "differential-testing", "engine", "data.schema.json"));
  return;
}

if (args[0] === "differential-testing" && args[1] === "sdk") {
  console.log(resolve(packageRoot, "ovens", "differential-testing", "engine", "adapter-sdk.mjs"));
  return;
}

if (args[0] === "differential-testing" && ["validate", "validate-bundle"].includes(args[1])) {
  if (!args[2]) {
    console.error(`Usage: burnlist differential-testing ${args[1]} <differential-testing.json>`);
    process.exit(2);
  }
  try {
    const path = resolve(process.cwd(), args[2]);
    const document = JSON.parse(readFileSync(path, "utf8"));
    if (document?.schema === "burnlist-differential-testing-bundle@1") {
      const { assertDifferentialTestingBundle } = await import("../ovens/differential-testing/engine/transport.mjs");
      const bundle = assertDifferentialTestingBundle(path);
      console.log(`Valid Differential Testing bundle: ${bundle.scenarios.length} scenarios; selected ${bundle.selectedScenarioId ?? "none"}.`);
    } else {
      const { assertDifferentialTestingData } = await import("../ovens/differential-testing/engine/data-contract.mjs");
      assertDifferentialTestingData(document);
      const sampleCount = document.fields.reduce((total, field) => total + field.sampleCount, 0);
      console.log(`Valid Differential Testing data: ${document.fields.length} fields, ${sampleCount} samples, ${document.summary.frames.uniqueTicks} aligned ticks.`);
    }
    return;
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (args[0] && !args[0].startsWith("--") && !["-h", "-v"].includes(args[0]) && !knownSubcommands.has(args[0])) {
  console.error(`Unknown command: ${args[0]}`);
  process.exit(2);
}

if (!["oven", "hooks", "loop", "agent", "route"].includes(args[0]) && (args.includes("--help") || args.includes("-h"))) {
  console.log(`Burnlist

Usage:
  burnlist [--port <port>] [--scan-root <repo[,repo...]>]
  burnlist --plan <burnlist.md> --check
  burnlist --plan <burnlist.md> --digest
  burnlist --close-completed [--scan-root <repo[,repo...]>]
  burnlist --stamp
  burnlist differential-testing validate <differential-testing.json>
  burnlist differential-testing validate-bundle <bundle/current.json>
  burnlist differential-testing schema
  burnlist differential-testing sdk
  burnlist streaming-diff <ensure-feed|capture|url|hook> ...
  burnlist hooks [install|uninstall|status] [--agent codex,claude] [--untracked] (bare defaults to status)
  burnlist oven <list|view|use|set|bind|unbind|bindings|event|create|update|adopt|upgrade|fork> ...
  burnlist new [--repo <path>]
  burnlist show <id>[#<item>] [--repo <path>]
  burnlist ready <id> [--repo <path>]
  burnlist start <id> [--repo <path>]
  burnlist close <id> [--repo <path>]
  burnlist burn <id> <item> [--check] [--repo <path>]
  burnlist loop assign <ItemRef> <LoopRef> [--repo <path>]
  burnlist loop unassign <ItemRef> [--repo <path>]
  burnlist loop view <LoopRef|ItemRef|review> [--repo <path>]
  burnlist loop create <ItemRef> [--repo <path>]
  burnlist loop list [--repo <path>]
  burnlist loop run|resume <RunRef> [--repo <path>]
  burnlist loop status|inspect <RunRef> [--repo <path>]
  burnlist loop pause|stop <RunRef> [--repo <path>] (idle Run only)
  burnlist loop reconcile <RunRef> --recovery-proof <hex> [--repo <path>]
  burnlist loop complete <RunRef> [--repo <path>]
  burnlist loop capability <inspect|trust> <id> ...
  burnlist loop setup status [--repo <path>]
  burnlist agent <profile|doctor> ...
  burnlist route set <route> --profile <slug> [--repo <path>]
  burnlist register [path]
  burnlist unregister [path]
  burnlist roots [--prune]
  burnlist init [path] [--track]
  burnlist install [--global] [--commit] [--force] [--agent codex,claude] [--dry-run]
  burnlist uninstall [--global] [--agent codex,claude] [--dry-run] [--purge]

Options:
  --auto-port           Try the next available loopback port.
  --host <host>         Bind host; loopback is required by default.
  --state-dir <path>    Override ignored dashboard observer state.
  --ovens-dir <path>    Override launch-repository custom Oven storage only.
  --runs-dir <path>     Override Run snapshot storage.
  --oven-data <id=path> Bind one Oven to a read-only normalized JSON payload.
  --global              Install or uninstall skills in the user home directory.
  --commit              Per-repository install: copy portable skills for git commit.
  --force               Permit install to replace a Burnlist-managed portable copy with a symlink.
  --agent <agents>      Restrict skill install or uninstall to codex, claude, or both.
  --dry-run             Print skill link or portable-copy plans without writing them.
  --purge               With uninstall --global only, also remove the global npm package.
  --version, -v         Print the installed Burnlist version.
  --help, -h            Show this help.`);
  return;
}

if (args[0] !== "oven" && (args.includes("--version") || args.includes("-v"))) {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(packageJson.version);
  return;
}

if (args[0] === "oven") {
  await import("../src/cli/oven-cli.mjs");
} else if (args[0] === "streaming-diff") {
  await import("../src/cli/streaming-diff-cli.mjs");
} else if (args[0] === "hooks") {
  await import("../src/cli/hooks-cli.mjs");
} else if (["new", "show", "ready", "start", "close", "burn"].includes(args[0])) {
  await import("../src/cli/lifecycle-cli.mjs");
} else if (args[0] === "loop") {
  const { runLoopCliEntry } = await import("../src/cli/loop-cli.mjs");
  await runLoopCliEntry(args.slice(1));
} else if (args[0] === "agent") {
  const { runAgentCliEntry } = await import("../src/cli/loop-config-cli.mjs");
  await runAgentCliEntry(args.slice(1));
} else if (args[0] === "route") {
  const { runRouteCliEntry } = await import("../src/cli/loop-config-cli.mjs");
  await runRouteCliEntry(args.slice(1));
} else if (["register", "unregister", "roots", "init"].includes(args[0])) {
  await import("../src/cli/registry-cli.mjs");
} else {
  await import("../src/server/burnlist-dashboard-server.mjs");
}
}

await main();
