#!/usr/bin/env node
import { resolve } from "node:path";
import { assignLoopItem, prepareItemMutation, unassignLoopItem } from "../loops/assignment/assignment.mjs";
import { resolveLoopAuthority } from "../loops/assignment/resolver.mjs";
import { loopConfigUsage, runLoopConfigCli } from "./loop-config-cli.mjs";
import { resolveUmbrella } from "./umbrella.mjs";
import { runStore } from "../loops/run/run-store.mjs";
import { createLoopController } from "../loops/run/controller.mjs";
import { createProductionRun, createStoredProductionRunRunner } from "../loops/run/binder.mjs";
import { completeLoopRun } from "../loops/completion/completion.mjs";

function usageText() { return loopConfigUsage(); }
function options(tokens) {
  const positionals = []; let repo = null, recoveryProof = null;
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index] === "--repo") {
      if (repo !== null) throw new Error("--repo must be specified at most once.");
      repo = tokens[++index];
      if (!repo || repo.startsWith("--")) throw new Error("--repo requires a path.");
    }
    else if (tokens[index] === "--recovery-proof") {
      if (recoveryProof !== null) throw new Error("--recovery-proof must be specified at most once.");
      recoveryProof = tokens[++index]; if (!/^[a-f0-9]{64}$/u.test(recoveryProof ?? "")) throw new Error("--recovery-proof requires a 64-character lowercase hex value.");
    }
    else if (tokens[index].startsWith("--")) throw new Error(`Unknown option: ${tokens[index]}`);
    else positionals.push(tokens[index]);
  }
  return { positionals, recoveryProof, repo: repo ? resolve(process.cwd(), repo) : resolveUmbrella(process.cwd()) };
}

export async function renderLoopView({ selector, repoRoot, runReader }) {
  const authority = await resolveLoopAuthority({ repoRoot, selector, runReader });
  const { renderResolvedLoopView } = await import("../loops/view/render.mjs");
  return { authority, output: renderResolvedLoopView(authority) };
}

export async function runLoopCli(tokens, { runReader, runnerFor, stdout = process.stdout, processObject = process } = {}) {
  if (tokens[0] === "--help" || tokens[0] === "-h") { stdout.write(`${usageText()}\n`); return null; }
  if (["capability", "setup"].includes(tokens[0])) {
    const value = await runLoopConfigCli(tokens); stdout.write(value.output); return value;
  }
  const [verb, ...rest] = tokens; const opts = options(rest);
  if (verb === "create") {
    if (opts.positionals.length !== 1 || opts.recoveryProof) { const error = new Error(usageText()); error.exitCode = 2; throw error; }
    const store = runStore(opts.repo), result = await createProductionRun({ repoRoot: opts.repo, store, itemRef: opts.positionals[0] });
    stdout.write(`${JSON.stringify({ schema: "burnlist-loop-status@1", ...result.projection })}\n`); return result;
  }
  if (verb === "complete") {
    if (opts.positionals.length !== 1 || opts.recoveryProof) { const error = new Error(usageText()); error.exitCode = 2; throw error; }
    const result = completeLoopRun({ repoRoot: opts.repo, runId: opts.positionals[0] });
    stdout.write(`${JSON.stringify({ schema: "burnlist-loop-completion@1", ...result })}\n`); return result;
  }
  if (["list", "status", "inspect", "run", "pause", "resume", "stop", "reconcile"].includes(verb)) {
    const allowed = verb === "list" ? 0 : 1;
    if (opts.positionals.length !== allowed) { const error = new Error(usageText()); error.exitCode = 2; throw error; }
    const store = runStore(opts.repo);
    if (opts.recoveryProof && verb !== "reconcile") { const error = new Error(usageText()); error.exitCode = 2; throw error; }
    const suppliedRunnerFor = runnerFor ?? ((runId) => createStoredProductionRunRunner({ repoRoot: opts.repo, store, runId }));
    const runners = new Map(), runtimeRunnerFor = (runId) => {
      if (!runners.has(runId)) runners.set(runId, suppliedRunnerFor(runId));
      return runners.get(runId);
    };
    const controller = createLoopController({ store, runnerFor: runtimeRunnerFor });
    const result = verb === "list" ? controller.list()
      : verb === "status" ? controller.status(opts.positionals[0])
      : verb === "inspect" ? controller.inspect(opts.positionals[0])
      : verb === "pause" ? controller.pause(opts.positionals[0])
      : verb === "stop" ? controller.stop(opts.positionals[0])
      : verb === "reconcile" ? controller.reconcile(opts.positionals[0], opts.recoveryProof ? { generation: store.read(opts.positionals[0]).execution.generation, recoveryProof: opts.recoveryProof } : null)
      : verb === "resume" || verb === "run" ? await (() => {
        const runner = runtimeRunnerFor(opts.positionals[0]); let signalled = false;
        const onInterrupt = () => { if (!signalled) { signalled = true; runner.requestPause?.(); } else runner.requestStop?.(); };
        processObject.on?.("SIGINT", onInterrupt);
        return controller.run(opts.positionals[0]).finally(() => processObject.removeListener?.("SIGINT", onInterrupt));
      })() : null;
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
