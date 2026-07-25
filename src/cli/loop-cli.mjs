#!/usr/bin/env node
import { resolve } from "node:path";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { assignLoopItem, prepareItemMutation, unassignLoopItem } from "../loops/assignment/assignment.mjs";
import { resolveLoopAuthority } from "../loops/assignment/resolver.mjs";
import { loopConfigUsage, runLoopConfigCli } from "./loop-config-cli.mjs";
import { resolveUmbrella } from "./umbrella.mjs";
import { runStore } from "../loops/run/run-store.mjs";
import { createLoopController } from "../loops/run/controller.mjs";
import { createProductionRun, createStoredSystemRunRunner } from "../loops/run/binder.mjs";
import { completeLoopRun } from "../loops/completion/completion.mjs";
import { validateHostExecutionEnvelope } from "../loops/contracts/host-execution.mjs";

function usageText() { return loopConfigUsage(); }
function usageError(message = usageText()) { return Object.assign(new Error(message), { exitCode: 2 }); }
function options(tokens) {
  const positionals = []; let repo = null, recoveryProof = null, resultFile = null, reason = null, outcome = null;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "--repo") {
      if (repo !== null) throw usageError("--repo must be specified at most once.");
      repo = tokens[++index];
      if (!repo || repo.startsWith("--")) throw usageError("--repo requires a path.");
    }
    else if (tokens[index] === "--recovery-proof") {
      if (recoveryProof !== null) throw usageError("--recovery-proof must be specified at most once.");
      recoveryProof = tokens[++index]; if (!/^[a-f0-9]{64}$/u.test(recoveryProof ?? "")) throw usageError("--recovery-proof requires a 64-character lowercase hex value.");
    }
    else if (tokens[index] === "--result") {
      if (resultFile !== null) throw usageError("--result must be specified at most once.");
      resultFile = tokens[++index]; if (!resultFile || resultFile.startsWith("--")) throw usageError("--result requires a file.");
    }
    else if (tokens[index] === "--reason") {
      if (reason !== null) throw usageError("--reason must be specified at most once.");
      reason = tokens[++index]; if (!reason || reason.startsWith("--")) throw usageError("--reason requires host-cancelled, host-lost, or expired.");
    }
    else if (tokens[index] === "--outcome") {
      if (outcome !== null) throw usageError("--outcome must be specified at most once.");
      outcome = tokens[++index];
      if (!["complete", "approve"].includes(outcome ?? "")) throw usageError("--outcome requires complete or approve.");
    }
    else if (tokens[index].startsWith("--")) throw usageError(`Unknown option: ${tokens[index]}`);
    else positionals.push(tokens[index]);
  }
  return { positionals, recoveryProof, resultFile, reason, outcome, repo: repo ? resolve(process.cwd(), repo) : resolveUmbrella(process.cwd()) };
}
function validateVerbOptions(verb, opts) {
  if (opts.recoveryProof && verb !== "reconcile") throw usageError();
  if ((opts.resultFile || opts.outcome) && verb !== "report"
    || verb === "report" && Boolean(opts.resultFile) === Boolean(opts.outcome)) throw usageError();
  if (opts.reason && verb !== "abandon" || verb === "abandon" && !opts.reason) throw usageError();
}
function simpleReport(envelopeBytes, outcome) {
  const execution = validateHostExecutionEnvelope(envelopeBytes).value;
  const result = Object.fromEntries(["runId", "nodeId", "attempt", "claimId", "assignmentId",
    "invocationId", "recipeRevision", "policyRevision", "inputCandidate"].map((key) => [key, execution[key]]));
  return Buffer.from(`${JSON.stringify({ schema: "burnlist-loop-host-report@1", result: {
    schema: "agent-result@1", ...result, outcome, findings: [], resolvedFindingIds: [],
  }, telemetry: null })}\n`);
}
function resultBytes(path) {
  let fd;
  try {
    const target = resolve(process.cwd(), path), entry = lstatSync(target);
    if (!entry.isFile() || entry.isSymbolicLink() || entry.size < 2 || entry.size > 262_144) throw new Error("--result file is unsafe or exceeds bounds.");
    fd = openSync(target, constants.O_RDONLY | constants.O_NONBLOCK | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(fd); if (opened.dev !== entry.dev || opened.ino !== entry.ino || opened.size !== entry.size) throw new Error("--result file changed while opening.");
    const bytes = Buffer.allocUnsafe(opened.size); let offset = 0;
    while (offset < bytes.length) { const count = readSync(fd, bytes, offset, bytes.length - offset); if (count <= 0) throw new Error("--result file changed while opening."); offset += count; }
    const after = fstatSync(fd), leaf = lstatSync(target);
    if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size || leaf.dev !== entry.dev || leaf.ino !== entry.ino || leaf.size !== entry.size) throw new Error("--result file changed while opening.");
    return bytes;
  } finally { if (fd !== undefined) closeSync(fd); }
}
function publicClaim(value) {
  return { schema: "burnlist-loop-host-claim-response@1", claim: value.claim, execution: JSON.parse(value.envelope.toString("utf8")) };
}

