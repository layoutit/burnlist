import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { gitProbe } from "./git-ignore.mjs";
import { addOwnedLocalExcludeText, fsyncDirectory, gitExcludePath, localExcludeTarget, removeOwnedLocalExcludeText, writeAtomicText } from "./local-exclude.mjs";
import { containedJoin, withRepoStateLock } from "../server/repo-state.mjs";

export const HOOK_MARKER = "burnlist-managed:streaming-diff-hooks@1";
const PROVENANCE_SCHEMA = 1;
const AGENTS = { codex: { file: ".codex/hooks.json" }, claude: { file: ".claude/settings.json" } };
const CODEX_HOOKS_MINIMUM_VERSION = "0.124.0";
const EVENTS = {
  // Codex supports SessionStart, PreToolUse, and PostToolUse. It does not
  // expose Claude's PostToolUseFailure event.
  codex: ["ensure", "pre", "post"],
  claude: ["ensure", "pre", "post", "failure"],
};
const MANAGED_EVENTS = ["ensure", "pre", "post", "failure"];
const MUTATING_MATCHERS = {
  claude: "Edit|Write|MultiEdit|NotebookEdit",
  codex: "apply_patch|write_file|edit_file|create_file|delete_file|rename_file|move_file",
};

export function writeDurableJson(path, value) { writeAtomicText(path, `${JSON.stringify(value, null, 2)}\n`); }

function provenancePath(repoRoot) { return containedJoin(repoRoot, "hooks-config-provenance.json"); }
function configKey(repoRoot, path) { return relative(resolve(repoRoot), path).replace(/\\/gu, "/"); }

function readProvenance(repoRoot) {
  try {
    const stored = JSON.parse(readFileSync(provenancePath(repoRoot), "utf8"));
    if (stored?.schemaVersion !== PROVENANCE_SCHEMA || !Array.isArray(stored.createdConfigPaths)
      || !stored.createdConfigPaths.every((path) => typeof path === "string")) return new Set();
    return new Set(stored.createdConfigPaths);
  } catch (error) {
    if (error?.code === "ENOENT") return new Set();
    return new Set();
  }
}

function readConfigState(path) {
  if (!existsSync(path)) return { config: {}, text: undefined };
  const text = readFileSync(path, "utf8");
  try {
    const config = JSON.parse(text);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("must be a JSON object");
    return { config, text };
  } catch (error) {
    throw new Error(`refusing to modify malformed hook config ${path}: ${error.message}`);
  }
}

function readConfig(path) { return readConfigState(path).config; }

function readOptionalText(path) {
  try { return readFileSync(path, "utf8"); } catch (error) {
    if (error?.code === "ENOENT") return undefined;
    throw error;
  }
}

function command(agent, event) { return `burnlist streaming-diff hook --agent ${agent} --event ${event}`; }
function eventName(event) { return ({ ensure: "SessionStart", pre: "PreToolUse", post: "PostToolUse", failure: "PostToolUseFailure" })[event]; }
function eventsFor(agent) { return EVENTS[agent] ?? []; }

export function managedHookEntry(agent, event) {
  const entry = { hooks: [{ type: "command", command: command(agent, event) }] };
  if (event !== "ensure") entry.matcher = MUTATING_MATCHERS[agent];
  return entry;
}

// Ownership is intentionally an exact, event-specific structural match. The
// marker belongs only to info/exclude, never to a host command string.
function ownedEntry(entry, agent, event) {
  const expected = managedHookEntry(agent, event);
  return entry && typeof entry === "object" && !Array.isArray(entry)
    && entry.matcher === expected.matcher && Array.isArray(entry.hooks) && entry.hooks.length === 1
    && entry.hooks[0]?.type === "command" && entry.hooks[0]?.command === expected.hooks[0].command;
}

function removeOwnedEntries(entries, agent, event) {
  if (!Array.isArray(entries)) throw new Error("hook event must be an array; refusing to clobber it");
  return entries.filter((entry) => !ownedEntry(entry, agent, event));
}

function eventEntries(config, event) {
  const entries = config.hooks?.[eventName(event)];
  return Array.isArray(entries) ? entries : [];
}

function hasCorruptHooks(config) {
  if (config.hooks === undefined) return false;
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) return true;
  return Object.values(config.hooks).some((entries) => !Array.isArray(entries));
}

function hasOwnedEntries(config, agent) {
  return eventsFor(agent).every((event) => eventEntries(config, event).some((entry) => ownedEntry(entry, agent, event)));
}

