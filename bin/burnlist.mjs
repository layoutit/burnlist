#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Burnlist

Usage:
  burnlist [--port <port>] [--scan-root <repo[,repo...]>]
  burnlist --plan <burnlist.md> --check
  burnlist --plan <burnlist.md> --digest
  burnlist --close-completed [--scan-root <repo[,repo...]>]
  burnlist --stamp
  burnlist uninstall

Options:
  --auto-port           Try the next available loopback port.
  --host <host>         Bind host; loopback is required by default.
  --state-dir <path>    Override ignored dashboard observer state.
  --ovens-dir <path>    Override custom Oven storage.
  --runs-dir <path>     Override Run snapshot storage.
  --version, -v         Print the installed Burnlist version.
  --help, -h            Show this help.`);
  process.exit(0);
}

if (args.includes("--version") || args.includes("-v")) {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  console.log(packageJson.version);
  process.exit(0);
}

await import("../skills/burnlist/scripts/burnlist-dashboard-server.mjs");
