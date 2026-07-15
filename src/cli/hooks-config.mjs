import { randomBytes } from "node:crypto";
import { closeSync, constants, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";

import { gitProbe } from "./git-ignore.mjs";
import { containedJoin, withRepoStateLock } from "../server/repo-state.mjs";

export const HOOK_MARKER = "burnlist-managed:streaming-diff-hooks@1";
const PROVENANCE_SCHEMA = 1;
const AGENTS = { codex: { file: ".codex/hooks.json" }, claude: { file: ".claude/settings.json" } };
const EVENTS = ["ensure", "pre", "post", "failure"];
const MUTATING_MATCHERS = {
  claude: "Edit|Write|MultiEdit|NotebookEdit",
  codex: "apply_patch|write_file|edit_file|create_file|delete_file|rename_file|move_file",
};

function fsyncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

function writeDurableText(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  let fd;
  try {
    fd = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(fd, text); fsyncSync(fd); closeSync(fd); fd = undefined;
    renameSync(temporary, path); fsyncDirectory(dirname(path));
  } finally { if (fd !== undefined) closeSync(fd); rmSync(temporary, { force: true }); }
}

export function writeDurableJson(path, value) { writeDurableText(path, `${JSON.stringify(value, null, 2)}\n`); }

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

function writeProvenance(repoRoot, created) {
  const path = provenancePath(repoRoot);
  if (created.size) return writeDurableJson(path, { schemaVersion: PROVENANCE_SCHEMA, createdConfigPaths: [...created].sort() });
  rmSync(path, { force: true });
  try { fsyncDirectory(dirname(path)); } catch (error) { if (error?.code !== "ENOENT") throw error; }
}

function readConfig(path, { backupMalformed = false } = {}) {
  if (!existsSync(path)) return {};
  const text = readFileSync(path, "utf8");
  try {
    const config = JSON.parse(text);
    if (!config || typeof config !== "object" || Array.isArray(config)) throw new Error("must be a JSON object");
    return config;
  } catch (error) {
    let backup = null;
    if (backupMalformed) {
      backup = `${path}.burnlist-malformed-${Date.now()}.bak`;
      writeDurableText(backup, text);
    }
    throw new Error(`refusing to modify malformed hook config ${path}${backup ? `; backed up to ${backup}` : ""}: ${error.message}`);
  }
}

function command(agent, event) { return `burnlist streaming-diff hook --agent ${agent} --event ${event}`; }
function eventName(event) { return ({ ensure: "SessionStart", pre: "PreToolUse", post: "PostToolUse", failure: "PostToolUseFailure" })[event]; }

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

function hasOwnedEntries(config, agent) {
  return EVENTS.every((event) => (config.hooks?.[eventName(event)] ?? []).some((entry) => ownedEntry(entry, agent, event)));
}

function ownershipState(config, agent) {
  const found = EVENTS.filter((event) => (config.hooks?.[eventName(event)] ?? []).some((entry) => ownedEntry(entry, agent, event))).length;
  return found === EVENTS.length ? "installed" : found === 0 ? "none" : "partial";
}

function mergeConfig(config, agent, install) {
  const next = { ...config, hooks: { ...(config.hooks ?? {}) } };
  if (!config.hooks || typeof config.hooks !== "object" || Array.isArray(config.hooks)) {
    if (config.hooks !== undefined) throw new Error("hooks must be an object; refusing to clobber it");
  }
  for (const event of EVENTS) {
    const name = eventName(event);
    const clean = removeOwnedEntries(next.hooks[name] ?? [], agent, event);
    if (install) clean.push(managedHookEntry(agent, event));
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

function preflight(repoRoot, agents) {
  const root = resolve(repoRoot);
  const gitRoot = gitProbe(root, ["rev-parse", "--show-toplevel"]);
  if (gitRoot.status !== 0) throw new Error(gitRoot.error?.message || gitRoot.stderr?.trim() || "could not determine Git worktree root");
  return agents.map((agent) => {
    const path = configPath(root, agent);
    const target = relative(root, path).replace(/\\/gu, "/");
    const result = gitProbe(root, ["ls-files", "--error-unmatch", "--", target]);
    if (result.status !== 0 && result.status !== 1) throw new Error(result.error?.message || result.stderr?.trim() || "could not determine Git tracking state");
    return { agent, path, tracked: result.status === 0 };
  });
}

function excludePath(repoRoot) {
  const result = gitProbe(repoRoot, ["rev-parse", "--git-path", "info/exclude"]);
  if (result.status !== 0) throw new Error(result.error?.message || result.stderr?.trim() || "could not locate .git/info/exclude");
  return resolve(repoRoot, result.stdout.trim());
}

function excludeTarget(repoRoot, path) { return `/${relative(resolve(repoRoot), path).replace(/\\/gu, "/")}`; }

function addLocalExclude(repoRoot, path) {
  const exclude = excludePath(repoRoot);
  const target = excludeTarget(repoRoot, path);
  const content = existsSync(exclude) ? readFileSync(exclude, "utf8") : "";
  if (content.split(/\r?\n/u).includes(target)) return;
  const prefix = content && !content.endsWith("\n") ? `${content}\n` : content;
  writeDurableText(exclude, `${prefix}# ${HOOK_MARKER}\n${target}\n`);
}

function removeLocalExclude(repoRoot, path) {
  const exclude = excludePath(repoRoot);
  if (!existsSync(exclude)) return;
  const target = excludeTarget(repoRoot, path);
  const lines = readFileSync(exclude, "utf8").split(/\r?\n/u);
  const kept = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index] === `# ${HOOK_MARKER}` && lines[index + 1] === target) { index += 1; continue; }
    kept.push(lines[index]);
  }
  const next = kept.join("\n");
  if (next !== readFileSync(exclude, "utf8")) writeDurableText(exclude, next);
}