function ownershipState(config, agent) {
  const events = eventsFor(agent);
  const found = events.filter((event) => eventEntries(config, event).some((entry) => ownedEntry(entry, agent, event))).length;
  return found === events.length ? "installed" : found === 0 ? "none" : "partial";
}

function mergeConfig(config, agent, install) {
  const next = { ...config, hooks: { ...(config.hooks ?? {}) } };
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
    if (config.hooks !== undefined) throw new Error("hooks must be an object; refusing to clobber it");
  }
  for (const event of MANAGED_EVENTS) {
    const name = eventName(event);
    const clean = removeOwnedEntries(next.hooks[name] ?? [], agent, event);
    if (install && eventsFor(agent).includes(event)) clean.push(managedHookEntry(agent, event));
    if (clean.length) next.hooks[name] = clean;
    else delete next.hooks[name];
  }
  if (Object.keys(next.hooks).length === 0) delete next.hooks;
  return next;
}

function configPath(repoRoot, agent) {
  const spec = AGENTS[agent];
  if (!spec) throw new Error(`unsupported agent: ${agent}`);
  return join(resolve(repoRoot), spec.file);
}

function worktreeRoot(repoRoot, operation) {
  const cwd = resolve(repoRoot);
  const gitRoot = gitProbe(cwd, ["rev-parse", "--show-toplevel"]);
  if (gitRoot.status === 128 && /not a git repository/iu.test(gitRoot.stderr ?? "")) {
    throw new Error(`hooks ${operation} must run inside a Git repository.`);
  }
  if (gitRoot.status !== 0) throw new Error(gitRoot.error?.message || gitRoot.stderr?.trim() || "could not determine Git worktree root");
  const root = gitRoot.stdout.trim();
  if (!root) throw new Error("could not determine Git worktree root");
  return resolve(cwd, root);
}

function preflight(repoRoot, agents, operation) {
  const root = worktreeRoot(repoRoot, operation);
  const targets = agents.map((agent) => {
    const path = configPath(root, agent);
    const target = relative(root, path).replace(/\\/gu, "/");
    const result = gitProbe(root, ["ls-files", "--error-unmatch", "--", target]);
    if (result.status !== 0 && result.status !== 1) throw new Error(result.error?.message || result.stderr?.trim() || "could not determine Git tracking state");
    return { agent, path, tracked: result.status === 0 };
  });
  return { root, targets };
}

function locallyExcluded(repoRoot, path) {
  const exclude = gitExcludePath(repoRoot);
  return existsSync(exclude) && readFileSync(exclude, "utf8").split(/\r?\n/u).includes(localExcludeTarget(repoRoot, path));
}

function excludedIn(content, target) { return content.split(/\r?\n/u).includes(target); }

function applyFileChange(change, writeJson) {
  if (change.after === undefined) {
    rmSync(change.path, { force: true });
    fsyncDirectory(dirname(change.path));
  } else if (change.value) writeJson(change.path, change.value);
  else writeAtomicText(change.path, change.after);
}

function restoreFileChange(change) {
  if (change.before === undefined) {
    rmSync(change.path, { force: true });
    fsyncDirectory(dirname(change.path));
  } else writeAtomicText(change.path, change.before);
}

function versionAtLeast(version, minimum) {
  const parse = (value) => /^v?(\d+)\.(\d+)\.(\d+)/u.exec(value)?.slice(1).map(Number);
  const actual = parse(version);
  const target = parse(minimum);
  if (!actual || !target) return false;
  for (let index = 0; index < actual.length; index += 1) {
    if (actual[index] !== target[index]) return actual[index] > target[index];
  }
  return true;
}

