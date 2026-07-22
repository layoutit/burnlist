#!/usr/bin/env node
// Oven CLI: create, update, view, and list Ovens from the terminal.
//
// The dashboard's New Oven form is the interactive surface; this is the
// scriptable one, meant for an agent to author Ovens without hand-writing
// JSON. It reuses the normative validators in oven-contract.mjs and does its
// own file plumbing so it never has to import the dashboard server (which
// boots an HTTP listener on import). Like the dashboard, it can only create or
// replace custom Ovens under ignored local state; it never executes anything.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeOvenPackage, ovenId, ovenRevision } from "../ovens/oven-contract.mjs";
import "../ovens/built-in-handlers.mjs";
import { listOvenHandlers } from "../ovens/oven-registry.mjs";
import { publishOvenEvent } from "../events/oven-event-store.mjs";
import {
  ovenDefinitionChangedInput,
  publishCanonicalMutation,
} from "../events/oven-canonical-mutations.mjs";
import { scanXml } from "../ovens/dsl/xml-scan.mjs";
import { bindingStorePath, readBindingStore, removeBinding, writeBinding } from "../server/oven-bindings.mjs";
import { resolveCustomOvensDir } from "../server/oven-storage.mjs";
import { readVendoredOven, vendoredOvenPath, writeVendoredOven } from "../server/oven-vendor.mjs";
import { renderOvenTree, sourceTable } from "./oven-cli-render.mjs";
import { setOvenDataFromCli } from "./oven-set.mjs";
import { createOvenCatalog, persistOven, resolvePackageInput } from "./oven-storage.mjs";
import { useShippedOven } from "./oven-use.mjs";
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

function mutationError(label) {
  return (error) => console.warn(`${label}, but could not publish its observational Oven event: ${error.message}`);
}

function publishDefinitionChange(root, saved, action) {
  const occurredAt = new Date().toISOString();
  publishCanonicalMutation(root, ovenDefinitionChangedInput({
    ovenId: saved.id,
    action,
    revision: saved.ovenRevision ?? saved.revision,
    generation: saved.pin?.pinnedAt ?? basename(saved.path),
    occurredAt,
  }), { onError: mutationError(`${action} Oven ${saved.id}`) });
}

// ── storage locations (mirror the dashboard server) ──────────────────────────
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const builtInOvensDir = resolve(packageRoot, "ovens");
const launchCwd = process.cwd();
let cachedOvenContext;

function ovenContext() {
  if (cachedOvenContext) return cachedOvenContext;
  const customRepoRoot = repoRoot();
  if (flags.get("ovens-dir") === "true") fail("--ovens-dir requires a path.");
  const unsafeOvensDir = flags.has("unsafe-ovens-dir");
  const customOvensDir = resolveCustomOvensDir(
    customRepoRoot,
    flags.has("ovens-dir") ? flags.get("ovens-dir") : undefined,
    { unsafe: unsafeOvensDir },
  );
  cachedOvenContext = {
    customRepoRoot,
    customOvensDir,
    unsafeOvensDir,
    ...createOvenCatalog({
      builtInOvensDir,
      customOvensDir,
      customRepoRoot,
      unsafeOvensDir,
      handlers: listOvenHandlers(),
    }),
  };
  return cachedOvenContext;
}

const readOvenDir = (...args) => ovenContext().readOvenDir(...args);
const discoverOvens = (...args) => ovenContext().discoverOvens(...args);
const findOven = (...args) => ovenContext().findOven(...args);

function printOven(oven) {
  let nodeCount = 0;
  const countNodes = (nodes) => {
    for (const node of nodes) {
      nodeCount += 1;
      countNodes(node.children);
    }
  };
  countNodes(oven.ir.root);
  const kind = oven.origin ?? (oven.builtIn ? "official" : "custom");
  console.log(`${oven.name}  (${oven.id}@${oven.ir.version} · ${kind})`);
  if (oven.description) console.log(oven.description);
  console.log(`version: ${oven.ir.version} · nodes: ${nodeCount} · contract: ${oven.ir.contract} · theme: ${oven.ir.theme}`);
  console.log(`revision: ${oven.ovenRevision}`);
  console.log(`path: ${oven.path}`);
  console.log("");
  console.log(renderOvenTree(oven.ir));
  console.log("");
  console.log(sourceTable(oven.ir));
}

