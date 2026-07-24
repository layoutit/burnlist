#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  rmSync,
  chmodSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const tmpRoot = mkdtempSync(join(tmpdir(), "burnlist-global-install-"));
const home = join(tmpRoot, "home");
const prefix = join(tmpRoot, "prefix");
const packRoot = join(tmpRoot, "pack");
const npmCache = join(tmpRoot, "npm-cache");
const {
  BURNLIST_CLAUDE_SKILLS_DIR: ignoredClaudeSkillsDir,
  BURNLIST_SKILLS_DIR: ignoredCodexSkillsDir,
  ...smokeEnv
} = process.env;
const env = {
  ...smokeEnv,
  HOME: home,
  USERPROFILE: home,
  npm_config_cache: npmCache,
};
const testNode = resolve(process.env.BURNLIST_TEST_NODE || process.execPath);
const npmCli = process.env.BURNLIST_TEST_NODE
  ? resolve(dirname(dirname(testNode)), "lib", "node_modules", "npm", "bin", "npm-cli.js")
  : process.env.npm_execpath;

function assertSelectedNode() {
  const version = spawnSync(testNode, ["--version"], { encoding: "utf8", shell: false });
  if (version.status !== 0) throw new Error("BURNLIST_TEST_NODE is not executable");
  if (process.env.BURNLIST_TEST_NODE && !/^v18\./u.test(version.stdout.trim())) throw new Error("BURNLIST_TEST_NODE must select Node 18 for the compatibility smoke");
  if (!npmCli || !existsSync(npmCli)) throw new Error("selected Node runtime does not provide npm-cli.js");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    encoding: options.capture ? "utf8" : undefined,
    env: options.env ?? env,
    maxBuffer: 8 * 1024 * 1024,
    shell: false,
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr || result.stdout || "");
    throw new Error(`${command} ${args.join(" ")} failed`);
  }
  return options.capture ? result.stdout.trim() : "";
}

function invokeCli(cli, args, options = {}) {
  return run(testNode, [cli, ...args], options);
}

function runNpm(args, options = {}) { return run(testNode, [npmCli, ...args], options); }

function assertManagedLink(agentDirectory, name, packageRoot) {
  const target = join(home, agentDirectory, "skills", name);
  const stat = lstatSync(target);
  if (!stat.isSymbolicLink()) throw new Error(`${target} is not a symlink`);
  const actual = realpathSync(resolve(dirname(target), readlinkSync(target)));
  const expected = realpathSync(resolve(packageRoot, "skills", name));
  if (actual !== expected) throw new Error(`${target} points to ${actual}, expected ${expected}`);
}

function command(cli, repo, args, options = {}) {
  return invokeCli(cli, [...args, "--repo", repo], { ...options, cwd: repo });
}

