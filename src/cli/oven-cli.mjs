#!/usr/bin/env node
// Oven CLI: create, update, view, and list Ovens from the terminal.
//
// The dashboard's New Oven form is the interactive surface; this is the
// scriptable one, meant for an agent to author Ovens without hand-writing
// JSON. It reuses the normative validators in oven-contract.mjs and does its
// own file plumbing so it never has to import the dashboard server (which
// boots an HTTP listener on import). Like the dashboard, it can only create or
// replace custom Ovens under ignored local state; it never executes anything.
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOvenPackage, ovenId, ovenRevision } from "../ovens/oven-contract.mjs";
import { bindingStorePath, readBindingStore, removeBinding, writeBinding } from "../server/oven-bindings.mjs";
import { resolveCustomOvensDir } from "../server/oven-storage.mjs";
import { renderGrid, sectionTable } from "./oven-cli-render.mjs";
import { createOvenCatalog, persistOven, resolvePackageInput } from "./oven-storage.mjs";
import { resolveUmbrella } from "./umbrella.mjs";

// ── argv ────────────────────────────────────────────────────────────────────
// process.argv is [node, bin/burnlist.mjs, "oven", <subcommand>, ...rest].
const tokens = process.argv.slice(2);
if (tokens[0] === "oven") tokens.shift();
const subcommand = tokens.shift() ?? "help";

const flags = new Map();
const positionals = [];
for (let index = 0; index < tokens.length; index += 1) {
  const token = tokens[index];
  if (token.startsWith("--")) {
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(key, next);
      index += 1;
    } else {
      flags.set(key, "true");
    }
  } else {
    positionals.push(token);
  }
}

function fail(message) {
  console.error(`burnlist oven: ${message}`);
  process.exit(1);
}

function repoRoot() {
  if (flags.get("repo") === "true") fail("--repo requires a path.");
  return flags.has("repo") ? resolve(launchCwd, flags.get("repo")) : resolveUmbrella(launchCwd);
}

function bindingRepo() {
  return repoRoot();
}

// ── storage locations (mirror the dashboard server) ──────────────────────────
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const builtInOvensDir = resolve(packageRoot, "ovens");
const launchCwd = process.cwd();
const customRepoRoot = repoRoot();
if (flags.get("ovens-dir") === "true") fail("--ovens-dir requires a path.");
const unsafeOvensDir = flags.has("unsafe-ovens-dir");
const customOvensDir = resolveCustomOvensDir(
  customRepoRoot,
  flags.has("ovens-dir") ? flags.get("ovens-dir") : undefined,
  { unsafe: unsafeOvensDir },
);

const { readOvenDir, discoverOvens, findOven } = createOvenCatalog({
  builtInOvensDir,
  customOvensDir,
  customRepoRoot,
  unsafeOvensDir,
});

function printOven(oven) {
  const cellWidth = Number(flags.get("cell-width") ?? 8);
  const cellHeight = Number(flags.get("cell-height") ?? 2);
  if (!Number.isInteger(cellWidth) || cellWidth < 4 || cellWidth > 24) fail("--cell-width must be an integer from 4 to 24.");
  if (!Number.isInteger(cellHeight) || cellHeight < 2 || cellHeight > 6) fail("--cell-height must be an integer from 2 to 6.");
  const kind = oven.builtIn ? "built-in" : "custom";
  console.log(`${oven.name}  (${oven.id} · ${kind})`);
  if (oven.description) console.log(oven.description);
  console.log(`grid: ${oven.detail.columns} cols × ${oven.detail.rows} rows · ${oven.detail.cells.length} sections`);
  console.log(`revision: ${oven.ovenRevision}`);
  console.log(`path: ${oven.path}`);
  console.log("");
  console.log(renderGrid(oven.detail, cellWidth, cellHeight));
  console.log("");
  console.log(sectionTable(oven.detail));
}

function assertCustomTarget(id, verb) {
  const existing = findOven(id);
  if (existing?.builtIn) {
    throw new Error(`Oven ${id} is built-in and read-only. Fork it: \`oven fork ${id} <new-id>\`.`);
  }
  if (verb === "update" && !existing) throw new Error(`Oven ${id} does not exist. Use \`oven create\` instead.`);
}

// ── subcommands ───────────────────────────────────────────────────────────────
const HELP = `burnlist oven — author and inspect Ovens

Usage:
  burnlist oven list [--json]
  burnlist oven view <id> [--json] [--cell-width <n>] [--cell-height <n>]
  burnlist oven bind <id> <path> [--repo <path>]
  burnlist oven unbind <id> [--repo <path>]
  burnlist oven bindings [--repo <path>]
  burnlist oven create <id> --instructions <file|-> --detail <file|-> [--name <text>]
  burnlist oven create <id> --dir <dir>            (reads instructions.md + detail.json)
  burnlist oven create <id> --package <file|->     (JSON: {name?, instructions, detail})
  burnlist oven update <id> [same inputs as create]
  burnlist oven fork <id> <newId>

Options:
  --name <text>        Set the Oven name (owns the level-one heading).
  --instructions <p>   Markdown instructions file, or - for stdin.
  --detail <p>         detail.json file, or - for stdin.
  --dir <p>            Directory containing instructions.md and detail.json.
  --package <p>        JSON package file, or - for stdin.
  --repo <p>           Repository whose local Oven bindings to use.
  --ovens-dir <p>      Custom Oven storage (default .local/burnlist/ovens).
  --unsafe-ovens-dir   Permit --ovens-dir outside repo-local state.
  --force              On create, replace an existing custom Oven.
  --json               Machine-readable output for list/view.

Custom Ovens live under ignored local state and only affect future Runs.
Built-in Ovens are read-only; this command never executes Oven instructions.`;

