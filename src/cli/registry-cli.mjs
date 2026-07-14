#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  classifyRoots,
  pruneMissing,
  registerRoot,
  unregisterRoot,
} from "../server/registry.mjs";
import { gitProbe } from "./git-ignore.mjs";

const LIFECYCLE_FOLDERS = ["draft", "ready", "inprogress", "completed"];
const IGNORE_LINES = ["/notes/burnlists/", "/.local/"];

function parseArgs(tokens) {
  const flags = new Set();
  const positionals = [];
  for (const token of tokens) {
    if (token.startsWith("--")) flags.add(token.slice(2));
    else positionals.push(token);
  }
  return { flags, positionals };
}

function targetPath(value) {
  return resolve(process.cwd(), value ?? ".");
}

function atomicWrite(path, text) {
  const temp = join(dirname(path), `.${basename(path)}.${randomBytes(8).toString("hex")}.tmp`);
  try {
    writeFileSync(temp, text);
    renameSync(temp, path);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

function excludePath(dir) {
  const result = gitProbe(dir, ["rev-parse", "--git-path", "info/exclude"]);
  if (result.status !== 0 || !result.stdout.trim()) return null;
  return resolve(dir, result.stdout.trim());
}

function isIgnoreLine(line, ignoredLines = IGNORE_LINES) {
  const trimmed = line.trim();
  return ignoredLines.some((ignore) => trimmed === ignore || trimmed === ignore.slice(1));
}

function readExclude(path) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function appendIgnoreLines(path, lines) {
  const content = readExclude(path);
  const existing = content.split(/\r?\n/u).map((line) => line.trim());
  const missing = lines.filter((line) => !existing.includes(line) && !existing.includes(line.slice(1)));
  if (missing.length === 0) return false;
  const prefix = content.length === 0 || content.endsWith("\n") ? content : `${content}\n`;
  atomicWrite(path, `${prefix}${missing.join("\n")}\n`);
  return true;
}

function removeIgnoreLines(path, ignoredLines) {
  const content = readExclude(path);
  const lines = content.split(/\r?\n/u);
  const kept = lines.filter((line) => !isIgnoreLine(line, ignoredLines));
  if (kept.length === lines.length) return false;
  atomicWrite(path, kept.join("\n"));
  return true;
}

function initializeFolders(dir, track) {
  const root = join(dir, "notes", "burnlists");
  let created = 0;
  for (const folder of LIFECYCLE_FOLDERS) {
    const path = join(root, folder);
    if (!existsSync(path)) created += 1;
    mkdirSync(path, { recursive: true });
    if (track) atomicWrite(join(path, ".gitkeep"), "");
  }
  return { created };
}

function configureIgnore(dir, track) {
  const path = excludePath(dir);
  if (!path) return "not a git repository";
  if (track) {
    removeIgnoreLines(path, ["/notes/burnlists/"]);
    appendIgnoreLines(path, ["/.local/"]);
    return "tracked";
  }
  const missing = IGNORE_LINES.filter((line) => gitProbe(dir, ["check-ignore", "-q", "--", line.slice(1)]).status !== 0);
  return appendIgnoreLines(path, missing) ? "ignored" : "already ignored";
}

function printUsage() {
  console.error("Usage: burnlist register|unregister|roots|init [path] [--prune|--track]");
  process.exitCode = 2;
}

function runRegister(path) {
  const result = registerRoot(path);
  console.log(`${result.added ? "Registered" : "Already registered"} ${result.root}`);
}

function runUnregister(path) {
  const result = unregisterRoot(path);
  console.log(`${result.removed ? "Unregistered" : "Not registered:"} ${result.root}`);
}

function runRoots(flags) {
  if (flags.has("prune")) {
    const pruned = pruneMissing();
    console.log(`Pruned ${pruned.length} missing ${pruned.length === 1 ? "repository" : "repositories"}.`);
  }
  const roots = classifyRoots();
  if (roots.length === 0) {
    console.log("No repositories registered.");
    return;
  }
  for (const entry of roots) console.log(`${entry.status.padEnd(10)}${entry.root}`);
  console.log(`${roots.length} ${roots.length === 1 ? "repository" : "repositories"} registered.`);
}

function runInit(path, track) {
  const dir = targetPath(path);
  const folders = initializeFolders(dir, track);
  const ignoreState = configureIgnore(dir, track);
  const registration = registerRoot(dir);
  console.log(`Initialized ${folders.created} lifecycle ${folders.created === 1 ? "folder" : "folders"} in ${dir}.`);
  if (track) console.log("Tracking notes/burnlists/ with .gitkeep files.");
  else if (ignoreState === "not a git repository") console.log("No Git repository; local ignore skipped.");
  else if (ignoreState === "already ignored") console.log("notes/burnlists/ and .local/ are already ignored locally.");
  else console.log("Ignored /notes/burnlists/ and /.local/ locally.");
  console.log(`${registration.added ? "Registered" : "Already registered"} ${registration.root}.`);
}

async function main() {
  const tokens = process.argv.slice(2);
  const verb = tokens.shift();
  const { flags, positionals } = parseArgs(tokens);
  if (!verb) return printUsage();
  if (verb === "register") return runRegister(targetPath(positionals[0]));
  if (verb === "unregister") return runUnregister(targetPath(positionals[0]));
  if (verb === "roots") return runRoots(flags);
  if (verb === "init") return runInit(positionals[0], flags.has("track"));
  printUsage();
}

try {
  await main();
} catch (error) {
  console.error(error?.message ?? String(error));
  process.exitCode = 1;
}
