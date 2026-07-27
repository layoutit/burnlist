import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

import { registerSkills, removeSnapshotManagedSkills, snapshotManagedSkills, unregisterSkills } from "./skills-register.mjs";
import { withGlobalSkillsLock } from "./skills-install-lock.mjs";

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
  let force = false;
  let agents = VALID_AGENTS;
  let agentSpecified = false;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--global") global = true;
    else if (argument === "--dry-run") dryRun = true;
    else if (argument === "--commit") commit = true;
    else if (argument === "--force") force = true;
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
  if (command === "uninstall" && force) throw new Error("--force is only valid with install");
  if (global && commit) throw new Error("--commit is only valid for per-repository skill installs");
  if (purge && !global) throw new Error("--purge requires --global");
  if (purge && agentSpecified) throw new Error("--purge removes the global package and must clean both agents; omit --agent");
  return { command, scope: global ? "global" : "repo", dryRun, purge, commit, force, agents };
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

function purgeGlobalPackage({ packageRoot, env, error, spawn }) {
  const prefix = npmGlobalPrefix(packageRoot);
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const removal = spawn(npm, ["uninstall", "--global", "--prefix", prefix, "burnlist"], {
    env,
    shell: false,
    stdio: "inherit",
  });
  if (removal.error || removal.status !== 0) {
    error("Burnlist: npm uninstall failed; checking global skill registrations for newly broken links.");
    return removal.status ?? 1;
  }
  return 0;
}

export function runSkillsInstallCli({ args, packageRoot, cwd = process.cwd(), env = process.env, log = console.log, warn = console.warn, error = console.error, spawn = spawnSync, remove }) {
  try {
    const options = parseSkillCommand(args);
    const sourceRoot = resolve(packageRoot, "skills");
    if (options.command === "install") {
      registerSkills({ sourceRoot, cwd, env, ...options, log });
      return 0;
    }
    if (options.command !== "uninstall") throw new Error(`unknown skill command: ${options.command}`);
    if (!options.purge) {
      const cleanup = unregisterSkills({ sourceRoot, cwd, env, ...options, log, warn });
      if (!cleanup.removed.length && cleanup.excludesRemoved) {
        log(`Burnlist: ${options.dryRun ? "would remove" : "removed"} ${cleanup.excludesRemoved} owned local exclude entr${cleanup.excludesRemoved === 1 ? "y" : "ies"}.`);
      }
      if (!cleanup.removed.length && !cleanup.excludesRemoved) log("Burnlist: nothing installed to remove.");
      return 0;
    }
    if (options.dryRun) {
      log("Burnlist: would uninstall the global npm package burnlist.");
      const planned = snapshotManagedSkills({ sourceRoot, scope: "global", cwd, env, agents: options.agents });
      for (const registration of planned) log(`Burnlist: would remove ${registration.source} -> ${registration.target}; global managed registration.`);
      if (!planned.length) log("Burnlist: no global skill registrations would be removed.");
      return 0;
    }
    npmGlobalPrefix(packageRoot);
    return withGlobalSkillsLock(env, () => {
      const snapshot = snapshotManagedSkills({ sourceRoot, scope: "global", cwd, env, agents: options.agents });
      const purgeStatus = purgeGlobalPackage({ packageRoot, env, error, spawn });
      if (purgeStatus !== 0) {
        // npm can remove the package tree and still exit non-zero.  Revalidate
        // the pre-npm identities and only clean links whose source is now gone.
        const dangling = snapshot.filter((registration) => registration.state === "link" && !existsSync(registration.source));
        const cleanup = removeSnapshotManagedSkills({ registrations: dangling, env, log, warn, remove });
        if (cleanup.removed.length) error(`Burnlist: npm uninstall failed after removing the package; removed now-broken global skill link(s): ${cleanup.removed.map(({ target }) => target).join(", ")}.`);
        if (cleanup.failures.length) error(`Burnlist: npm uninstall failed and could not remove ${cleanup.failures.length} now-broken global skill link(s): ${cleanup.failures.map(({ target, error: cause }) => `${target} (${cause.message})`).join("; ")}`);
        return purgeStatus;
      }
      const cleanup = removeSnapshotManagedSkills({ registrations: snapshot, env, log, warn, remove });
      if (!cleanup.removed.length && !cleanup.failures.length) log("Burnlist: nothing installed to remove.");
      if (cleanup.failures.length) {
        error(`Burnlist: npm uninstall succeeded, but could not remove ${cleanup.failures.length} global skill registration(s): ${cleanup.failures.map(({ target, error: cause }) => `${target} (${cause.message})`).join("; ")}`);
        return 1;
      }
      return 0;
    });
  } catch (cause) {
    error(`Burnlist: ${cause.message}`);
    return 1;
  }
}
