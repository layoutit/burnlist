import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileLoopPackage } from "../dsl/compile.mjs";
import { freezeRecipe, loadFrozenRecipe } from "../dsl/frozen.mjs";
import { canonicalBoundPolicyBytes } from "./run-artifacts.mjs";
import { prefixed, rawSha256 } from "../dsl/hash.mjs";
import { canonicalCapabilityBytes, canonicalGrantBytes, capabilityRevision, GUARANTEE_LABELS } from "../capabilities/contract.mjs";
import { snapshotTarget } from "../capabilities/snapshot.mjs";
import { runStore } from "./run-store.mjs";
import { createRunRunner } from "./runner.mjs";
import { presentRun } from "./read-projection.mjs";

export const d = (prefix, char) => `${prefix}:${char.repeat(64)}`;
export const fixtureRunId = "run:01arz3ndektsv4rrffq69g5fav";
export const fixtureItemRef = "item:260722-001#L29";
export const m4ProgressOutcomes = ["complete", "pass", "reject", "complete", "pass", "approve"];
let frozenPromise;
const fixtureBinary = "/bin/sh";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
export function frozenRecipeBytes() {
  frozenPromise ??= compileLoopPackage(resolve(dirname(fileURLToPath(import.meta.url)), "../../../loops/review")).then((compiled) => {
    if (!compiled.ok) throw new Error("fixture Loop did not compile"); return freezeRecipe(compiled);
  });
  return frozenPromise;
}
export function boundPolicyBytes(recipeBytes) {
  const recipe = loadFrozenRecipe(recipeBytes), canonical = (value) => Buffer.from(`${JSON.stringify(value)}\n`);
  const route = (id, routeName, authority, session, char) => {
    const binary = fixtureBinary, model = "gpt-5.6-terra", effort = "medium", sandbox = authority === "write" ? "workspace-write" : "read-only";
    const profile = { schema: "burnlist-loop-agent-profile@1", id, adapter: "builtin:codex-cli", binary, model, effort, authority };
    const executableDigest = snapshotTarget({ root: "/", path: binary, maximum: 64 * 1024 * 1024 }).digest;
    const profileRevision = prefixed("ap1-sha256:", "agent-profile-v1", [canonical(profile)]);
    return { route: routeName, profile, profileRevision, executableDigest,
      guarantees: routeName === "review.strong"
        ? { freshSession: "enforced", filesystemWriteDeny: "supervised" }
        : { freshSession: "enforced" } };
  };
  const policy = { id: "repo-verify", argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".", environment: { inherit: ["PATH"], set: {} },
    network: "deny", filesystem: { read: ["src"], write: [] }, output: { maxBytes: 1024 }, maxMilliseconds: 1000 };
  const grants = { argv: policy.argv, cwd: policy.cwd, environment: policy.environment, network: policy.network,
    filesystem: policy.filesystem, output: policy.output, maxMilliseconds: policy.maxMilliseconds };
  const revision = capabilityRevision(policy), policyDigest = rawSha256(canonicalCapabilityBytes(policy)), grantsDigest = rawSha256(canonicalGrantBytes(grants, policy));
  return canonicalBoundPolicyBytes({ schema: "burnlist-loop-bound-policy@1", recipeRevision: recipe.revisions.executable,
    routes: [route("maker", "implementation.standard", "write", "maker-session", "1"), route("reviewer", "review.strong", "read", "review-session", "2")],
    capabilities: [{ id: "repo-verify", policy, revision, policyDigest, grants, grantsDigest,
      trust: { schema: "burnlist-loop-capability-trust@1", capability: "repo-verify", revision, policyDigest, grants, grantsDigest }, guarantees: GUARANTEE_LABELS }] });
}
export async function runInput(id = fixtureRunId) {
  const recipe = await frozenRecipeBytes(); return { runId: id, assignmentId: d("as1-sha256", "a"), itemRef: "item:260722-001#L7",
    itemRevision: d("id1-sha256", "b"), frozenRecipeBytes: recipe, policyBytes: boundPolicyBytes(recipe) };
}

export async function runM4ProgressFixture({
  repoRoot,
  runId = fixtureRunId,
  itemRef = fixtureItemRef,
  outcomes = m4ProgressOutcomes,
  graph,
  clock,
}) {
  if (!repoRoot) throw new Error("run fixture: repo root is required");
  const source = Array.isArray(outcomes) ? [...outcomes] : [];
  const frozenGraph = graph ?? loadFrozenRecipe(await frozenRecipeBytes()).ir;
  let at = 0;
  const baseClock = clock ?? (() => at++);
  const store = runStore(repoRoot, { clock: baseClock });
  store.createRun({ runId, itemRef, graph: frozenGraph });
  const runner = createRunRunner({ store, runId, invoke: async () => {
    const outcome = source.shift();
    if (!outcome) throw new Error(`run fixture: missing outcome for ${runId}`);
    return { kind: outcome, summary: outcome, outputBytes: 1 };
  }});
  const snapshots = [];
  let previous = null;
  const capture = () => {
    const snapshot = presentRun(runner.replay());
    if (
      !previous
      || snapshot.currentNode !== previous.currentNode
      || snapshot.attempt !== previous.attempt
      || snapshot.latestResult?.kind !== previous.latestResult?.kind
      || snapshot.state !== previous.state
    ) {
      snapshots.push(snapshot);
      previous = snapshot;
    }
  };
  for (let steps = 0; steps < 256; steps += 1) {
    if (runner.replay().execution.terminal) break;
    await runner.step();
    capture();
  }
  const final = presentRun(runner.replay());
  if (!runner.replay().execution.terminal) throw new Error("run fixture: progress did not converge");
  if (!snapshots.length || snapshots.at(-1) !== final) snapshots.push(final);
  return { store, runId, itemRef, graph: frozenGraph, transitions: final.transitions, final, snapshots };
}

