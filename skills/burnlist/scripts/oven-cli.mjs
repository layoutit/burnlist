#!/usr/bin/env node
// Oven CLI: create, update, view, and list Ovens from the terminal.
//
// The dashboard's New Oven form is the interactive surface; this is the
// scriptable one, meant for an agent to author Ovens without hand-writing
// JSON. It reuses the normative validators in oven-contract.mjs and does its
// own file plumbing so it never has to import the dashboard server (which
// boots an HTTP listener on import). Like the dashboard, it can only create or
// replace custom Ovens under ignored local state; it never executes anything.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOvenDetail, normalizeOvenPackage, ovenId } from "./oven-contract.mjs";
import { renderGrid, sectionTable } from "./oven-cli-render.mjs";

const MAX_INSTRUCTION_BYTES = 65536;
const MAX_DETAIL_BYTES = 131072;

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

// ── storage locations (mirror the dashboard server) ──────────────────────────
const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const builtInOvensDir = resolve(skillDir, "ovens");
const legacyBuiltInTypesDir = resolve(skillDir, "types");
const launchCwd = process.cwd();
const customOvensDir = resolve(launchCwd, flags.get("ovens-dir") ?? ".local/burnlist/ovens");
const legacyCustomTypesDir = resolve(launchCwd, flags.get("types-dir") ?? ".local/burnlist/types");

function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function readTextFileWithLimit(path, maxBytes, label) {
  const stat = statSync(path);
  if (stat.size > maxBytes) throw new Error(`${label} is ${stat.size} bytes, over the ${maxBytes} byte limit.`);
  return readFileSync(path, "utf8");
}