function writeLoopFixture(repo) {
  mkdirSync(join(repo, ".burnlist"), { recursive: true });
  mkdirSync(join(repo, "src"), { recursive: true });
  mkdirSync(join(repo, "notes", "burnlists", "inprogress", "260722-001"), { recursive: true });
  writeFileSync(join(repo, "notes", "burnlists", "inprogress", "260722-001", "burnlist.md"), "# Smoke Loop\n\n## Active Checklist\n- [ ] L1 | Packed Loop proof\n\n## Completed\n");
  const binary = join(repo, "fixtures", "fake-codex");
  mkdirSync(dirname(binary), { recursive: true });
  writeFileSync(binary, `#!${testNode}
const fs=require("node:fs"),args=process.argv.slice(2),prompt=args.at(-1),lines=Object.fromEntries(prompt.split("\\n").filter((line)=>line.includes("=")).map((line)=>line.split(/=(.*)/s).slice(0,2)));
const counter=process.env.BURNLIST_FAKE_COUNTER,index=counter?Number(fs.readFileSync(counter,"utf8")):0,outcome=(process.env.BURNLIST_FAKE_OUTCOMES||"complete,approve").split(",")[index]||"approve";
if(counter)fs.writeFileSync(counter,String(index+1));
const final={schema:"burnlist.agent-final@1",runId:lines.run,nodeId:lines.node,attempt:Number(lines.attempt),claimId:lines.claim,invocationId:lines.invocation,assignmentId:lines.assignment,recipeRevision:lines.recipe,policyRevision:lines.policy,inputCandidate:lines.candidate,outcome,summary:"fake "+outcome};
process.stdout.write(JSON.stringify({type:"thread.started",thread_id:"smoke-"+process.pid,model:args[args.indexOf("-m")+1]})+"\\n");
process.stdout.write(JSON.stringify({type:"item.completed",item:{type:"agent_message",text:JSON.stringify(final)}})+"\\n");
process.stdout.write(JSON.stringify({type:"turn.completed",usage:{input_tokens:1,output_tokens:1,cached_input_tokens:0}})+"\\n");
`);
  chmodSync(binary, 0o700);
  const capability = { id: "repo-verify", argv: [testNode, "-e", "process.exit(0)"], cwd: ".", environment: { inherit: ["PATH"], set: {} }, network: "deny", filesystem: { read: ["src"], write: [] }, output: { maxBytes: 1024 }, maxMilliseconds: 1000 };
  writeFileSync(join(repo, ".burnlist", "loop-capabilities.json"), `${JSON.stringify({ schema: "burnlist-loop-capabilities@1", capabilities: [capability] })}\n`);
  writeFileSync(join(repo, "grants.json"), `${JSON.stringify({ argv: capability.argv, cwd: capability.cwd, environment: capability.environment, network: capability.network, filesystem: capability.filesystem, output: capability.output, maxMilliseconds: capability.maxMilliseconds })}\n`);
  return { binary, itemRef: "item:260722-001#L1" };
}