function assertCustomTarget(id, verb) {
  const existing = findOven(id);
  if (existing?.builtIn) {
    throw new Error(`Oven ${id} is built-in and read-only. Fork it: \`oven fork ${id} <new-id>\`.`);
  }
  if (verb === "update" && !existing) throw new Error(`Oven ${id} does not exist. Use \`oven create\` instead.`);
}

function rewriteRootOvenId(source, id) {
  const parsed = scanXml(source);
  const byteOffset = parsed.ast?.name === "oven" ? parsed.ast.attrSpans.id?.offset : undefined;
  if (!parsed.ok || byteOffset === undefined) throw new Error("Oven source must have a valid root id to fork.");
  const attrStart = Buffer.from(source).subarray(0, byteOffset).toString("utf8").length;
  const attribute = /^id\s*=\s*(["'])/u.exec(source.slice(attrStart));
  if (!attribute) throw new Error("Oven source must have a valid root id to fork.");
  const valueStart = attrStart + attribute[0].length;
  const valueEnd = source.indexOf(attribute[1], valueStart);
  return `${source.slice(0, valueStart)}${id}${source.slice(valueEnd)}`;
}

// ── subcommands ───────────────────────────────────────────────────────────────
const HELP = `burnlist oven — author and inspect Ovens

Usage:
  burnlist oven list [--json]
  burnlist oven view <id> [--json]
  burnlist oven use <id> [--repo <path>] [--force]
  burnlist oven set <id> <path|-|json> [--repo <path>]
  burnlist oven bind <id> <path> [--repo <path>]
  burnlist oven unbind <id> [--repo <path>]
  burnlist oven bindings [--repo <path>]
  burnlist oven event <id> --subject <id> --kind <kind> --phase <phase> --cursor <cursor> [--payload <json>]
  burnlist oven create <id> --instructions <file|-> [--oven <file|->] [--name <text>]
  burnlist oven create <id> --dir <dir>            (reads instructions.md + <id>.oven)
  burnlist oven create <id> --package <file|->     (JSON: {name?, instructions, oven})
  burnlist oven update <id> [same inputs as create]
  burnlist oven fork <id> <newId>
  burnlist oven adopt <id> [--repo <path>] [--force]
  burnlist oven upgrade <id> [--repo <path>]

Options:
  --name <text>        Set the Oven name (owns the level-one heading).
  --instructions <p>   Markdown instructions file, or - for stdin.
  --oven <p>           Oven DSL source file, or - for stdin.
  --dir <p>            Directory containing instructions.md and <id>.oven.
  --package <p>        JSON package file, or - for stdin.
  --repo <p>           Repository whose local Oven bindings to use.
  --subject <id>       Event subject such as a Burnlist or scenario id.
  --kind <slug>        Generic event kind; data-published invalidates a snapshot.
  --phase <slug>       Generic event phase.
  --cursor <text>      Stable cursor for one logical event.
  --occurred-at <iso>  Optional event timestamp; defaults to now.
  --payload <json>     Optional compact JSON event payload.
  --ovens-dir <p>      Custom Oven storage (default .local/burnlist/ovens).
  --unsafe-ovens-dir   Permit --ovens-dir outside repo-local state.
  --force              On create, adopt, or use, replace an existing Oven.
  --json               Machine-readable output for list/view.

Custom Ovens live under ignored local state and only affect future Runs.
Create scaffolds a minimal .oven source when --oven, --dir, and --package omit one.
Built-in Ovens are read-only; this command never executes Oven instructions.
Use adopts a shipped Oven and binds only an existing, validated example/data.json.
Set validates first with the same runtime validator, then atomically publishes
.local/burnlist/data/<id>.json and its binding. Custom Ovens without a runtime
validator receive shape-only source-pointer validation, which does not prove truth.`;

function main() {
try {
  if (subcommand === "help" || flags.has("help")) {
    console.log(HELP);
    return;
  }

  if (subcommand === "list") {
    const ovens = discoverOvens();
    if (flags.has("json")) {
      console.log(JSON.stringify(ovens.map(({ instructions, ir, ...rest }) => ({ ...rest, version: ir.version })), null, 2));
      return;
    }
    if (ovens.length === 0) {
      console.log("No Ovens found.");
      return;
    }
    const nodeCount = (nodes) => nodes.reduce((count, node) => count + 1 + nodeCount(node.children), 0);
    const rows = ovens.map((oven) => [
      oven.id,
      oven.ir.version,
      oven.name,
      oven.origin ?? (oven.builtIn ? "official" : "custom"),
      oven.ir.contract,
      String(nodeCount(oven.ir.root)),
      oven.ovenRevision,
    ]);
    const header = ["id", "version", "name", "origin", "contract", "nodes", "revision"];
    const widths = header.map((label, index) => Math.max(label.length, ...rows.map((row) => row[index].length)));
    const line = (cols) => cols.map((value, index) => value.padEnd(widths[index])).join("  ").trimEnd();
    console.log(line(header));
    console.log(line(widths.map((width) => "─".repeat(width))));
    for (const row of rows) console.log(line(row));
    return;
  }

  if (subcommand === "view") {
    const id = positionals[0];
    if (!id) fail("Usage: burnlist oven view <id>");
    const oven = findOven(id);
    if (!oven) fail(`Unknown Oven "${id}". Run \`burnlist oven list\`.`);
    if (flags.has("json")) {
      console.log(JSON.stringify({
        id: oven.id,
        version: oven.ir.version,
        name: oven.name,
        builtIn: oven.builtIn,
        origin: oven.origin,
        catalogRevision: oven.catalogRevision,
        catalogEntry: oven.catalogEntry,
        instructions: oven.instructions,
        oven: oven.oven,
        ovenRevision: oven.ovenRevision,
        ...(oven.forkedFrom ? { forkedFrom: oven.forkedFrom } : {}),
      }, null, 2));
      return;
    }
    printOven(oven);
    return;
  }

  if (subcommand === "bind") {
    const [id, logicalPath] = positionals;
    if (!id || logicalPath === undefined) fail("Usage: burnlist oven bind <id> <path> [--repo <path>]");
    const repoRoot = bindingRepo();
    const result = writeBinding(repoRoot, id, logicalPath, new Date().toISOString(), {
      onError: mutationError(`Bound Oven ${ovenId(id)}`),
    });
    console.log(`Bound Oven ${ovenId(id)} to ${logicalPath}\nStore: ${result.path}`);
    return;
  }

  if (subcommand === "unbind") {
    const id = positionals[0];
    if (!id) fail("Usage: burnlist oven unbind <id> [--repo <path>]");
    const repoRoot = bindingRepo();
    if (removeBinding(repoRoot, id, { onError: mutationError(`Unbound Oven ${ovenId(id)}`) })) {
      console.log(`Unbound Oven ${ovenId(id)} from ${bindingStorePath(repoRoot)}`);
    }
    else console.log(`No binding exists for Oven ${ovenId(id)} in ${bindingStorePath(repoRoot)}.`);
    return;
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
    return;
  }

  if (subcommand === "set") {
    const result = setOvenDataFromCli({ positionals, repoRoot: bindingRepo(), launchCwd, findOven });
    for (const warning of result.warnings) console.warn(`burnlist oven: warning: ${warning}`);
    console.log(result.output);
    return;
  }

  if (subcommand === "use") {
    const [id, ...extra] = positionals;
    if (!id || extra.length > 0) fail("Usage: burnlist oven use <id> [--repo <path>] [--force]");
    const result = useShippedOven({
      id,
      repoRoot: repoRoot(),
      builtInOvensDir,
      readOvenDir,
      force: flags.has("force"),
    });
    for (const warning of result.warnings) console.warn(`burnlist oven: warning: ${warning}`);
    console.log(result.output);
    return;
  }

  if (subcommand === "event") {
    const id = positionals[0];
    const eventFlag = (name) => {
      const value = flags.get(name);
      return value && value !== "true" ? value : null;
    };
    const subjectId = eventFlag("subject");
    const kind = eventFlag("kind");
    const phase = eventFlag("phase");
    const cursor = eventFlag("cursor");
    if (!id || !subjectId || !kind || !phase || !cursor) {
      fail("Usage: burnlist oven event <id> --subject <id> --kind <kind> --phase <phase> --cursor <cursor> [--payload <json>]");
    }
    let payload = {};
    if (flags.has("payload")) {
      try { payload = JSON.parse(flags.get("payload")); }
      catch (error) { throw new Error(`--payload must be valid JSON: ${error.message}`); }
    }
    const result = publishOvenEvent(repoRoot(), {
      ovenId: id,
      subjectId,
      kind,
      phase,
      cursor,
      occurredAt: flags.get("occurred-at"),
      payload,
    });
    console.log(JSON.stringify({ created: result.created, event: result.event }));
    return;
  }

  if (subcommand === "create" || subcommand === "update") {
    const pkg = resolvePackageInput({ flags, positionals, scaffold: subcommand === "create" });
    assertCustomTarget(pkg.id, subcommand);
    const allowReplace = subcommand === "update" || flags.has("force");
    const { customRepoRoot, customOvensDir, unsafeOvensDir } = ovenContext();
    const path = persistOven({ customRepoRoot, customOvensDir, unsafeOvensDir }, pkg, { allowReplace });
    const saved = readOvenDir(customOvensDir, pkg.id, false);
    publishDefinitionChange(customRepoRoot, saved, subcommand === "update" ? "updated" : "created");
    console.log(`${subcommand === "update" ? "Updated" : "Created"} Oven ${pkg.id} at ${path}\n`);
    printOven(saved);
    return;
  }

  if (subcommand === "fork") {
    const [sourceId, newId] = positionals;
    if (!sourceId || !newId) fail("Usage: burnlist oven fork <id> <newId>");
    const source = findOven(sourceId);
    if (!source) fail(`Unknown Oven "${sourceId}". Run \`burnlist oven list\`.`);
    const id = ovenId(newId);
    const pkg = normalizeOvenPackage({ id, instructions: source.instructions, oven: rewriteRootOvenId(source.oven, id) });
    const sourceRevision = ovenRevision(source);
    if (findOven(pkg.id)) throw new Error(`Oven ${pkg.id} already exists.`);
    const { customRepoRoot, customOvensDir, unsafeOvensDir } = ovenContext();
    const path = persistOven({ customRepoRoot, customOvensDir, unsafeOvensDir }, pkg, {
      allowReplace: false,
      sidecar: { forkedFrom: { ovenId: source.id, revision: sourceRevision } },
    });
    publishDefinitionChange(customRepoRoot, readOvenDir(customOvensDir, pkg.id, false), "forked");
    console.log(`Forked Oven ${pkg.id} at ${path}\nForked from ${source.id}@${sourceRevision}`);
    return;
  }

  if (subcommand === "adopt" || subcommand === "upgrade") {
    const id = positionals[0];
    if (!id) fail(`Usage: burnlist oven ${subcommand} <id> [--repo <path>]${subcommand === "adopt" ? " [--force]" : ""}`);
    const shipped = readOvenDir(builtInOvensDir, id, true);
    if (!shipped) fail(`Oven ${id} is not a shipped built-in.`);
    const shippedInstructions = readFileSync(join(builtInOvensDir, shipped.id, "instructions.md"), "utf8");
    const shippedOven = readFileSync(join(builtInOvensDir, shipped.id, `${shipped.id}.oven`), "utf8");
    const targetRoot = repoRoot();
    const targetPath = vendoredOvenPath(targetRoot, id);
    if (subcommand === "adopt") {
      if (existsSync(targetPath) && !flags.has("force")) fail(`Oven ${id} is already vendored at ${targetPath}.`);
    } else if (!existsSync(targetPath)) {
      fail(`Oven ${id} is not adopted; run \`oven adopt ${id}\` first.`);
    }
    const saved = writeVendoredOven(targetRoot, {
      id,
      instructions: shippedInstructions,
      oven: shippedOven,
      runtimeCompatibility: shipped.catalogEntry?.runtimeCompatibility,
    });
    publishDefinitionChange(targetRoot, saved, subcommand === "adopt" ? "adopted" : "upgraded");
    if (subcommand === "adopt") console.log(`Adopted Oven ${saved.id}@${saved.version} at ${targetPath}`);
    else console.log(`Upgraded Oven ${saved.id}@${saved.version} at ${targetPath}\nrevision: ${saved.revision}`);
    return;
  }

  fail(`Unknown subcommand "${subcommand}". Run \`burnlist oven help\`.`);
} catch (error) {
  fail(error.message);
}
}

main();