export async function renderLoopView({ selector, repoRoot, runReader }) {
  const authority = await resolveLoopAuthority({ repoRoot, selector, runReader });
  const { renderResolvedLoopView } = await import("../loops/view/render.mjs");
  return { authority, output: renderResolvedLoopView(authority) };
}

export async function runLoopCli(tokens, { runReader, runnerFor, stdout = process.stdout } = {}) {
  if (tokens[0] === "--help" || tokens[0] === "-h") { stdout.write(`${usageText()}\n`); return null; }
  if (["capability", "setup"].includes(tokens[0])) {
    const value = await runLoopConfigCli(tokens); stdout.write(value.output); return value;
  }
  const [verb, ...rest] = tokens; const opts = options(rest);
  validateVerbOptions(verb, opts);
  if (verb === "create") {
    if (opts.positionals.length !== 1) throw usageError();
    const store = runStore(opts.repo), result = await createProductionRun({ repoRoot: opts.repo, store, itemRef: opts.positionals[0] });
    stdout.write(`${JSON.stringify({ schema: "burnlist-loop-status@1", ...result.projection })}\n`); return result;
  }
  if (verb === "complete") {
    if (opts.positionals.length !== 1) throw usageError();
    const result = completeLoopRun({ repoRoot: opts.repo, runId: opts.positionals[0] });
    stdout.write(`${JSON.stringify({ schema: "burnlist-loop-completion@1", ...result })}\n`); return result;
  }
  if (["list", "status", "inspect", "next", "claim", "report", "abandon", "pause", "stop", "reconcile"].includes(verb)) {
    const allowed = verb === "list" ? 0 : 1;
    if (opts.positionals.length !== allowed) throw usageError();
    const store = runStore(opts.repo);
    const suppliedRunnerFor = runnerFor ?? ((runId) => createStoredSystemRunRunner({ repoRoot: opts.repo, store, runId }));
    const runners = new Map(), runtimeRunnerFor = (runId) => {
      if (!runners.has(runId)) runners.set(runId, suppliedRunnerFor(runId));
      return runners.get(runId);
    };
    const controller = createLoopController({ store, runnerFor: runtimeRunnerFor, repoRoot: opts.repo });
    const result = verb === "list" ? controller.list()
      : verb === "status" ? controller.status(opts.positionals[0])
      : verb === "inspect" ? controller.inspect(opts.positionals[0])
      : verb === "next" ? controller.inspect(opts.positionals[0])
      : verb === "claim" ? publicClaim(controller.claim(opts.positionals[0]))
      : verb === "report" ? await controller.report(opts.positionals[0],
        opts.resultFile ? resultBytes(opts.resultFile) : simpleReport(
          controller.readClaim(store.resolveClaimRef(opts.positionals[0]))?.envelope, opts.outcome))
      : verb === "abandon" ? (() => {
        const runId = store.resolveClaimRef(opts.positionals[0]);
        if (store.read(runId).execution.terminal) { const error = new Error("ClaimRef is stale"); error.exitCode = 1; throw error; }
        const active = controller.readClaim(runId);
        if (!active || active.claim.claimId !== opts.positionals[0]) { const error = new Error("ClaimRef is stale"); error.exitCode = 1; throw error; }
        return controller.abandonClaim(runId, { ...active.claim, reason: opts.reason });
      })()
      : verb === "pause" ? controller.pause(opts.positionals[0])
      : verb === "stop" ? controller.stop(opts.positionals[0])
      : verb === "reconcile" ? controller.reconcile(opts.positionals[0], opts.recoveryProof ? { generation: store.read(opts.positionals[0]).execution.generation, recoveryProof: opts.recoveryProof } : null)
      : null;
    stdout.write(controller.render(result)); return result;
  }
  if (verb === "assign" && opts.positionals.length === 2) {
    const prepared = prepareItemMutation({ repoRoot: opts.repo, itemRef: opts.positionals[0] });
    const result = await assignLoopItem({ repoRoot: opts.repo, itemRef: opts.positionals[0], loopRef: opts.positionals[1], prepared });
    stdout.write(`${result.assignmentId}\n${result.selector}\n${result.executionRevision}\n`); return result;
  }
  if (verb === "unassign" && opts.positionals.length === 1) {
    const prepared = prepareItemMutation({ repoRoot: opts.repo, itemRef: opts.positionals[0] });
    const result = unassignLoopItem({ repoRoot: opts.repo, itemRef: opts.positionals[0], prepared });
    stdout.write(`${result.assignmentId}\n`); return result;
  }
  if (verb === "view" && opts.positionals.length === 1) {
    const result = await renderLoopView({ selector: opts.positionals[0], repoRoot: opts.repo, runReader });
    stdout.write(result.output); return result.authority;
  }
  const error = new Error(usageText()); error.exitCode = 2; throw error;
}

export async function runLoopCliEntry(tokens = process.argv.slice(3)) {
  try { const result = await runLoopCli(tokens); process.exitCode = result?.exitCode ?? 0; return result?.result ?? result; }
  catch (error) {
    process.stderr.write(`burnlist: ${error?.message ?? String(error)}\n`);
    process.exitCode = error?.exitCode ?? 1; return null;
  }
}
