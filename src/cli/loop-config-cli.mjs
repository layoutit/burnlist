import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { join, parse as parsePath, relative, resolve, sep } from "node:path";
import { readCapabilityCatalog, resolveCapability } from "../loops/capabilities/contract.mjs";
import { trustCapability } from "../loops/capabilities/trust.mjs";
import { doctorProfile, saveProfile, saveRoute } from "../loops/config/profiles.mjs";
import { renderSetupStatus, setupStatus } from "../loops/config/setup.mjs";
import { rawSha256 } from "../loops/dsl/hash.mjs";
import { resolveUmbrella } from "./umbrella.mjs";

const profileUsage = "Usage: burnlist agent profile add <slug> --adapter builtin:codex-cli --binary <absolute-path> --model <id> --effort <level> --authority read|write [--repo <path>]";
const routeUsage = "Usage: burnlist route set <implementation.standard|review.strong> --profile <slug> [--repo <path>]";
const agentUsage = `${profileUsage}\n       burnlist agent doctor <slug> [--repo <path>]`;
const loopUsage = "Usage: burnlist loop assign <ItemRef> <LoopRef> [--repo <path>] | burnlist loop unassign <ItemRef> [--repo <path>] | burnlist loop view <LoopRef|ItemRef|review> [--repo <path>]\n       burnlist loop create <ItemRef> [--repo <path>]\n       burnlist loop run|pause|resume|stop|complete <RunRef> [--repo <path>]\n       burnlist loop list [--repo <path>] | burnlist loop status|inspect <RunRef> [--repo <path>]\n       burnlist loop reconcile <RunRef> --recovery-proof <hex> [--repo <path>]\n       burnlist loop capability inspect <id> [--repo <path>]\n       burnlist loop capability trust <id> --revision cp1-sha256:<hex> --grants <json-file> [--repo <path>]\n       burnlist loop setup status [--repo <path>]";

function fail(message, exitCode = 2) { throw Object.assign(new Error(message), { exitCode }); }
function parse(tokens, allowed = []) {
  const values = {}, positionals = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) { positionals.push(token); continue; }
    if (!allowed.includes(token)) fail(`Unknown option: ${token}`);
    if (Object.hasOwn(values, token)) fail(`${token} must be specified at most once.`);
    const value = tokens[++index]; if (!value || value.startsWith("--")) fail(`${token} requires a value.`);
    values[token] = value;
  }
  const repo = values["--repo"] ? resolve(process.cwd(), values["--repo"]) : resolveUmbrella(process.cwd());
  return { positionals, values, repo };
}
function requireOnly(positionals, count, usage) { if (positionals.length !== count) fail(usage); }
function canonical(value) { return `${JSON.stringify(value)}\n`; }
function catalogOrGuidance(repo) {
  try { return readCapabilityCatalog(repo); }
  catch (error) {
    if (error?.code === "ENOENT") fail("capability catalog is missing; create .burnlist/loop-capabilities.json from the Review Loop capability example, then run inspect again", 1);
    throw error;
  }
}
function same(left, right) { return left.dev === right.dev && left.ino === right.ino && left.mode === right.mode && left.size === right.size; }
function boundedNoFollow(path, maximum) {
  const target = resolve(path), root = parsePath(target).root, parts = relative(root, target).split(sep), ancestors = []; let current = root;
  for (const part of parts.slice(0, -1)) {
    current = join(current, part); const stat = lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe path");
    ancestors.push({ path: current, stat });
  }
  const leaf = lstatSync(target);
  if (!leaf.isFile() || leaf.isSymbolicLink() || leaf.size > maximum) throw new Error("unsafe file");
  let fd; try {
    fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const opened = fstatSync(fd);
    if (!opened.isFile() || !same(leaf, opened)) throw new Error("file changed");
    const bytes = Buffer.allocUnsafe(opened.size); let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset, offset); if (count <= 0) throw new Error("short read"); offset += count; }
    if (!same(opened, fstatSync(fd)) || !same(opened, lstatSync(target))) throw new Error("file changed");
    for (const item of ancestors) { const stat = lstatSync(item.path); if (!stat.isDirectory() || stat.isSymbolicLink() || stat.dev !== item.stat.dev || stat.ino !== item.stat.ino) throw new Error("path changed"); }
    return bytes;
  } finally { if (fd !== undefined) closeSync(fd); }
}
function boundedJson(path) {
  const target = resolve(process.cwd(), path);
  let bytes; try { bytes = boundedNoFollow(target, 65536); }
  catch { fail("--grants must name a bounded regular no-follow JSON file", 1); }
  try { return JSON.parse(bytes.toString("utf8")); } catch { fail("--grants must name a readable JSON file", 1); }
}