function instructionsName(instructions, fallback) {
  const heading = instructions.split(/\r?\n/u).find((line) => /^#\s+\S/u.test(line.trim()));
  return heading ? heading.trim().replace(/^#\s+/u, "").trim() : fallback;
}

function instructionsDescription(instructions) {
  return (
    instructions
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#")) ?? ""
  );
}

// Read one Oven directory, tolerating the legacy definition.md/dashboard.json
// filenames so `view`/`list` match what the dashboard discovers.
function readOvenDir(root, id, builtIn) {
  const safeId = ovenId(id);
  const ovenRoot = join(root, safeId);
  const instructionsPath = safeStat(join(ovenRoot, "instructions.md"))?.isFile()
    ? join(ovenRoot, "instructions.md")
    : join(ovenRoot, "definition.md");
  const detailPath = safeStat(join(ovenRoot, "detail.json"))?.isFile()
    ? join(ovenRoot, "detail.json")
    : join(ovenRoot, "dashboard.json");
  if (!safeStat(instructionsPath)?.isFile() || !safeStat(detailPath)?.isFile()) return null;
  const ovenPackage = normalizeOvenPackage({
    id: safeId,
    instructions: readTextFileWithLimit(instructionsPath, MAX_INSTRUCTION_BYTES, "Oven instructions"),
    detail: JSON.parse(readTextFileWithLimit(detailPath, MAX_DETAIL_BYTES, "Oven detail template")),
  });
  return {
    id: ovenPackage.id,
    name: instructionsName(ovenPackage.instructions, safeId),
    description: instructionsDescription(ovenPackage.instructions),
    builtIn,
    path: ovenRoot,
    instructions: ovenPackage.instructions,
    detail: ovenPackage.detail,
  };
}

function ovensIn(root, builtIn) {
  if (!safeStat(root)?.isDirectory()) return [];
  return readdirSync(root)
    .filter((id) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(id))
    .map((id) => {
      try {
        return readOvenDir(root, id, builtIn);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function discoverOvens() {
  const byId = new Map();
  for (const oven of ovensIn(builtInOvensDir, true)) byId.set(oven.id, oven);
  for (const oven of ovensIn(legacyBuiltInTypesDir, true)) if (!byId.has(oven.id)) byId.set(oven.id, oven);
  for (const oven of ovensIn(legacyCustomTypesDir, false)) if (!byId.has(oven.id)) byId.set(oven.id, oven);
  for (const oven of ovensIn(customOvensDir, false)) if (!byId.get(oven.id)?.builtIn) byId.set(oven.id, oven);
  return [...byId.values()].sort(
    (left, right) => Number(right.builtIn) - Number(left.builtIn) || left.name.localeCompare(right.name),
  );
}

function findOven(id) {
  const safeId = ovenId(id);
  return discoverOvens().find((oven) => oven.id === safeId) ?? null;
}

function printOven(oven) {
  const cellWidth = Number(flags.get("cell-width") ?? 8);
  const cellHeight = Number(flags.get("cell-height") ?? 2);
  if (!Number.isInteger(cellWidth) || cellWidth < 4 || cellWidth > 24) fail("--cell-width must be an integer from 4 to 24.");
  if (!Number.isInteger(cellHeight) || cellHeight < 2 || cellHeight > 6) fail("--cell-height must be an integer from 2 to 6.");
  const kind = oven.builtIn ? "built-in" : "custom";
  console.log(`${oven.name}  (${oven.id} · ${kind})`);
  if (oven.description) console.log(oven.description);
  console.log(`grid: ${oven.detail.columns} cols × ${oven.detail.rows} rows · ${oven.detail.cells.length} sections`);
  console.log(`path: ${oven.path}`);
  console.log("");
  console.log(renderGrid(oven.detail, cellWidth, cellHeight));
  console.log("");
  console.log(sectionTable(oven.detail));
}

// ── input resolution for create/update ───────────────────────────────────────
function readInput(spec, maxBytes, label) {
  if (spec === "-") {
    const value = readFileSync(0, "utf8");
    if (Buffer.byteLength(value, "utf8") > maxBytes) throw new Error(`${label} exceeds the ${maxBytes} byte limit.`);
    return value;
  }
  return readTextFileWithLimit(resolve(spec), maxBytes, label);
}

function resolvePackageInput() {
  const pkg = {};
  if (flags.has("package")) {
    Object.assign(pkg, JSON.parse(readInput(flags.get("package"), MAX_DETAIL_BYTES, "Oven package")));
  }
  if (flags.has("dir")) {
    const dir = resolve(flags.get("dir"));
    const instructionsPath = safeStat(join(dir, "instructions.md"))?.isFile()
      ? join(dir, "instructions.md")
      : join(dir, "definition.md");
    const detailPath = safeStat(join(dir, "detail.json"))?.isFile() ? join(dir, "detail.json") : join(dir, "dashboard.json");
    pkg.instructions = readTextFileWithLimit(instructionsPath, MAX_INSTRUCTION_BYTES, "Oven instructions");
    pkg.detail = JSON.parse(readTextFileWithLimit(detailPath, MAX_DETAIL_BYTES, "Oven detail template"));
  }
  if (flags.has("instructions")) pkg.instructions = readInput(flags.get("instructions"), MAX_INSTRUCTION_BYTES, "Oven instructions");
  if (flags.has("detail")) pkg.detail = JSON.parse(readInput(flags.get("detail"), MAX_DETAIL_BYTES, "Oven detail template"));

  const id = ovenId(positionals[0] ?? pkg.id ?? flags.get("id") ?? "");
  const name = flags.has("name") ? String(flags.get("name")).trim() : String(pkg.name ?? "").trim();
  if (pkg.instructions === undefined) throw new Error("Provide instructions via --instructions, --package, or --dir.");
  if (pkg.detail === undefined) throw new Error("Provide a detail skeleton via --detail, --package, or --dir.");

  // Match the dashboard: an explicit name owns the level-one heading; otherwise
  // the instructions must already carry one (normalizeOvenPackage enforces it).
  let instructions = String(pkg.instructions);
  if (name) {
    const lines = instructions.split(/\r?\n/u);
    const headingIndex = lines.findIndex((line) => /^#\s+\S/u.test(line.trim()));
    if (headingIndex === -1) lines.unshift(`# ${name}`, "");
    else lines[headingIndex] = `# ${name}`;
    instructions = lines.join("\n");
  }

  const normalized = normalizeOvenPackage({ id, instructions, detail: normalizeOvenDetail(pkg.detail) });
  return normalized;
}

function writeFileAtomic(dir, name, contents) {
  const temporary = join(dir, `.${name}.${randomBytes(6).toString("hex")}`);
  writeFileSync(temporary, contents);
  renameSync(temporary, join(dir, name));
}

function persistOven(pkg, { allowReplace }) {
  const files = {
    "instructions.md": `${pkg.instructions}\n`,
    "detail.json": `${JSON.stringify(pkg.detail, null, 2)}\n`,
  };
  const target = join(customOvensDir, pkg.id);
  if (existsSync(target)) {
    if (!allowReplace) throw new Error(`Oven ${pkg.id} already exists. Use \`oven update ${pkg.id}\` or --force.`);
    for (const [name, contents] of Object.entries(files)) writeFileAtomic(target, name, contents);
    return target;
  }
  mkdirSync(customOvensDir, { recursive: true });
  const temporary = join(customOvensDir, `.${pkg.id}.${randomBytes(6).toString("hex")}`);
  mkdirSync(temporary);
  try {
    for (const [name, contents] of Object.entries(files)) writeFileSync(join(temporary, name), contents);
    renameSync(temporary, target);
  } catch (error) {
    rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
  return target;
}

function assertCustomTarget(id, verb) {
  const existing = findOven(id);
  if (existing?.builtIn) {
    throw new Error(`Oven ${id} is built-in and read-only. Fork it: \`oven create <new-id> --dir ${existing.path}\`.`);
  }
  if (verb === "update" && !existing) throw new Error(`Oven ${id} does not exist. Use \`oven create\` instead.`);
}

// ── subcommands ───────────────────────────────────────────────────────────────
const HELP = `burnlist oven — author and inspect Ovens

Usage:
  burnlist oven list [--json]
  burnlist oven view <id> [--json] [--cell-width <n>] [--cell-height <n>]
  burnlist oven create <id> --instructions <file|-> --detail <file|-> [--name <text>]
  burnlist oven create <id> --dir <dir>            (reads instructions.md + detail.json)
  burnlist oven create <id> --package <file|->     (JSON: {name?, instructions, detail})
  burnlist oven update <id> [same inputs as create]

Options:
  --name <text>        Set the Oven name (owns the level-one heading).
  --instructions <p>   Markdown instructions file, or - for stdin.
  --detail <p>         detail.json file, or - for stdin.
  --dir <p>            Directory containing instructions.md and detail.json.
  --package <p>        JSON package file, or - for stdin.
  --ovens-dir <p>      Custom Oven storage (default .local/burnlist/ovens).
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
    ]);
    const header = ["id", "name", "kind", "grid", "sections"];
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
      console.log(JSON.stringify({ id: oven.id, name: oven.name, builtIn: oven.builtIn, instructions: oven.instructions, detail: oven.detail }, null, 2));
      process.exit(0);
    }
    printOven(oven);
    process.exit(0);
  }

  if (subcommand === "create" || subcommand === "update") {
    const pkg = resolvePackageInput();
    assertCustomTarget(pkg.id, subcommand);
    const allowReplace = subcommand === "update" || flags.has("force");
    const path = persistOven(pkg, { allowReplace });
    const saved = readOvenDir(customOvensDir, pkg.id, false);
    console.log(`${subcommand === "update" ? "Updated" : "Created"} Oven ${pkg.id} at ${path}\n`);
    printOven(saved);
    process.exit(0);
  }

  fail(`Unknown subcommand "${subcommand}". Run \`burnlist oven help\`.`);
} catch (error) {
  fail(error.message);
}
