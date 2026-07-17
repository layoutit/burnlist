import { cpSync, existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, readdirSync, renameSync, rmSync, rmdirSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { gitProbe } from "./git-ignore.mjs";
import { addOwnedLocalExcludeText, fsyncDirectory, gitExcludePath, localExcludeTarget, removeOwnedLocalExcludeText, writeAtomicText } from "./local-exclude.mjs";
import { ignoredSkillContent, trackedPathsInGit } from "./skills-install-git.mjs";
import { withGlobalSkillsLock } from "./skills-install-lock.mjs";
import { runInstallTransaction } from "./skills-install-transaction.mjs";
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

export function snapshotManagedSkills({ sourceRoot, scope = "repo", cwd = process.cwd(), env = process.env, agents }) {
  return registrations({ sourceRoot, scope, cwd, env, agents }).flatMap((registration) => {
    const state = targetState(registration);
    return state === "link" || state === "copy" ? [{ ...registration, state }] : [];
  });
}

export function removeSnapshotManagedSkills({ registrations: snapshot, env = process.env, log = console.log, warn = console.warn, remove = rmSync }) {
  const removed = [];
  const failures = [];
  for (const registration of snapshot) {
    try {
      // The package may already be gone, so use the pre-npm snapshot and only
      // remove the same exact managed object that we originally observed.
      if (targetState(registration) !== registration.state) {
        warn(`Burnlist: left ${registration.target} untouched because it is no longer the exact managed registration discovered before purge.`);
        continue;
      }
      remove(registration.target, { recursive: true, force: true });
      removeEmptySkillParents(registration, homeForGlobalTargets(env));
      log(`Burnlist: removed ${registration.source} -> ${registration.target}; global managed registration.`);
      removed.push(registration);
    } catch (error) {
      failures.push({ target: registration.target, error });
    }
  }
  return { removed, failures };
}

function assertInstallable(registration, desired, force) {
  const state = targetState(registration);
  if (state === "foreign-link") throw new Error(`${registration.target} already links to a different skill source (foreign symlink; refusing to overwrite it)`);
  if (state === "foreign") throw new Error(`${registration.target} already exists and is not a Burnlist-managed symlink or provenance-marked portable copy; refusing to overwrite it`);
  if (state === "copy" && desired === "link" && !force) {
    throw new Error(`${registration.target} is a Burnlist-managed portable copy; default install would downgrade a committed copy to a symlink. Run burnlist uninstall first, or pass --force to proceed.`);
  }
  return { ...registration, state, action: state === desired ? "keep" : desired };
}

function copySkill(registration, version, onCreated) {
  const stage = mkdtempSync(join(registration.targetRoot, ".burnlist-skill-"));
  const payload = join(stage, registration.name);
  try {
    cpSync(registration.source, payload, { recursive: true, dereference: true, errorOnExist: true });
    writeAtomicText(join(payload, COPY_MARKER), `${JSON.stringify(copyMarker(registration, version), null, 2)}\n`);
    renameSync(payload, registration.target);
    onCreated?.();
    fsyncDirectory(registration.targetRoot);
  } finally { rmSync(stage, { recursive: true, force: true }); }
}

function createInstallTarget(registration, version, onCreated) {
  if (registration.action === "link") {
    symlinkSync(registration.source, registration.target, process.platform === "win32" ? "junction" : "dir");
    onCreated?.();
  } else copySkill(registration, version, onCreated);
}

function assertUntrackedLocalInstall(repoRoot, registration) {
  const tracked = trackedPathsInGit(repoRoot, registration.target);
  if (!tracked.length) return;
  if (targetState(registration) === "copy") {
    throw new Error(`${registration.target} is a tracked portable copy; refusing to replace it with a local symlink. Run git rm or uninstall with the commit-aware workflow first.`);
  }
  throw new Error(`${localExcludeTarget(repoRoot, registration.target)} is already tracked by git; refusing to hide a tracked skill in .git/info/exclude. Use --commit only with a Burnlist-managed portable copy.`);
}

function formatInstall(registration, dryRun, commit) {
  const verb = registration.action === "keep" ? (dryRun ? "would keep" : "kept")
    : registration.action === "link" ? (dryRun ? "would link" : "linked") : (dryRun ? "would copy" : "copied");
  const mode = commit
    ? registration.exclude === "no git repository to exclude into" ? "portable copy (no git repo)"
      : registration.gitIgnore ? `still ignored (portable copy; ignored by ${registration.gitIgnore})`
        : "committable (portable copy; run git add to track)"
    : registration.exclude === "no git repository to exclude into" ? "symlink (no git repo to exclude into)"
      : "untracked (local, .git/info/exclude)";
  const exclude = registration.exclude === "no git repository to exclude into" ? "" : `; ${registration.exclude}`;
  return `Burnlist: ${verb} ${registration.source} -> ${registration.target}; mode ${mode}${exclude}.`;
}

function formatGlobal(registration, dryRun) {
  const verb = registration.action === "keep" ? (dryRun ? "would keep" : "kept") : (dryRun ? "would link" : "linked");
  return `Burnlist: ${verb} ${registration.source} -> ${registration.target}; global symlink (no repo exclude).`;
}

export function registerSkills({ sourceRoot, scope = "repo", cwd = process.cwd(), env = process.env, agents, dryRun = false, commit = false, force = false, log = console.log, writeAtomic = writeAtomicText, beforeTargetMutation }) {
  if (scope === "global" && commit) throw new Error("--commit is only valid for per-repository skill installs");
  const context = scope === "repo" ? gitContext(cwd) : null;
  const register = () => {
    const desired = commit ? "copy" : "link";
    const registrationsForScope = registrations({ sourceRoot, scope, cwd, env, agents });
    if (scope === "repo" && context.git && !commit) {
      for (const registration of registrationsForScope) {
        assertUntrackedLocalInstall(context.root, registration);
      }
    }
    const planned = registrationsForScope.map((registration) => assertInstallable(registration, desired, force));
    let excludePath;
    let excludeBefore;
    let excludeAfter;
    if (scope === "repo" && context.git) {
      excludePath = gitExcludePath(context.root);
      excludeBefore = readOptionalText(excludePath);
      excludeAfter = excludeBefore ?? "";
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
      runInstallTransaction({
        planned,
        revalidate: (registration) => {
          if (scope === "repo" && context.git && !commit) assertUntrackedLocalInstall(context.root, registration);
          return assertInstallable(registration, desired, force);
        },
        create: (registration, onCreated) => createInstallTarget(registration, version, onCreated),
        beforeMutation: beforeTargetMutation,
        exclude: excludePath && readOptionalText(excludePath) !== excludeAfter ? {
          changed: true,
          write: () => writeAtomic(excludePath, excludeAfter),
          restore: () => {
            if (excludeBefore === undefined) rmSync(excludePath, { force: true });
            else writeAtomicText(excludePath, excludeBefore);
          },
          afterWrite: commit ? () => {
            for (const registration of planned) registration.gitIgnore = ignoredSkillContent(context.root, registration, COPY_MARKER);
          } : undefined,
        } : commit && context.git ? {
          afterWrite: () => {
            for (const registration of planned) registration.gitIgnore = ignoredSkillContent(context.root, registration, COPY_MARKER);
          },
        } : undefined,
      });
    }
    for (const registration of planned) log(scope === "global" ? formatGlobal(registration, dryRun) : formatInstall(registration, dryRun, commit));
    return planned;
  };
  if (dryRun) return register();
  if (scope === "repo" && context.git) return withRepoStateLock(context.root, register);
  return scope === "global" ? withGlobalSkillsLock(env, register) : register();
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
      if (excludeAfter !== undefined) {
        const previous = excludeAfter;
        excludeAfter = removeOwnedLocalExcludeText(excludeAfter, localExcludeTarget(context.root, registration.target), SKILL_EXCLUDE_MARKER);
        registration.exclude = previous === excludeAfter
          ? "no owned exclude entry to remove"
          : (dryRun ? "would remove owned exclude entry" : "owned exclude entry removed");
      }
    }
    for (const registration of planned) {
      const state = targetState(registration);
      if (state !== "link" && state !== "copy") {
        if (state !== "missing") warn(`Burnlist: left ${registration.target} untouched because it is not managed by this package.`);
        continue;
      }
      if (!dryRun) {
        rmSync(registration.target, { recursive: true, force: true });
        removeEmptySkillParents(registration, scope === "repo" ? context.root : homeForGlobalTargets(env));
      }
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
  if (dryRun) return unregister();
  if (scope === "repo" && context.git) return withRepoStateLock(context.root, unregister);
  return scope === "global" ? withGlobalSkillsLock(env, unregister) : unregister();
}

function isWithin(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent === "" || (pathFromParent !== ".." && !pathFromParent.startsWith(`..${sep}`) && !isAbsolute(pathFromParent));
}

function removeEmptySkillParents(registration, boundary) {
  const stop = boundary && isWithin(boundary, registration.targetRoot) ? resolve(boundary) : registration.targetRoot;
  let current = registration.targetRoot;
  while (current !== stop) {
    try { rmdirSync(current); } catch (error) {
      if (error.code === "ENOENT") { current = dirname(current); continue; }
      if (error.code === "ENOTEMPTY") return;
      throw error;
    }
    current = dirname(current);
  }
}
