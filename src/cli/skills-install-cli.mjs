import { spawnSync } from "node:child_process";
import { lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { registerSkills, unregisterSkills } from "./skills-register.mjs";

const VALID_AGENTS = Object.freeze(["codex", "claude"]);

function parseAgents(value) {
  const agents = value.split(",").map((agent) => agent.trim());
  if (!agents.length || agents.some((agent) => !agent)) {
    throw new Error("--agent requires codex, claude, or a comma-separated list of both");
  }
  const unknown = agents.find((agent) => !VALID_AGENTS.includes(agent));
  if (unknown) throw new Error(`unknown --agent value: ${unknown}. Valid agents: codex, claude.`);
  return [...new Set(agents)];
}

function parseSkillCommand(args) {
  const command = args[0];
  if (!command) throw new Error("missing skill command");
  let global = false;
  let dryRun = false;
  let purge = false;
  let commit = false;
  let agents = VALID_AGENTS;
  let agentSpecified = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--global") global = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--commit") commit = true;
    else if (argument === "--purge") purge = true;
    else if (argument === "--agent") {
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error("--agent requires codex, claude, or a comma-separated list of both");
      agents = parseAgents(value);
      agentSpecified = true;
    } else if (argument.startsWith("--agent=")) {
      agents = parseAgents(argument.slice("--agent=".length));
      agentSpecified = true;
    } else throw new Error(`unexpected argument: ${argument}`);
  }
  if (command === "install" && purge) throw new Error("--purge is only valid with uninstall");
  if (command === "uninstall" && commit) throw new Error("--commit is only valid with install");
  if (global && commit) throw new Error("--commit is only valid for per-repository skill installs");
  if (purge && !global) throw new Error("--purge requires --global");
  if (purge && agentSpecified) throw new Error("--purge removes the global package and must clean both agents; omit --agent");
  return { command, scope: global ? "global" : "repo", dryRun, purge, commit, agents };
}

function npmGlobalPrefix(packageRoot) {
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

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function restoreRemovedSkills(removed, { log, warn }) {
  for (const registration of removed) {
    const stat = lstatOrNull(registration.target);
    if (stat) {
      if (stat.isSymbolicLink() && resolve(dirname(registration.target), readlinkSync(registration.target)) === registration.source) {
        log(`Burnlist: kept restored ${registration.source} -> ${registration.target}`);
      } else {
        warn(`Burnlist: left ${registration.target} untouched during recovery because it is no longer this package's skill link.`);
      }
      continue;
    }
    mkdirSync(registration.targetRoot, { recursive: true });
    symlinkSync(registration.source, registration.target, process.platform === "win32" ? "junction" : "dir");
    log(`Burnlist: restored ${registration.source} -> ${registration.target}`);
  }
}

function purgeGlobalPackage({ packageRoot, env, log, warn, spawn, removed }) {
  const prefix = npmGlobalPrefix(packageRoot);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const removal = spawn(npm, ["uninstall", "--global", "--prefix", prefix, "burnlist"], {
    env,
    shell: false,
    stdio: "inherit",
  });
  if (removal.error || removal.status !== 0) {
    log("Burnlist: npm uninstall failed; restoring agent skill registrations.");
    restoreRemovedSkills(removed, { log, warn });
    return removal.status ?? 1;
  }
  return 0;
}

export function runSkillsInstallCli({ args, packageRoot, cwd = process.cwd(), env = process.env, log = console.log, warn = console.warn, error = console.error, spawn = spawnSync }) {
  try {
    const options = parseSkillCommand(args);
    const sourceRoot = resolve(packageRoot, "skills");
    if (options.command === "install") {
      registerSkills({ sourceRoot, cwd, env, ...options, log });
      return 0;
    }
    if (options.command !== "uninstall") throw new Error(`unknown skill command: ${options.command}`);
    if (options.purge && !options.dryRun) npmGlobalPrefix(packageRoot);
    const removed = unregisterSkills({ sourceRoot, cwd, env, ...options, log, warn });
    if (!options.purge) return 0;
    if (options.dryRun) {
      log("Burnlist: would uninstall the global npm package burnlist.");
      return 0;
    }
    return purgeGlobalPackage({ packageRoot, env, log, warn, spawn, removed });
  } catch (cause) {
    error(`Burnlist: ${cause.message}`);
    return 1;
  }
}
