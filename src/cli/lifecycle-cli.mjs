#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  LIFECYCLES,
  parsePlan,
  summaryForPlan,
  twoDigit,
} from "../server/plan-model.mjs";
import {
  assertValidBurnlistId,
  burnItem,
  closeLifecycle,
  publishLifecycleChange,
  readyLifecycle,
  startLifecycle,
} from "./lifecycle-moves.mjs";
import { repoKey, readRegistry } from "../server/registry.mjs";
import { atomicDirectory, safeStat } from "../server/fs-safe.mjs";
import { resolveUmbrella } from "./umbrella.mjs";

const MAX_RESERVATION_ATTEMPTS = 1000;

function fail(message, code = 1) {
  console.error(`burnlist: ${message}`);
  process.exitCode = code;
}

function usage() {
  fail("Usage: burnlist new [--repo <path>] | burnlist show <id>[#<item>] [--repo <path>] | burnlist ready|start|close <id> [--repo <path>] | burnlist burn <id> <item> [--check] [--repo <path>]", 2);
}

function parseArgs(tokens) {
  const opts = { check: false, repo: null, positionals: [] };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--repo") {
      const value = tokens[index + 1];
      if (!value || value.startsWith("--")) throw new Error("--repo requires a path.");
      opts.repo = value;
      index += 1;
    } else if (token === "--check") {
      opts.check = true;
    } else if (token.startsWith("--")) {
      throw new Error(`Unknown option: ${token}`);
    } else {
      opts.positionals.push(token);
    }
  }
  return opts;
}

export function resolveRepo(opts) {
  return opts.repo ? resolve(process.cwd(), opts.repo) : resolveUmbrella(process.cwd());
}

function localDayId(date = new Date()) {
  return `${twoDigit(date.getFullYear() % 100)}${twoDigit(date.getMonth() + 1)}${twoDigit(date.getDate())}`;
}

function lifecycleRoot(repoRoot, lifecycle) {
  return join(repoRoot, "notes", "burnlists", lifecycle.folder);
}

function allocatedStart(repoRoot, day) {
  let highest = 0;
  const pattern = new RegExp(`^${day}-(\\d{3})$`, "u");
  for (const lifecycle of LIFECYCLES) {
    const root = lifecycleRoot(repoRoot, lifecycle);
    if (!safeStat(root)?.isDirectory()) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      const match = entry.name.match(pattern);
      if (match) highest = Math.max(highest, Number(match[1]));
    }
  }
  return highest + 1;
}

function scaffold(id, repoRoot, date) {
  const updated = `${date.getFullYear()}-${twoDigit(date.getMonth() + 1)}-${twoDigit(date.getDate())}`;
  return {
    "burnlist.md": [
      `# ${id} Burnlist`,
      "",
      "Status: Burnlist Final",
      `Updated: ${updated}`,
      `Repo: \`${repoRoot}\``,
      "Goal: ./goal.md",
      "",
      "## Active Checklist",
      "",
      "## Completed",
      "",
    ].join("\n"),
    "goal.md": [
      `# ${id} Goal`,
      "",
      `Repo: \`${repoRoot}\``,
      "",
      "## Goal",
      "## Guardrails",
      "## Proof Authority",
      "## Ordering Intent",
      "## Stop Conditions",
      "## Handoff",
      "",
    ].join("\n"),
  };
}