export function loopConfigUsage() { return loopUsage; }
export function agentConfigUsage() { return agentUsage; }

export async function runAgentCli(tokens, { stdout = process.stdout } = {}) {
  if (tokens[0] === "--help" || tokens[0] === "-h") return { output: `${agentUsage}\n` };
  const [verb, ...tail] = tokens;
  if (verb === "profile" && tail[0] === "add") {
    const rest = tail.slice(1);
    const parsed = parse(rest, ["--adapter", "--binary", "--model", "--effort", "--authority", "--repo"]); requireOnly(parsed.positionals, 1, profileUsage);
    for (const key of ["--adapter", "--binary", "--model", "--effort", "--authority"]) if (!parsed.values[key]) fail(profileUsage);
    const result = saveProfile({ repoRoot: parsed.repo, slug: parsed.positionals[0], adapter: parsed.values["--adapter"], binary: parsed.values["--binary"], model: parsed.values["--model"], effort: parsed.values["--effort"], authority: parsed.values["--authority"] });
    return { output: canonical(result), result };
  }
  if (verb === "doctor") {
    const parsed = parse(tail, ["--repo"]); requireOnly(parsed.positionals, 1, agentUsage);
    const result = await doctorProfile({ repoRoot: parsed.repo, slug: parsed.positionals[0] });
    if (result.available) return { output: `Agent ${result.profile.id}: available\nConfiguration authority: profile record only; launch verification is deferred.\n`, result };
    return { output: `Agent ${result.profile.id}: unavailable, not ready\nREMEDIATION: ${profileUsage}\n`, result, exitCode: 1 };
  }
  fail(agentUsage);
}

export function runRouteCli(tokens) {
  if (tokens[0] === "--help" || tokens[0] === "-h") return { output: `${routeUsage}\n` };
  const [verb, ...rest] = tokens;
  if (verb !== "set") fail(routeUsage);
  const parsed = parse(rest, ["--profile", "--repo"]); requireOnly(parsed.positionals, 1, routeUsage);
  if (!parsed.values["--profile"]) fail(routeUsage);
  const result = saveRoute({ repoRoot: parsed.repo, route: parsed.positionals[0], profile: parsed.values["--profile"] });
  return { output: canonical(result), result };
}

export async function runLoopConfigCli(tokens) {
  const [kind, action, ...rest] = tokens;
  if (kind === "capability" && action === "inspect") {
    const parsed = parse(rest, ["--repo"]); requireOnly(parsed.positionals, 1, loopUsage);
    const resolved = resolveCapability(catalogOrGuidance(parsed.repo), parsed.positionals[0]);
    return { output: canonical({ schema: "burnlist-loop-capability-inspect@1", capability: resolved.policy.id, revision: resolved.revision, policyDigest: rawSha256(resolved.bytes) }), result: resolved };
  }
  if (kind === "capability" && action === "trust") {
    const parsed = parse(rest, ["--revision", "--grants", "--repo"]); requireOnly(parsed.positionals, 1, loopUsage);
    if (!parsed.values["--revision"] || !parsed.values["--grants"]) fail(loopUsage);
    const resolved = resolveCapability(catalogOrGuidance(parsed.repo), parsed.positionals[0]);
    if (parsed.values["--revision"] !== resolved.revision) fail(`capability revision does not match inspected ${resolved.revision}`, 1);
    const grants = boundedJson(parsed.values["--grants"]);
    const result = trustCapability({ repoRoot: parsed.repo, capability: resolved.policy, grants });
    return { output: canonical(result), result };
  }
  if (kind === "setup" && action === "status") {
    const parsed = parse(rest, ["--repo"]); requireOnly(parsed.positionals, 0, loopUsage);
    const result = await setupStatus({ repoRoot: parsed.repo }); return { output: renderSetupStatus(result), result, exitCode: result.ready ? 0 : 1 };
  }
  fail(loopUsage);
}

export function writeCliResult(value, stdout = process.stdout) { stdout.write(value.output); return value.result ?? null; }
export async function runAgentCliEntry(tokens = process.argv.slice(3)) {
  try { const value = await runAgentCli(tokens); writeCliResult(value); process.exitCode = value.exitCode ?? 0; return value.result ?? null; }
  catch (error) { process.stderr.write(`burnlist: ${error?.message ?? String(error)}\n`); process.exitCode = error?.exitCode ?? 1; return null; }
}
export async function runRouteCliEntry(tokens = process.argv.slice(3)) {
  try { const value = runRouteCli(tokens); writeCliResult(value); process.exitCode = value.exitCode ?? 0; return value.result ?? null; }
  catch (error) { process.stderr.write(`burnlist: ${error?.message ?? String(error)}\n`); process.exitCode = error?.exitCode ?? 1; return null; }
}
