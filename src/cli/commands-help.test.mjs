import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createProductionRunAuthority, fixtureItemRef } from "../loops/run/run-test-fixtures.mjs";
import { runStore } from "../loops/run/run-store.mjs";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const cli = join(root, "bin", "burnlist.mjs");

function fixture({ git = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-command-help-"));
  if (git) execFileSync("git", ["init", "--quiet", directory]);
  return { directory, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function run(cwd, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd, encoding: "utf8" });
}

test("install, uninstall, and hooks subcommand help exit successfully with usage", () => {
  const context = fixture({ git: false });
  try {
    for (const [args, usage] of [
      [["install", "--help"], /Usage: burnlist install/u],
      [["uninstall", "--help"], /Usage: burnlist uninstall/u],
      [["hooks", "install", "--help"], /Usage: burnlist hooks/u],
      [["hooks", "uninstall", "--help"], /Usage: burnlist hooks/u],
      [["hooks", "status", "--help"], /Usage: burnlist hooks/u],
    ]) {
      const result = run(context.directory, args);
      assert.equal(result.status, 0, args.join(" "));
      assert.match(result.stdout, usage);
      assert.doesNotMatch(result.stderr, /unexpected argument/u);
    }
  } finally { context.cleanup(); }
});

test("top-level and Oven help expose the validated use and set flow", () => {
  const context = fixture({ git: false });
  try {
    const top = run(context.directory, ["--help"]);
    assert.equal(top.status, 0, top.stderr);
    assert.match(top.stdout, /burnlist oven <[^\n]*use[^\n]*set[^\n]*>/u);
    assert.match(top.stdout, /burnlist loop view <LoopRef\|ItemRef\|review> \[--repo <path>\]/u);
    assert.match(top.stdout, /burnlist loop create <ItemRef> \[--repo <path>\]/u);
    assert.match(top.stdout, /burnlist loop list \[--repo <path>\]/u);
    assert.match(top.stdout, /burnlist loop run\|resume <RunRef> \[--repo <path>\]/u);
    assert.match(top.stdout, /burnlist loop status\|inspect <RunRef> \[--repo <path>\]/u);
    assert.match(top.stdout, /burnlist loop pause\|stop <RunRef> \[--repo <path>\] \(idle Run only\)/u);
    assert.match(top.stdout, /burnlist loop reconcile <RunRef> --recovery-proof <hex> \[--repo <path>\]/u);
    assert.match(top.stdout, /burnlist loop complete <RunRef> \[--repo <path>\]/u);
    assert.match(top.stdout, /burnlist loop capability <inspect\|trust> <id> \.\.\./u);
    assert.match(top.stdout, /burnlist agent <profile\|doctor> \.\.\./u);
    assert.match(top.stdout, /burnlist route set <route> --profile <slug> \[--repo <path>\]/u);

    const oven = run(context.directory, ["oven", "help"]);
    assert.equal(oven.status, 0, oven.stderr);
    assert.match(oven.stdout, /burnlist oven use <id> \[--repo <path>\] \[--force\]/u);
    assert.match(oven.stdout, /burnlist oven set <id> <path\|-\|json> \[--repo <path>\]/u);
    assert.match(oven.stdout, /same runtime validator/u);
    assert.match(oven.stdout, /shape-only/u);
    assert.match(oven.stdout, /\.local\/burnlist\/data\/<id>\.json/u);
  } finally { context.cleanup(); }
});

test("Loop local configuration help exposes only explicit setup commands", () => {
  const context = fixture({ git: false });
  try {
    for (const [args, usage] of [
      [["agent", "--help"], /burnlist agent profile add <slug>/u],
      [["agent", "--help"], /burnlist agent doctor <slug>/u],
      [["route", "--help"], /burnlist route set <implementation\.standard\|review\.strong>/u],
      [["loop", "--help"], /burnlist loop capability trust <id> --revision cp1-sha256:<hex> --grants <json-file>/u],
    ]) {
      const result = run(context.directory, args);
      assert.equal(result.status, 0, result.stderr); assert.match(result.stdout, usage); assert.equal(result.stderr, "");
    }
    for (const args of [["agent", "controller", "add", "host"], ["agent", "preflight", "maker"]]) {
      const result = run(context.directory, args);
      assert.equal(result.status, 2, args.join(" "));
      assert.match(result.stderr, /Usage: burnlist agent profile add/u);
    }
  } finally { context.cleanup(); }
});

test("nested Loop help snapshots every Stage 1 control", () => {
  const context = fixture({ git: false });
  try {
    const result = run(context.directory, ["loop", "--help"]);
    assert.equal(result.status, 0, result.stderr);
    for (const command of ["create", "list", "run|pause|resume|stop|complete", "status|inspect", "reconcile"]) {
      assert.match(result.stdout, new RegExp(`burnlist loop ${command}`, "u"));
    }
    assert.match(result.stdout, /pause\|resume\|stop\|complete <RunRef>/u);
    assert.equal(result.stderr, "");
  } finally { context.cleanup(); }
});

test("empty skill and hook uninstalls report that there is nothing to remove", () => {
  const context = fixture();
  try {
    for (const args of [["uninstall"], ["hooks", "uninstall"]]) {
      const result = run(context.directory, args);
      assert.equal(result.status, 0, args.join(" "));
      assert.match(result.stdout, /Burnlist: nothing installed to remove\./u);
    }
  } finally { context.cleanup(); }
});

test("hooks status labels CLI capability and identifies the inspected config", () => {
  const context = fixture();
  try {
    const result = run(context.directory, ["hooks", "status", "--agent", "codex"]);
    assert.equal(result.status, 0);
    assert.match(result.stdout, /codex: none;.*config .*\.codex\/hooks\.json/u);
    assert.match(result.stdout, /^codex cli: /mu);
  } finally { context.cleanup(); }
});

test("hooks install outside Git gives a friendly actionable error", () => {
  const context = fixture({ git: false });
  try {
    mkdirSync(join(context.directory, "nested"));
    const result = run(join(context.directory, "nested"), ["hooks", "install"]);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /hooks install must run inside a Git repository/u);
    assert.doesNotMatch(result.stderr, /fatal:/u);
  } finally { context.cleanup(); }
});