function create(repoRoot) {
  const canonicalRoot = realpathSync(repoRoot);
  const draftRoot = lifecycleRoot(canonicalRoot, LIFECYCLES[0]);
  const now = new Date();
  const day = localDayId(now);
  let number = allocatedStart(canonicalRoot, day);
  for (let attempt = 0; attempt < MAX_RESERVATION_ATTEMPTS; attempt += 1, number += 1) {
    if (number > 999) break;
    const id = `${day}-${String(number).padStart(3, "0")}`;
    try {
      const folder = atomicDirectory(draftRoot, id, scaffold(id, canonicalRoot, now));
      const planPath = join(folder, "burnlist.md");
      publishLifecycleChange(canonicalRoot, id, "none", "draft", { occurredAt: now.toISOString() });
      console.log(id);
      console.log(planPath);
      console.log(`${repoKey(canonicalRoot)}/${id}`);
      return;
    } catch (error) {
      if (error?.code === "ENOTEMPTY" || error?.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error(`No available Burnlist ids remain for ${day}.`);
}

function parseReference(value) {
  const [reference, item] = value.split("#", 2);
  if (!reference || value.split("#").length > 2) throw new Error(`Invalid Burnlist reference: ${value}`);
  const parts = reference.split("/");
  if (parts.length > 2 || !parts.every(Boolean)) throw new Error(`Invalid Burnlist reference: ${value}`);
  const [key, id] = parts.length === 2 ? parts : [null, parts[0]];
  if (key && !/^[0-9a-f]{12}$/u.test(key)) throw new Error(`Invalid repository key: ${key}`);
  assertValidBurnlistId(id);
  if (item !== undefined && !item.trim()) throw new Error("Item id must not be empty.");
  return { key, id, item: item?.trim() ?? null };
}

function rootsForKey(key) {
  const candidates = new Set([resolveUmbrella(process.cwd())]);
  for (const entry of readRegistry().roots) candidates.add(entry.root);
  const matches = [];
  for (const root of candidates) {
    try {
      const canonical = realpathSync(root);
      if (repoKey(canonical) === key) matches.push(canonical);
    } catch {
      // Missing registry entries are ignored while resolving a copy handle.
    }
  }
  return [...new Set(matches)];
}

function findPlan(repoRoot, id) {
  const matches = LIFECYCLES.flatMap((lifecycle) => {
    const folder = join(lifecycleRoot(repoRoot, lifecycle), id);
    return safeStat(folder)?.isDirectory() ? [{ lifecycle, folder }] : [];
  });
  if (matches.length === 0) throw new Error(`Burnlist ${id} was not found in ${repoRoot}.`);
  if (matches.length > 1) {
    throw new Error(`Burnlist ${id} is ambiguous across ${matches.map((match) => match.lifecycle.folder).join(", ")}.`);
  }
  const planPath = join(matches[0].folder, "burnlist.md");
  if (!safeStat(planPath)?.isFile()) throw new Error(`Burnlist ${id} has no burnlist.md: ${planPath}`);
  return { planPath, lifecycle: matches[0].lifecycle };
}

function printItem(plan, itemId) {
  const item = plan.items.find((entry) => entry.id === itemId);
  if (item) {
    console.log(`${item.id} | ${item.title}`);
    for (const [name, value] of Object.entries(item.fields)) console.log(`${name}: ${value}`);
    return;
  }
  const completed = plan.completed.find((entry) => entry.id === itemId);
  if (completed) {
    console.log(`${completed.id} | ${completed.title}`);
    console.log(`Completed: ${completed.completedAt}`);
    return;
  }
  console.log(`Item ${itemId}: not found`);
}

function show(reference, opts) {
  const parsed = parseReference(reference);
  let repoRoot;
  if (parsed.key) {
    const matches = rootsForKey(parsed.key);
    if (matches.length === 0) throw new Error(`No discovered or registered repository matches ${parsed.key}.`);
    if (matches.length > 1) throw new Error(`Repository key ${parsed.key} is ambiguous.`);
    [repoRoot] = matches;
  } else {
    repoRoot = realpathSync(resolveRepo(opts));
  }
  const { planPath, lifecycle } = findPlan(repoRoot, parsed.id);
  const plan = parsePlan(planPath);
  const summary = summaryForPlan(planPath);
  if (parsed.item) {
    printItem(plan, parsed.item);
  } else {
    console.log(`Title: ${plan.title}`);
    console.log(`Status: ${lifecycle.label}`);
    console.log(`Progress: ${summary.done}/${summary.total} (${summary.percent}%)`);
    console.log("Active Checklist:");
    for (const item of plan.items) console.log(`- ${item.id} | ${item.title}`);
    console.log("Completed:");
    for (const item of plan.completed) console.log(`- ${item.id} | ${item.completedAt} | ${item.title}`);
  }
  const handle = `${repoKey(repoRoot)}/${parsed.id}${parsed.item ? `#${parsed.item}` : ""}`;
  console.log(`Copy handle: ${handle}`);
  const globalServerPath = join(homedir(), ".burnlist", "server.json");
  try {
    if (existsSync(globalServerPath)) {
      const server = JSON.parse(readFileSync(globalServerPath, "utf8"));
      process.kill(server.pid, 0);
      const base = String(server.url).endsWith("/") ? server.url : `${server.url}/`;
      console.log(`URL: ${base}r/${handle}`);
    }
  } catch {
    // A stale or malformed global dashboard record must not affect show.
  }
  console.log(`Path: ${planPath}`);
  console.log(`Title: ${plan.title}`);
}

async function main() {
  const tokens = process.argv.slice(2);
  const verb = tokens.shift();
  const opts = parseArgs(tokens);
  if (verb === "new" && opts.positionals.length === 0) return create(resolveRepo(opts));
  if (verb === "show" && opts.positionals.length === 1) return show(opts.positionals[0], opts);
  if (verb === "ready" && opts.positionals.length === 1) {
    const id = assertValidBurnlistId(opts.positionals[0]);
    return readyLifecycle(resolveRepo(opts), id);
  }
  if (verb === "start" && opts.positionals.length === 1) {
    const id = assertValidBurnlistId(opts.positionals[0]);
    return startLifecycle(resolveRepo(opts), id);
  }
  if (verb === "close" && opts.positionals.length === 1) {
    const id = assertValidBurnlistId(opts.positionals[0]);
    return closeLifecycle(resolveRepo(opts), id);
  }
  if (verb === "burn" && opts.positionals.length === 2) {
    const id = assertValidBurnlistId(opts.positionals[0]);
    if (!burnItem(resolveRepo(opts), id, opts.positionals[1], opts.check)) process.exitCode = 1;
    return;
  }
  usage();
}

try {
  await main();
} catch (error) {
  fail(error?.message ?? String(error));
}