function locallyExcluded(repoRoot, path) {
  const exclude = excludePath(repoRoot);
  return existsSync(exclude) && readFileSync(exclude, "utf8").split(/\r?\n/u).includes(excludeTarget(repoRoot, path));
}

export function hookConfigStatus({ repoRoot = process.cwd(), agents = Object.keys(AGENTS) } = {}) {
  return preflight(repoRoot, agents).map(({ agent, path, tracked }) => {
    let installed = false;
    let malformed = false;
    let config = {};
    try { config = readConfig(path); installed = hasOwnedEntries(config, agent); } catch { malformed = true; }
    return { agent, path, installed, state: malformed ? "none" : ownershipState(config, agent), malformed, mode: tracked ? "tracked" : "untracked", excluded: locallyExcluded(repoRoot, path) };
  });
}

export function updateHookConfigs({ repoRoot = process.cwd(), agents = Object.keys(AGENTS), install, untracked = false } = {}) {
  if (typeof install !== "boolean") throw new Error("install must be true or false");
  // The Git/root/tracking probes run before readConfig can create a malformed backup.
  const root = resolve(repoRoot);
  const targets = preflight(root, agents);
  return withRepoStateLock(root, () => {
    const created = readProvenance(root);
    let provenanceChanged = false;
    const result = targets.map(({ agent, path, tracked }) => {
      const key = configKey(root, path);
      const configDidNotExist = !existsSync(path);
      const config = readConfig(path, { backupMalformed: true });
      const next = mergeConfig(config, agent, install);
      const changed = JSON.stringify(config) !== JSON.stringify(next);
      if (install && changed) writeDurableJson(path, next);
      if (install && configDidNotExist) { created.add(key); provenanceChanged = true; }
      if (!install) {
        const createdByBurnlist = created.has(key);
        if (Object.keys(next).length === 0 && createdByBurnlist) {
          rmSync(path, { force: true });
          fsyncDirectory(dirname(path));
        } else if (changed) writeDurableJson(path, next);
        if (created.delete(key)) provenanceChanged = true;
      }
      if (install && !tracked) addLocalExclude(root, path);
      if (!install) removeLocalExclude(root, path);
      const resulting = install ? next : Object.keys(next).length === 0 ? {} : next;
      return { agent, path, installed: hasOwnedEntries(resulting, agent), state: ownershipState(resulting, agent), mode: tracked ? "tracked" : "untracked", excluded: locallyExcluded(root, path), forcedUntracked: untracked && tracked };
    });
    if (provenanceChanged) writeProvenance(root, created);
    return result;
  });
}