test("hooks status and uninstall name their own Git requirement", () => {
  const context = fixture({ git: false });
  try {
    for (const command of ["status", "uninstall"]) {
      const result = run(context.directory, ["hooks", command]);
      assert.equal(result.status, 1, command);
      assert.match(result.stderr, new RegExp(`hooks ${command} must run inside a Git repository`, "u"));
      assert.doesNotMatch(result.stderr, /hooks install must run/u);
    }
  } finally { context.cleanup(); }
});

test("Review Loop documentation command matrix runs against the production fixture", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-loop-docs-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { repo, binary } = createProductionRunAuthority(join(directory, "repo"));
  const loop = (...args) => run(repo, ["loop", ...args, "--repo", repo]);
  const command = (...args) => run(repo, [...args, "--repo", repo]);
  const planPath = join(repo, "notes", "burnlists", "inprogress", "260722-001", "burnlist.md");
  writeFileSync(planPath, readFileSync(planPath, "utf8").replace("## Completed", [
    "- [ ] L30 | Direct workflow fixture",
    "- [ ] L31 | Pause and resume fixture",
    "- [ ] L32 | Stop fixture",
    "- [ ] L33 | Reconcile fixture",
    "",
    "## Completed",
  ].join("\n")));
  const profile = (slug, authority) => command("agent", "profile", "add", slug,
    "--adapter", "builtin:codex-cli", "--binary", binary, "--model", "gpt-5.3-codex-spark",
    "--effort", "medium", "--authority", authority);
  for (const result of [profile("maker", "write"), profile("reviewer", "read"),
    command("route", "set", "implementation.standard", "--profile", "maker"),
    command("route", "set", "review.strong", "--profile", "reviewer"),
    command("agent", "doctor", "maker"), command("agent", "doctor", "reviewer")]) {
    assert.equal(result.status, 0, result.stderr);
  }
  const inspected = loop("capability", "inspect", "repo-verify");
  assert.equal(inspected.status, 0, inspected.stderr);
  const revision = JSON.parse(inspected.stdout).revision;
  const trusted = loop("capability", "trust", "repo-verify", "--revision", revision, "--grants", join(repo, "grants.json"));
  assert.equal(trusted.status, 0, trusted.stderr);
  for (const args of [["setup", "status"], ["list"], ["view", fixtureItemRef]]) {
    const result = loop(...args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  }

  const directRef = "item:260722-001#L30";
  const assignedDirect = loop("assign", directRef, "loop:builtin:review");
  assert.equal(assignedDirect.status, 0, assignedDirect.stderr);
  const blockedBurn = command("burn", "260722-001", "L30", "--check");
  assert.equal(blockedBurn.status, 1);
  assert.match(blockedBurn.stderr, /direct burn is blocked by Loop metadata/u);
  const unassigned = loop("unassign", directRef);
  assert.equal(unassigned.status, 0, unassigned.stderr);
  const directBurn = command("burn", "260722-001", "L30", "--check");
  assert.equal(directBurn.status, 0, directBurn.stderr);

  const created = loop("create", fixtureItemRef);
  assert.equal(created.status, 0, created.stderr);
  const runId = JSON.parse(created.stdout).runId;
  for (const args of [["status", runId], ["inspect", runId]]) {
    const result = loop(...args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  }
  const counter = join(directory, "counter");
  writeFileSync(counter, "0");
  const executed = spawnSync(process.execPath, [cli, "loop", "run", runId, "--repo", repo], {
    cwd: repo,
    encoding: "utf8",
    env: { ...process.env, BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,approve" },
  });
  assert.equal(executed.status, 0, executed.stderr);
  assert.equal(JSON.parse(executed.stdout).state, "converged");
  for (const args of [["complete", runId], ["complete", runId]]) {
    const result = loop(...args);
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
  }

  const pauseRef = "item:260722-001#L31";
  assert.equal(loop("assign", pauseRef, "loop:builtin:review").status, 0);
  const pausedRun = JSON.parse(loop("create", pauseRef).stdout).runId;
  const paused = loop("pause", pausedRun);
  assert.equal(paused.status, 0, paused.stderr);
  assert.equal(JSON.parse(paused.stdout).state, "paused");
  writeFileSync(counter, "0");
  const resumed = spawnSync(process.execPath, [cli, "loop", "resume", pausedRun, "--repo", repo], {
    cwd: repo, encoding: "utf8",
    env: { ...process.env, BURNLIST_FAKE_COUNTER: counter, BURNLIST_FAKE_OUTCOMES: "complete,approve" },
  });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(JSON.parse(resumed.stdout).state, "converged");

  const stoppedRef = "item:260722-001#L32";
  assert.equal(loop("assign", stoppedRef, "loop:builtin:review").status, 0);
  const stoppedRun = JSON.parse(loop("create", stoppedRef).stdout).runId;
  const stopped = loop("stop", stoppedRun);
  assert.equal(stopped.status, 0, stopped.stderr);
  assert.equal(JSON.parse(stopped.stdout).state, "stopped");

  const reconciledRef = "item:260722-001#L33";
  assert.equal(loop("assign", reconciledRef, "loop:builtin:review").status, 0);
  const reconciledRun = JSON.parse(loop("create", reconciledRef).stdout).runId;
  const store = runStore(repo), acquired = store.acquireLease(reconciledRun);
  store.append(reconciledRun, acquired.lease, "node-started", { nodeId: "implement", attempt: 1 });
  store.append(reconciledRun, acquired.lease, "invocation-started", { nodeId: "implement", attempt: 1, invocationId: "a".repeat(32) });
  const reconciled = loop("reconcile", reconciledRun, "--recovery-proof", acquired.recoveryProof);
  assert.equal(reconciled.status, 0, reconciled.stderr);
  assert.equal(JSON.parse(reconciled.stdout).state, "needs-human");
});

test("Review Loop documentation preserves Stage 1 boundaries", () => {
  const files = [
    join(root, "README.md"),
    join(root, "website", "src", "content", "docs", "loops.mdx"),
    join(root, "skills", "burnlist", "SKILL.md"),
  ].map((path) => readFileSync(path, "utf8")).join("\n");
  assert.match(files, /filesystem write denial.*supervised/us);
  assert.match(files, /fresh reviewer process.*enforced/us);
  assert.match(files, /[Pp]arallelism.*unsupported/us);
  assert.match(files, /Docker isolation.*unsupported/us);
  assert.match(files, /custom adapters.*unsupported/us);
  assert.match(files, /forecasting.*unsupported/us);
  assert.match(files, /skill.*hooks.*independent/us);
  assert.match(files, /loop-capability-example\.json/us);
  assert.match(files, /gpt-5\.6-terra/us);
  assert.match(files, /idle.*foreground owner/us);
});