function assertLoopFlow(cli) {
  const repoPath = join(tmpRoot, "loop-repo");
  mkdirSync(repoPath, { recursive: true });
  run("git", ["init", "--quiet", repoPath]);
  const repo = realpathSync(repoPath);
  const { binary, itemRef } = writeLoopFixture(repo);
  const profile = (slug, authority) => command(cli, repo, ["agent", "profile", "add", slug, "--adapter", "builtin:codex-cli", "--binary", binary, "--model", "gpt-5.6-terra", "--effort", "medium", "--authority", authority]);
  profile("maker", "write"); profile("reviewer", "read");
  command(cli, repo, ["route", "set", "implementation.standard", "--profile", "maker"]);
  command(cli, repo, ["route", "set", "review.strong", "--profile", "reviewer"]);
  const capability = JSON.parse(command(cli, repo, ["loop", "capability", "inspect", "repo-verify"], { capture: true }));
  command(cli, repo, ["loop", "capability", "trust", "repo-verify", "--revision", capability.revision, "--grants", join(repo, "grants.json")]);
  const setup = command(cli, repo, ["loop", "setup", "status"], { capture: true });
  if (setup !== "Loop setup: ready") throw new Error(`packed Loop setup did not become ready: ${setup}`);
  command(cli, repo, ["loop", "assign", itemRef, "loop:builtin:review"]);
  const view = command(cli, repo, ["loop", "view", itemRef], { capture: true });
  if (!view.includes("LOOP: loop:builtin:review")) throw new Error("packed CLI did not render the assigned Loop");
  const runId = JSON.parse(command(cli, repo, ["loop", "create", itemRef], { capture: true })).runId;
  for (const operation of ["status", "inspect"]) JSON.parse(command(cli, repo, ["loop", operation, runId], { capture: true }));
  const counter = join(repo, "counter"); writeFileSync(counter, "0");
  const result = JSON.parse(command(cli, repo, ["loop", "run", runId], { capture: true, env: { ...env, BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,approve" } }));
  if (result.state !== "converged") throw new Error(`packed Loop did not converge: ${result.state}`);
  const first = JSON.parse(command(cli, repo, ["loop", "complete", runId], { capture: true }));
  const second = JSON.parse(command(cli, repo, ["loop", "complete", runId], { capture: true }));
  if (first.alreadyApplied || !second.alreadyApplied) throw new Error("packed Loop completion was not idempotent");
  const plan = readFileSync(join(repo, "notes", "burnlists", "inprogress", "260722-001", "burnlist.md"), "utf8");
  if (/^- \[ \] L1 \|/mu.test(plan) || (plan.match(/^- L1 \| /gmu) ?? []).length !== 1) throw new Error("packed Loop completion did not atomically burn the assigned item");
  const runDirectory = join(repo, ".local", "burnlist", "loop", "m2", "runs", Buffer.from(runId).toString("hex"));
  if (!lstatSync(join(runDirectory, "completion-receipt.json")).isFile()) throw new Error("packed Loop completion did not retain its receipt");
  try { lstatSync(join(runDirectory, "completion-intent.json")); throw new Error("packed Loop completion left an intent behind"); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  const skillsBeforeHooks = realpathSync(join(home, ".agents", "skills", "burnlist"));
  invokeCli(cli, ["hooks", "install", "--agent", "codex"], { cwd: repo });
  if (realpathSync(join(home, ".agents", "skills", "burnlist")) !== skillsBeforeHooks) throw new Error("hooks installation modified skill registration");
  invokeCli(cli, ["hooks", "uninstall", "--agent", "codex"], { cwd: repo });
}

let exitCode = 0;
try {
  assertSelectedNode();
  mkdirSync(home, { recursive: true });
  mkdirSync(prefix, { recursive: true });
  mkdirSync(packRoot, { recursive: true });
  const packJson = runNpm([
    "pack",
    "--ignore-scripts",
    "--json",
    "--pack-destination",
    packRoot,
  ], { capture: true });
  const [packReport] = JSON.parse(packJson);
  const tarball = resolve(packRoot, packReport.filename);

  runNpm(["install", "--global", "--prefix", prefix, tarball]);
  const globalRoot = runNpm(["root", "--global", "--prefix", prefix], { capture: true });
  const packageRoot = resolve(globalRoot, "burnlist");
  assertManagedLink(".claude", "burnlist", packageRoot);
  assertManagedLink(".agents", "burnlist", packageRoot);

  const cli = join(packageRoot, "bin", "burnlist.mjs");
  const version = invokeCli(cli, ["--version"], { capture: true });
  if (version !== packReport.version) {
    throw new Error(`installed CLI reported ${version}, expected ${packReport.version}`);
  }
  assertLoopFlow(cli);
  invokeCli(cli, ["--stamp"], { capture: true });
  invokeCli(cli, ["oven", "list"], { capture: true });
  const sdkPath = invokeCli(cli, ["differential-testing", "sdk"], { capture: true });
  const expectedSdkPath = resolve(packageRoot, "ovens", "differential-testing", "engine", "adapter-sdk.mjs");
  if (realpathSync(sdkPath) !== realpathSync(expectedSdkPath)) throw new Error(`installed CLI reported unexpected SDK path: ${sdkPath}`);
  run(testNode, ["--input-type=module", "--eval", `
    const sdk = await import(${JSON.stringify(pathToFileURL(sdkPath).href)});
    const expected = [
      "DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION",
      "DIFFERENTIAL_TESTING_WORKER_STATE_SCHEMA",
      "assertDifferentialTestingWorkerState",
      "createDifferentialTestingWorker",
      "readDifferentialTestingWorkerState",
    ];
    if (sdk.DIFFERENTIAL_TESTING_ADAPTER_SDK_VERSION !== 4
      || JSON.stringify(Object.keys(sdk).sort()) !== JSON.stringify(expected.sort())) process.exit(1);
  `]);
  run(testNode, ["--input-type=module", "--eval", `
    const events = await import("burnlist/oven-events");
    const expected = ["normalizeOvenEvent", "publishOvenEvent", "readOvenEvents"];
    if (!expected.every((name) => typeof events[name] === "function")) process.exit(1);
  `], { cwd: packageRoot });

  invokeCli(cli, ["uninstall", "--global", "--purge"]);
  for (const agentDirectory of [".claude", ".agents"]) {
    for (const name of ["burnlist"]) {
      try {
        lstatSync(join(home, agentDirectory, "skills", name));
        throw new Error(`uninstall left the ${agentDirectory} ${name} skill registration behind`);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
  }
  console.log("Global npm install smoke test passed.");
} catch (error) {
  console.error(error.message);
  exitCode = 1;
} finally {
  rmSync(tmpRoot, { recursive: true, force: true });
}

process.exit(exitCode);