try {
  if (subcommand === "help" || flags.has("help")) {
    console.log(HELP);
    process.exit(0);
  }

  if (subcommand === "list") {
    const ovens = discoverOvens();
    if (flags.has("json")) {
      console.log(JSON.stringify(ovens.map(({ instructions, ...rest }) => rest), null, 2));
      process.exit(0);
    }
    if (ovens.length === 0) {
      console.log("No Ovens found.");
      process.exit(0);
    }
    const rows = ovens.map((oven) => [
      oven.id,
      oven.name,
      oven.builtIn ? "built-in" : "custom",
      `${oven.detail.columns}×${oven.detail.rows}`,
      String(oven.detail.cells.length),
      oven.ovenRevision,
    ]);
    const header = ["id", "name", "kind", "grid", "sections", "revision"];
    const widths = header.map((label, index) => Math.max(label.length, ...rows.map((row) => row[index].length)));
    const line = (cols) => cols.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
    console.log(line(header));
    console.log(line(widths.map((width) => "─".repeat(width))));
    for (const row of rows) console.log(line(row));
    process.exit(0);
  }

  if (subcommand === "view") {
    const id = positionals[0];
    if (!id) fail("Usage: burnlist oven view <id>");
    const oven = findOven(id);
    if (!oven) fail(`Unknown Oven "${id}". Run \`burnlist oven list\`.`);
    if (flags.has("json")) {
      console.log(JSON.stringify({
        id: oven.id,
        name: oven.name,
        builtIn: oven.builtIn,
        instructions: oven.instructions,
        detail: oven.detail,
        ovenRevision: oven.ovenRevision,
        ...(oven.forkedFrom ? { forkedFrom: oven.forkedFrom } : {}),
      }, null, 2));
      process.exit(0);
    }
    printOven(oven);
    process.exit(0);
  }

  if (subcommand === "bind") {
    const [id, logicalPath] = positionals;
    if (!id || logicalPath === undefined) fail("Usage: burnlist oven bind <id> <path> [--repo <path>]");
    const repoRoot = bindingRepo();
    const result = writeBinding(repoRoot, id, logicalPath, new Date().toISOString());
    console.log(`Bound Oven ${ovenId(id)} to ${logicalPath}\nStore: ${result.path}`);
    process.exit(0);
  }

  if (subcommand === "unbind") {
    const id = positionals[0];
    if (!id) fail("Usage: burnlist oven unbind <id> [--repo <path>]");
    const repoRoot = bindingRepo();
    if (removeBinding(repoRoot, id)) console.log(`Unbound Oven ${ovenId(id)} from ${bindingStorePath(repoRoot)}`);
    else console.log(`No binding exists for Oven ${ovenId(id)} in ${bindingStorePath(repoRoot)}.`);
    process.exit(0);
  }

  if (subcommand === "bindings") {
    const repoRoot = bindingRepo();
    const store = readBindingStore(repoRoot);
    const entries = Object.entries(store.bindings).sort(([left], [right]) => left.localeCompare(right));
    if (entries.length === 0) console.log(`No Oven bindings in ${bindingStorePath(repoRoot)}.`);
    else {
      console.log(`Oven bindings: ${bindingStorePath(repoRoot)}`);
      for (const [id, binding] of entries) console.log(`${id}  ${binding.path}  ${binding.boundAt}`);
    }
    process.exit(0);
  }

  if (subcommand === "create" || subcommand === "update") {
    const pkg = resolvePackageInput({ flags, positionals });
    assertCustomTarget(pkg.id, subcommand);
    const allowReplace = subcommand === "update" || flags.has("force");
    const path = persistOven({ customRepoRoot, customOvensDir, unsafeOvensDir }, pkg, { allowReplace });
    const saved = readOvenDir(customOvensDir, pkg.id, false);
    console.log(`${subcommand === "update" ? "Updated" : "Created"} Oven ${pkg.id} at ${path}\n`);
    printOven(saved);
    process.exit(0);
  }

  if (subcommand === "fork") {
    const [sourceId, newId] = positionals;
    if (!sourceId || !newId) fail("Usage: burnlist oven fork <id> <newId>");
    const source = findOven(sourceId);
    if (!source) fail(`Unknown Oven "${sourceId}". Run \`burnlist oven list\`.`);
    const pkg = normalizeOvenPackage({ id: ovenId(newId), instructions: source.instructions, detail: source.detail });
    const sourceRevision = ovenRevision(source);
    if (findOven(pkg.id)) throw new Error(`Oven ${pkg.id} already exists.`);
    const path = persistOven({ customRepoRoot, customOvensDir, unsafeOvensDir }, pkg, {
      allowReplace: false,
      sidecar: { forkedFrom: { ovenId: source.id, revision: sourceRevision } },
    });
    console.log(`Forked Oven ${pkg.id} at ${path}\nForked from ${source.id}@${sourceRevision}`);
    process.exit(0);
  }

  fail(`Unknown subcommand "${subcommand}". Run \`burnlist oven help\`.`);
} catch (error) {
  fail(error.message);
}