function fixtureCapability() {
  return { id: "repo-verify", argv: [process.execPath, "-e", "process.exit(0)"], cwd: ".",
    environment: { inherit: ["PATH"], set: {} }, network: "deny",
    filesystem: { read: ["src"], write: [] }, output: { maxBytes: 1024 }, maxMilliseconds: 1000 };
}
function fixtureGrants(value) {
  return { argv: value.argv, cwd: value.cwd, environment: value.environment, network: value.network,
    filesystem: value.filesystem, output: value.output, maxMilliseconds: value.maxMilliseconds };
}
function fixtureCommand(repo, ...args) {
  const result = spawnSync(process.execPath, [resolve(projectRoot, "bin", "burnlist.mjs"), ...args, "--repo", repo], { cwd: repo, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`fixture command ${args.join(" ")} failed: ${result.stderr}`);
}

/** Build the same source/config/trust authority consumed by production createRun. */
export function createProductionRunAuthority(repo) {
  mkdirSync(repo, { recursive: true });
  const root = realpathSync(repo);
  execFileSync("git", ["init", "--quiet", root]); mkdirSync(resolve(root, ".burnlist"), { recursive: true }); mkdirSync(resolve(root, "src"));
  const plan = resolve(root, "notes", "burnlists", "inprogress", "260722-001"); mkdirSync(plan, { recursive: true });
  writeFileSync(resolve(plan, "burnlist.md"), "# Runner\n\n## Active Checklist\n- [ ] L29 | Exercise production authority\n\n## Completed\n");
  const binary = resolve(root, "fixtures", "codex"); mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, `#!/usr/bin/env node
const fs=require("node:fs"),a=process.argv.slice(2),prompt=a.at(-1),lines=Object.fromEntries(prompt.split("\\n").filter(x=>x.includes("=")).map(x=>x.split(/=(.*)/s).slice(0,2)));
let outcome="complete";const counter=process.env.BURNLIST_FAKE_COUNTER;
if(process.env.BURNLIST_FAKE_STARTED){const marker=process.env.BURNLIST_FAKE_STARTED,tmp=marker+"."+process.pid+".tmp";fs.writeFileSync(tmp,JSON.stringify({pid:process.pid,node:lines.node,attempt:Number(lines.attempt)}));fs.renameSync(tmp,marker);}
const wait=Number(process.env.BURNLIST_FAKE_WAIT_MS||0);if(Number.isSafeInteger(wait)&&wait>0)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,wait);
if(counter){const attempt=Number(lines.attempt),index=lines.node==="implement"?(attempt-1)*2:lines.node==="review"?(attempt-1)*2+1:Number(fs.readFileSync(counter,"utf8"));outcome=(process.env.BURNLIST_FAKE_OUTCOMES||"complete").split(",")[index]||"approve";fs.writeFileSync(counter,String(Math.max(Number(fs.readFileSync(counter,"utf8")),index+1)));}
if(lines.node==="implement"&&outcome==="complete")fs.writeFileSync(process.cwd()+"/src/fake-maker-candidate.txt","maker-attempt="+lines.attempt+"\\n");
const final={schema:"burnlist.agent-final@1",runId:lines.run,nodeId:lines.node,attempt:Number(lines.attempt),claimId:lines.claim,invocationId:lines.invocation,assignmentId:lines.assignment,recipeRevision:lines.recipe,policyRevision:lines.policy,inputCandidate:lines.candidate,outcome,summary:"fake "+outcome};
const mode=process.env.BURNLIST_FAKE_FINAL_MODE;if(mode==="stale")final.inputCandidate="cm1-sha256:"+"f".repeat(64);
process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"s-"+process.pid,model:a[a.indexOf("-m")+1]})+"\\n");
process.stdout.write(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:mode==="malformed"?"not-json":JSON.stringify(final)}})+"\\n");
process.stdout.write(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1,cached_input_tokens:0}})+"\\n");
`); chmodSync(binary, 0o700);
  const capability = fixtureCapability(), grantsPath = resolve(root, "grants.json");
  writeFileSync(resolve(root, ".burnlist", "loop-capabilities.json"), `${JSON.stringify({ schema: "burnlist-loop-capabilities@1", capabilities: [capability] })}\n`);
  writeFileSync(grantsPath, `${JSON.stringify(fixtureGrants(capability))}\n`);
  for (const [id, authority, route] of [["maker", "write", "implementation.standard"], ["reviewer", "read", "review.strong"]]) {
    fixtureCommand(root, "agent", "profile", "add", id, "--adapter", "builtin:codex-cli", "--binary", binary,
      "--model", "gpt-5.3-codex-spark", "--effort", "medium", "--authority", authority);
    fixtureCommand(root, "route", "set", route, "--profile", id);
  }
  fixtureCommand(root, "loop", "capability", "trust", "repo-verify", "--revision", capabilityRevision(capability), "--grants", grantsPath);
  fixtureCommand(root, "loop", "assign", fixtureItemRef, "loop:builtin:review");
  return { repo: root, binary };
}
