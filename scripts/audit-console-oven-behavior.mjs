#!/usr/bin/env node
import { readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditConsoleOvenBehavior, policyFor } from "./console-oven-behavior-lib.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "console-oven-behavior.json"), policy = resolve(root, "console-oven-behavior-policy.json");
const fail = (s) => { throw new Error(`console Oven behavior audit: ${s}`); };
const print = (x) => `${JSON.stringify(x, null, 2)}\n`;
async function atomic(path, value) { const temp = `${path}.${process.pid}.tmp`; await writeFile(temp, value); await rename(temp, path); }
function delta(before, after) { const rows = (value) => new Map((value?.capabilities ?? []).map((row) => [row.id, JSON.stringify(row)])); const a = rows(before), b = rows(after); return { added: [...b.keys()].filter((id) => !a.has(id)), removed: [...a.keys()].filter((id) => !b.has(id)), changed: [...b.keys()].filter((id) => a.has(id) && a.get(id) !== b.get(id)) }; }
async function main(args) { if (args.length !== 1 || !["--write", "--check", "--write-policy"].includes(args[0])) fail("usage: --write, --check, or --write-policy"); const inventory = await auditConsoleOvenBehavior(root, { compare: args[0] !== "--write-policy" }); const expected = print(inventory); if (args[0] === "--check") { let actual; try { actual = await readFile(output, "utf8"); } catch { fail("missing console-oven-behavior.json; run --write"); } if (actual !== expected) fail("console-oven-behavior.json is stale; run --write"); return; } if (args[0] === "--write") return atomic(output, expected); let before; try { before = JSON.parse(await readFile(policy, "utf8")); } catch { before = {}; } const next = policyFor(inventory), changes = delta(before, next); console.log(`semantic policy update: added=${changes.added.join(",") || "none"}; removed=${changes.removed.join(",") || "none"}; changed=${changes.changed.join(",") || "none"}`); await atomic(policy, print(next)); }
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((e) => { console.error(e.message); process.exitCode = 1; });