export function hookCapability(agent, { spawn = spawnSync, env = process.env } = {}) {
  const binary = agent === "codex" ? "codex" : agent === "claude" ? "claude" : null;
  if (!binary) throw new Error(`unsupported agent: ${agent}`);
  const result = spawn(binary, ["--version"], { encoding: "utf8", env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
  if (result?.error?.code === "ENOENT") return { state: "not-installed" };
  if (result?.error || result?.status !== 0) return { state: "not-installed" };
  const version = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.match(/\d+\.\d+\.\d+/u)?.[0];
  if (agent === "codex" && (!version || !versionAtLeast(version, CODEX_HOOKS_MINIMUM_VERSION))) {
    return { state: "installed-but-hooks-unsupported", version, minimumVersion: CODEX_HOOKS_MINIMUM_VERSION };
  }
  return { state: "installed+hooks-supported", version };
}

export function hookConfigStatus({ repoRoot = process.cwd(), agents = Object.keys(AGENTS), capability = hookCapability } = {}) {
  const { root, targets } = preflight(repoRoot, agents, "status");
  return targets.map(({ agent, path, tracked }) => {
    let installed = false;
    let malformed = false;
    let corrupt = false;
    let config = {};
    try {
      config = readConfig(path);
      corrupt = hasCorruptHooks(config);
      installed = !corrupt && hasOwnedEntries(config, agent);
    } catch { malformed = true; }
    return {
      agent, path, installed, state: malformed || corrupt ? "corrupt" : ownershipState(config, agent),
      malformed: malformed || corrupt, mode: tracked ? "tracked" : "untracked", excluded: locallyExcluded(root, path),
      capability: capability(agent),
    };
  });
}

export function updateHookConfigs({ repoRoot = process.cwd(), agents = Object.keys(AGENTS), install, untracked = false, capability = hookCapability, writeJson = writeDurableJson, restoreFile = restoreFileChange } = {}) {
  if (typeof install !== "boolean") throw new Error("install must be true or false");
  const { root, targets } = preflight(repoRoot, agents, install ? "install" : "uninstall");
  return withRepoStateLock(root, () => {
    const capabilities = new Map(targets.map(({ agent }) => [agent, capability(agent)]));
    const created = readProvenance(root);
    let provenanceChanged = false;
    const prepared = targets.map(({ agent, path, tracked }) => {
      const key = configKey(root, path);
      const state = readConfigState(path);
      const config = state.config;
      if (hasCorruptHooks(config)) throw new Error(`refusing to modify malformed hook config ${path}: hooks must contain event arrays`);
      const next = mergeConfig(config, agent, install);
      const changed = JSON.stringify(config) !== JSON.stringify(next);
      const configDidNotExist = state.text === undefined;
      const remove = !install && Object.keys(next).length === 0 && created.has(key);
      if (install && configDidNotExist) { created.add(key); provenanceChanged = true; }
      if (!install && created.delete(key)) provenanceChanged = true;
      return {
        agent, path, tracked, key, next, changed, remove,
        removed: !install && ownershipState(config, agent) !== "none",
        change: changed || remove ? { path, before: state.text, after: remove ? undefined : "", value: remove ? undefined : next } : null,
      };
    });
    const exclude = gitExcludePath(root);
    const excludeBefore = readOptionalText(exclude);
    let excludeAfter = excludeBefore ?? "";
    for (const { path, tracked } of prepared) {
      const target = localExcludeTarget(root, path);
      if (install && (!tracked || untracked)) excludeAfter = addOwnedLocalExcludeText(excludeAfter, target, HOOK_MARKER) ?? excludeAfter;
      if (!install) excludeAfter = removeOwnedLocalExcludeText(excludeAfter, target, HOOK_MARKER);
    }
    if (excludeBefore === undefined && excludeAfter === "") excludeAfter = undefined;
    const changes = prepared.flatMap(({ change }) => change ? [change] : []);
    if (excludeBefore !== excludeAfter) changes.push({ path: exclude, before: excludeBefore, after: excludeAfter });
    const provenance = provenancePath(root);
    const provenanceBefore = readOptionalText(provenance);
    const provenanceAfter = created.size ? `${JSON.stringify({ schemaVersion: PROVENANCE_SCHEMA, createdConfigPaths: [...created].sort() }, null, 2)}\n` : undefined;
    if (provenanceChanged) changes.push({ path: provenance, before: provenanceBefore, after: provenanceAfter });
    const written = [];
    try {
      for (const change of changes) {
        written.push(change);
        applyFileChange(change, writeJson);
      }
    } catch (error) {
      const rollbackFailures = [];
      for (const change of written.reverse()) {
        try { restoreFile(change); } catch { rollbackFailures.push(change.path); }
      }
      if (rollbackFailures.length) {
        throw new Error(`rollback failed for ${rollbackFailures.join(", ")}; those files may be in a partial state and manual cleanup may be needed`, { cause: error });
      }
      throw error;
    }
    return prepared.map(({ agent, path, tracked, next, removed }) => {
      const resulting = install ? next : Object.keys(next).length === 0 ? {} : next;
      return {
        agent, path, installed: hasOwnedEntries(resulting, agent), state: ownershipState(resulting, agent),
        mode: tracked ? "tracked" : "untracked", excluded: excludedIn(excludeAfter ?? "", localExcludeTarget(root, path)),
        forcedUntracked: untracked && tracked, capability: capabilities.get(agent),
        removed,
      };
    });
  });
}
