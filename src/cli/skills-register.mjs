import {
  existsSync,
  lstatSync,
  mkdirSync,
  readlinkSync,
  readdirSync,
  rmSync,
  symlinkSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

import { gitProbe } from "./git-ignore.mjs";

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

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function linkedSource(path) {
  return resolve(dirname(path), readlinkSync(path));
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

export function targetRoots({ scope, cwd = process.cwd(), env = process.env }) {
  if (!Object.hasOwn(TARGETS.claude, scope)) throw new Error(`unknown skill registration scope: ${scope}`);
  const home = scope === "global" ? homeForGlobalTargets(env) : undefined;
  const repoRoot = scope === "repo" ? resolveRepoRoot(cwd) : undefined;
  return Object.entries(TARGETS).map(([agent, targets]) => ({
    agent,
    root: targets[scope]({ env, home, repoRoot }),
  }));
}

function registrations({ sourceRoot, scope, cwd, env }) {
  return targetRoots({ scope, cwd, env }).flatMap(({ agent, root }) => skillNames(sourceRoot).map(({ name, source }) => ({
    agent,
    name,
    source,
    target: resolve(root, name),
    targetRoot: root,
  })));
}

function registrationState(registration) {
  const stat = lstatOrNull(registration.target);
  if (!stat) return "link";
  if (!stat.isSymbolicLink()) {
    throw new Error(`${registration.target} already exists and is not a Burnlist-managed symlink`);
  }
  if (linkedSource(registration.target) !== registration.source) {
    throw new Error(`${registration.target} already links to a different skill source`);
  }
  return "keep";
}

export function registerSkills({ sourceRoot, scope = "repo", cwd = process.cwd(), env = process.env, dryRun = false, log = console.log }) {
  const planned = registrations({ sourceRoot, scope, cwd, env }).map((registration) => ({
    ...registration,
    action: registrationState(registration),
  }));
  if (!dryRun) {
    for (const targetRoot of new Set(planned.map((registration) => registration.targetRoot))) {
      mkdirSync(targetRoot, { recursive: true });
    }
  }
  for (const registration of planned) {
    if (registration.action === "link" && !dryRun) {
      symlinkSync(registration.source, registration.target, process.platform === "win32" ? "junction" : "dir");
    }
    const verb = registration.action === "keep" ? (dryRun ? "would keep" : "kept") : (dryRun ? "would link" : "linked");
    log(`Burnlist: ${verb} ${registration.source} -> ${registration.target}`);
  }
  return planned;
}

export function unregisterSkills({ sourceRoot, scope = "repo", cwd = process.cwd(), env = process.env, dryRun = false, log = console.log, warn = console.warn }) {
  const planned = registrations({ sourceRoot, scope, cwd, env });
  const removed = [];
  for (const registration of planned) {
    const stat = lstatOrNull(registration.target);
    if (!stat) continue;
    if (!stat.isSymbolicLink() || linkedSource(registration.target) !== registration.source) {
      warn(`Burnlist: left ${registration.target} untouched because it is not managed by this package.`);
      continue;
    }
    if (!dryRun) rmSync(registration.target, { force: true });
    log(`Burnlist: ${dryRun ? "would unlink" : "unlinked"} ${registration.source} -> ${registration.target}`);
    removed.push(registration);
  }
  return removed;
}
