#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const knownSubcommands = new Set([
  "uninstall",
  "differential-testing",
  "oven",
  "new",
  "show",
  "ready",
  "start",
  "close",
  "burn",
  "register",
  "unregister",
  "roots",
  "init",
]);

function npmGlobalPrefix() {
  let current = packageRoot;
  while (dirname(current) !== current) {
    if (basename(current) === "node_modules") {
      const parent = dirname(current);
      return basename(parent) === "lib" ? dirname(parent) : parent;
    }
    current = dirname(current);
  }
  throw new Error("Burnlist is not running from a global npm installation.");
}

function runNodeScript(path, scriptArgs) {
  return spawnSync(process.execPath, [path, ...scriptArgs], {
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
}

if (args[0] === "uninstall") {
  let prefix;
  try {
    prefix = npmGlobalPrefix();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
  const unregisterPath = resolve(packageRoot, "scripts", "unregister-skills.mjs");
  const unregister = runNodeScript(unregisterPath, ["--force-global"]);
  if (unregister.status !== 0) process.exit(unregister.status || 1);

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const removal = spawnSync(npm, ["uninstall", "--global", "--prefix", prefix, "burnlist"], {
    env: process.env,
    shell: false,
    stdio: "inherit",
  });
  if (removal.status !== 0) {
    console.error("Burnlist: npm uninstall failed; restoring agent skill registrations.");
    runNodeScript(resolve(packageRoot, "scripts", "register-skills.mjs"), ["--force-global"]);
  }
  process.exit(removal.status || 0);
}

if (args[0] === "differential-testing" && args[1] === "schema") {
  console.log(resolve(packageRoot, "ovens", "differential-testing", "schema", "differential-testing-data.schema.json"));
  process.exit(0);
}

if (args[0] === "differential-testing" && args[1] === "sdk") {
  console.log(resolve(packageRoot, "ovens", "differential-testing", "engine", "differential-testing-adapter-sdk.mjs"));
  process.exit(0);
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
      const { assertDifferentialTestingBundle } = await import("../ovens/differential-testing/engine/differential-testing-transport.mjs");
      const bundle = assertDifferentialTestingBundle(path);
      console.log(`Valid Differential Testing bundle: ${bundle.scenarios.length} scenarios; selected ${bundle.selectedScenarioId ?? "none"}.`);
    } else {
      const { assertDifferentialTestingData } = await import("../ovens/differential-testing/engine/differential-testing-data-contract.mjs");
      assertDifferentialTestingData(document);
      const sampleCount = document.fields.reduce((total, field) => total + field.sampleCount, 0);
      console.log(`Valid Differential Testing data: ${document.fields.length} fields, ${sampleCount} samples, ${document.summary.frames.uniqueTicks} aligned ticks.`);
    }
    process.exit(0);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}

if (args[0] && !args[0].startsWith("--") && !["-h", "-v"].includes(args[0]) && !knownSubcommands.has(args[0])) {
  console.error(`Unknown command: ${args[0]}`);
  process.exit(2);
}

if (args[0] !== "oven" && (args.includes("--help") || args.includes("-h"))) {
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
  burnlist oven <list|view|bind|unbind|bindings|create|update> ...
  burnlist new [--repo <path>]
  burnlist show <id>[#<item>] [--repo <path>]
  burnlist ready <id> [--repo <path>]
  burnlist start <id> [--repo <path>]
  burnlist close <id> [--repo <path>]
  burnlist burn <id> <item> [--check] [--repo <path>]
  burnlist register [path]
  burnlist unregister [path]
  burnlist roots [--prune]
  burnlist init [path] [--track]
  burnlist uninstall

Options:
  --auto-port           Try the next available loopback port.
  --host <host>         Bind host; loopback is required by default.
  --state-dir <path>    Override ignored dashboard observer state.
  --ovens-dir <path>    Override launch-repository custom Oven storage only.
  --runs-dir <path>     Override Run snapshot storage.
  --oven-data <id=path> Bind one Oven to a read-only normalized JSON payload.
  --version, -v         Print the installed Burnlist version.
  --help, -h            Show this help.`);
  process.exit(0);
}

if (args[0] !== "oven" && (args.includes("--version") || args.includes("-v"))) {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(packageJson.version);
  process.exit(0);
}

if (args[0] === "oven") {
  await import("../src/cli/oven-cli.mjs");
} else if (["new", "show", "ready", "start", "close", "burn"].includes(args[0])) {
  await import("../src/cli/lifecycle-cli.mjs");
} else if (["register", "unregister", "roots", "init"].includes(args[0])) {
  await import("../src/cli/registry-cli.mjs");
} else {
  await import("../src/server/burnlist-dashboard-server.mjs");
}
