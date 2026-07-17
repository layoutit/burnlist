import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

import { gitProbe } from "./git-ignore.mjs";
import { addOwnedLocalExcludeText, fsyncDirectory, gitExcludePath, localExcludeTarget, removeOwnedLocalExcludeText, writeAtomicText } from "./local-exclude.mjs";
import { withRepoStateLock } from "../server/repo-state.mjs";

export const TARGETS = Object.freeze({
  claude: Object.freeze({
    global: ({ env, home }) => resolve(env.BURNLIST_CLAUDE_SKILLS_DIR || join(home, ".claude", "skills")),
    repo: ({ repoRoot }) => resolve(repoRoot, ".claude", "skills"),
  }),
  codex: Object.freeze({
    global: ({ env, home }) => resolve(env.BURNLIST_SKILLS_DIR || join(home, ".agents", "skills")),
    repo: ({ repoRoot }) => resolve(repoRoot, ".agents", "skills"),
  }),
});

const SKILL_NAME = /^[a-z0-9][a-z0-9-]*$/u;
const SKILL_EXCLUDE_MARKER = "burnlist-managed:skills@1";
const COPY_MARKER = ".burnlist-managed.json";

function lstatOrNull(path) {
  try { return lstatSync(path); } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function linkedSource(path) { return resolve(dirname(path), readlinkSync(path)); }

function readOptionalText(path) {
  try { return readFileSync(path, "utf8"); } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function skillNames(sourceRoot) {
  return readdirSync(sourceRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .map((name) => {
      if (!SKILL_NAME.test(name)) throw new Error(`unsafe skill folder name: ${name}`);
      const source = resolve(sourceRoot, name);
      if (!existsSync(join(source, "SKILL.md"))) throw new Error(`skill ${name} is missing SKILL.md`);
      return { name, source };
    });
}

export function resolveRepoRoot(cwd = process.cwd()) {
  const current = resolve(cwd);
  const result = gitProbe(current, ["rev-parse", "--show-toplevel"]);
  if (result.status !== 0) {
    if (result.status === 128 && /not a git repository/iu.test(result.stderr ?? "")) return current;
    const reason = result.error?.message || result.stderr?.trim() || `git exited with status ${result.status}`;
    throw new Error(`could not resolve repository root for ${current}: ${reason}`);
  }
  const root = result.stdout.trim();
  if (!root) throw new Error(`could not resolve repository root for ${current}: git returned no worktree root`);
  return resolve(root);
}

function gitContext(cwd) {
  const root = resolveRepoRoot(cwd);
  const result = gitProbe(root, ["rev-parse", "--show-toplevel"]);
  if (result.status === 0) return { root: resolve(result.stdout.trim()), git: true };
  if (result.status === 128 && /not a git repository/iu.test(result.stderr ?? "")) return { root, git: false };
  const reason = result.error?.message || result.stderr?.trim() || `git exited with status ${result.status}`;
  throw new Error(`could not resolve repository root for ${root}: ${reason}`);
}

export function registrationScope(args, env = process.env) {
  const inlineScope = args.find((arg) => arg.startsWith("--scope="));
  if (inlineScope) {
    const scope = inlineScope.slice("--scope=".length);
    if (!scope) throw new Error("--scope requires global or repo");
    return scope;
  }
  const scopeIndex = args.indexOf("--scope");
  if (scopeIndex !== -1) {
    const scope = args[scopeIndex + 1];
    if (!scope) throw new Error("--scope requires global or repo");
    return scope;
  }
  return env.npm_config_global === "true" || args.includes("--force-global") ? "global" : "repo";
}

function homeForGlobalTargets(env) {
  const needsHome = !env.BURNLIST_CLAUDE_SKILLS_DIR || !env.BURNLIST_SKILLS_DIR;
  const home = env.HOME || env.USERPROFILE;
  if (needsHome && !home) throw new Error("cannot register agent skills because no user home directory is available");
  return home;
}

export function targetRoots({ scope, cwd = process.cwd(), env = process.env, agents = Object.keys(TARGETS) }) {
  if (!Object.hasOwn(TARGETS.claude, scope)) throw new Error(`unknown skill registration scope: ${scope}`);
  const home = scope === "global" ? homeForGlobalTargets(env) : undefined;
  const repoRoot = scope === "repo" ? resolveRepoRoot(cwd) : undefined;
  return agents.map((agent) => {
    const targets = TARGETS[agent];
    if (!targets) throw new Error(`unknown skill registration agent: ${agent}`);
    return { agent, root: targets[scope]({ env, home, repoRoot }) };
  });
}

function registrations({ sourceRoot, scope, cwd, env, agents }) {
  return targetRoots({ scope, cwd, env, agents }).flatMap(({ agent, root }) => skillNames(sourceRoot).map(({ name, source }) => ({
    agent, name, source, target: resolve(root, name), targetRoot: root,
  })));
}

function copyMarker(registration, version) {
  return {
    managedBy: "burnlist",
    skill: registration.name,
    mode: "commit",
    version,
  };
}

function sourcePackageVersion(sourceRoot) {
  const packageJson = JSON.parse(readFileSync(join(sourceRoot, "..", "package.json"), "utf8"));
  if (typeof packageJson.version !== "string" || packageJson.version === "") {
    throw new Error(`could not determine package version for portable skills in ${sourceRoot}`);
  }
  return packageJson.version;
}

function isManagedCopy(registration) {
  const stat = lstatOrNull(registration.target);
  if (!stat || !stat.isDirectory() || stat.isSymbolicLink()) return false;
  try {
    const marker = JSON.parse(readFileSync(join(registration.target, COPY_MARKER), "utf8"));
    return marker?.managedBy === "burnlist" && marker?.skill === registration.name;
  } catch { return false; }
}

function targetState(registration) {
  const stat = lstatOrNull(registration.target);
  if (!stat) return "missing";
  if (stat.isSymbolicLink()) return linkedSource(registration.target) === registration.source ? "link" : "foreign-link";
  return isManagedCopy(registration) ? "copy" : "foreign";
}

function trackedInGit(repoRoot, path) {
  const target = relative(repoRoot, path).replace(/\\/gu, "/");
  const result = gitProbe(repoRoot, ["ls-files", "--error-unmatch", "--", target]);
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(result.error?.message || result.stderr?.trim() || `could not determine whether ${target} is tracked`);
}

function assertInstallable(registration, desired) {
  const state = targetState(registration);
  if (state === "foreign-link") throw new Error(`${registration.target} already links to a different skill source (foreign symlink; refusing to overwrite it)`);
  if (state === "foreign") throw new Error(`${registration.target} already exists and is not a Burnlist-managed symlink or provenance-marked portable copy; refusing to overwrite it`);
  return { ...registration, state, action: state === desired ? "keep" : desired };
}

function copySkill(registration, version) {
  mkdirSync(registration.targetRoot, { recursive: true });
  const stage = mkdtempSync(join(registration.targetRoot, ".burnlist-skill-"));
  const payload = join(stage, registration.name);
  try {
    cpSync(registration.source, payload, { recursive: true, dereference: true, errorOnExist: true });
    writeAtomicText(join(payload, COPY_MARKER), `${JSON.stringify(copyMarker(registration, version), null, 2)}\n`);
    renameSync(payload, registration.target);
    fsyncDirectory(registration.targetRoot);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

function installTarget(registration, version) {
  if (registration.action === "keep") return;
  if (registration.state !== "missing") rmSync(registration.target, { recursive: true, force: true });
  if (registration.action === "link") {
    mkdirSync(registration.targetRoot, { recursive: true });
    symlinkSync(registration.source, registration.target, process.platform === "win32" ? "junction" : "dir");
  } else copySkill(registration, version);
}

function formatInstall(registration, dryRun, commit) {
  const verb = registration.action === "keep" ? (dryRun ? "would keep" : "kept")
    : registration.action === "link" ? (dryRun ? "would link" : "linked") : (dryRun ? "would copy" : "copied");
  const mode = commit
    ? registration.exclude === "no git repository to exclude into" ? "portable copy (no git repo)" : "committable (portable copy; run git add to track)"
    : registration.exclude === "no git repository to exclude into" ? "symlink (no git repo to exclude into)"
      : "untracked (local, .git/info/exclude)";
  const exclude = registration.exclude === "no git repository to exclude into" ? "" : `; ${registration.exclude}`;
  return `Burnlist: ${verb} ${registration.source} -> ${registration.target}; mode ${mode}${exclude}.`;
}

function formatGlobal(registration, dryRun) {
  const verb = registration.action === "keep" ? (dryRun ? "would keep" : "kept") : (dryRun ? "would link" : "linked");
  return `Burnlist: ${verb} ${registration.source} -> ${registration.target}; global symlink (no repo exclude).`;
}

export function registerSkills({ sourceRoot, scope = "repo", cwd = process.cwd(), env = process.env, agents, dryRun = false, commit = false, log = console.log }) {
  if (scope === "global" && commit) throw new Error("--commit is only valid for per-repository skill installs");
  const context = scope === "repo" ? gitContext(cwd) : null;
  const register = () => {
    const desired = commit ? "copy" : "link";
    const registrationsForScope = registrations({ sourceRoot, scope, cwd, env, agents });
    if (scope === "repo" && context.git && !commit) {
      for (const registration of registrationsForScope) {
        if (trackedInGit(context.root, registration.target)) {
          throw new Error(`${localExcludeTarget(context.root, registration.target)} is already tracked by git; refusing to hide a tracked skill in .git/info/exclude. Use --commit only with a Burnlist-managed portable copy.`);
        }
      }
    }
    const planned = registrationsForScope.map((registration) => assertInstallable(registration, desired));
    let excludePath;
    let excludeAfter;
    if (scope === "repo" && context.git) {
      excludePath = gitExcludePath(context.root);
      const before = readOptionalText(excludePath);
      excludeAfter = before ?? "";
      for (const registration of planned) {
        const target = localExcludeTarget(context.root, registration.target);
        const previous = excludeAfter;
        excludeAfter = commit
          ? removeOwnedLocalExcludeText(excludeAfter, target, SKILL_EXCLUDE_MARKER)
          : addOwnedLocalExcludeText(excludeAfter, target, SKILL_EXCLUDE_MARKER) ?? excludeAfter;
        registration.exclude = previous === excludeAfter
          ? (commit ? "no owned exclude entry to remove" : "exclude entry already present")
          : (commit
            ? (dryRun ? "would remove owned exclude entry" : "owned exclude entry removed")
            : (dryRun ? "would write exclude entry" : "exclude entry written"));
      }
    }
    for (const registration of planned) registration.exclude ??= "no git repository to exclude into";
    if (!dryRun) {
      const version = commit && planned.some((registration) => registration.action === "copy") ? sourcePackageVersion(sourceRoot) : undefined;
      for (const registration of planned) installTarget(registration, version);
      if (excludePath && readOptionalText(excludePath) !== excludeAfter) writeAtomicText(excludePath, excludeAfter);
    }
    for (const registration of planned) log(scope === "global" ? formatGlobal(registration, dryRun) : formatInstall(registration, dryRun, commit));
    return planned;
  };
  return scope === "repo" && context.git && !dryRun ? withRepoStateLock(context.root, register) : register();
}

export function unregisterSkills({ sourceRoot, scope = "repo", cwd = process.cwd(), env = process.env, agents, dryRun = false, log = console.log, warn = console.warn }) {
  const context = scope === "repo" ? gitContext(cwd) : null;
  const unregister = () => {
    const planned = registrations({ sourceRoot, scope, cwd, env, agents });
    const removed = [];
    let excludePath;
    let excludeBefore;
    let excludeAfter;
    if (scope === "repo" && context.git) {
      excludePath = gitExcludePath(context.root);
      excludeBefore = readOptionalText(excludePath);
      excludeAfter = excludeBefore ?? "";
    }
    for (const registration of planned) {
      const state = targetState(registration);
      if (state !== "link" && state !== "copy") {
        if (state !== "missing") warn(`Burnlist: left ${registration.target} untouched because it is not managed by this package.`);
        continue;
      }
      if (excludeAfter !== undefined) {
        const previous = excludeAfter;
        excludeAfter = removeOwnedLocalExcludeText(excludeAfter, localExcludeTarget(context.root, registration.target), SKILL_EXCLUDE_MARKER);
        registration.exclude = previous === excludeAfter
          ? "no owned exclude entry to remove"
          : (dryRun ? "would remove owned exclude entry" : "owned exclude entry removed");
      }
      if (!dryRun) rmSync(registration.target, { recursive: true, force: true });
      const mode = scope === "global" ? "global symlink (no repo exclude)"
        : state === "copy" ? registration.exclude === undefined ? "portable copy (no git repo)" : "committable (portable copy; run git add to track)"
          : registration.exclude === undefined ? "symlink (no git repo to exclude into)" : "untracked (local, .git/info/exclude)";
      const exclude = scope === "global" || registration.exclude === undefined ? "" : `; ${registration.exclude}`;
      log(`Burnlist: ${dryRun ? "would remove" : "removed"} ${registration.source} -> ${registration.target}; mode ${mode}${exclude}.`);
      removed.push(registration);
    }
    if (!dryRun && excludePath && excludeBefore !== excludeAfter) writeAtomicText(excludePath, excludeAfter);
    return removed;
  };
  return scope === "repo" && context.git && !dryRun ? withRepoStateLock(context.root, unregister) : unregister();
}
