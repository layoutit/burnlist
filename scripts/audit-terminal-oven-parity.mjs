#!/usr/bin/env node
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { auditTerminalOvenParity, validateTerminalParity } from "./terminal-oven-parity-lib.mjs";
import { buildTerminalOvenCorpus } from "./terminal-oven-parity-corpus.mjs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), output = resolve(root, "terminal-oven-parity.json");
const contractsPath = resolve(root, "dashboard/src/terminal-parity/story-contracts.json");
const corpusPath = resolve(root, "terminal-oven-parity-corpus.json");
const fail = (message) => { throw new Error(`terminal inventory audit: ${message}`); };
const encode = (value) => `${JSON.stringify(value, null, 2)}\n`;
async function atomic(path, text) { await mkdir(dirname(path), { recursive: true }); const temp = `${path}.${process.pid}.tmp`; try { await writeFile(temp, text); if (process.env.BURNLIST_TERMINAL_INVENTORY_FAIL_AFTER_TEMP === "1") throw new Error("injected atomic write failure"); await rename(temp, path); } finally { await unlink(temp).catch(() => {}); } }
async function main(args) { if (args.length !== 1 || !["--write", "--check", "--official-ovens"].includes(args[0])) fail("usage: --write, --check, or --official-ovens"); const corpus = encode(buildTerminalOvenCorpus()); if (args[0] === "--write") { let before; try { before = await readFile(corpusPath, "utf8"); } catch { before = null; } if (before !== corpus) await atomic(corpusPath, corpus); } else { let actualCorpus; try { actualCorpus = await readFile(corpusPath, "utf8"); } catch { fail("missing terminal-oven-parity-corpus.json; run --write"); } if (actualCorpus !== corpus) fail("terminal-oven-parity-corpus.json is stale; run --write"); } const next = encode(validateTerminalParity(await auditTerminalOvenParity(root))); if (args[0] === "--write") return atomic(output, next); if (args[0] === "--official-ovens") return; let actual; try { actual = await readFile(output, "utf8"); } catch { fail("missing terminal-oven-parity.json; run --write"); } if (actual !== next) fail("terminal-oven-parity.json is stale; run --write"); }
if (process.argv[1] === fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch((error) => { console.error(error.message); process.exitCode = 1; });
