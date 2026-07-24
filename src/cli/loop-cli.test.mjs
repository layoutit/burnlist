#!/usr/bin/env node
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { runLoopCli } from "./loop-cli.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const cli = join(root, "bin", "burnlist.mjs");
const itemRef = "item:260722-001#BUG-07";
const runRef = "run:01arz3ndektsv4rrffq69g5fav";

function fixture({ git = true } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "burnlist-loop-cli-"));
  const repo = join(directory, "repo");
  mkdirSync(repo, { recursive: true });
  if (git) execFileSync("git", ["init", "--quiet", repo]);
  const planDir = join(repo, "notes", "burnlists", "inprogress", "260722-001");
  mkdirSync(planDir, { recursive: true });
  writeFileSync(join(planDir, "burnlist.md"), [
    "# Test",
    "",
    "## Active Checklist",
    "- [ ] BUG-07 | Keep this line",
    "",
    "## Completed",
    "",
  ].join("\n"));
  return { directory, repo, cleanup: () => rmSync(directory, { recursive: true, force: true }) };
}

function runCommand(repo, args) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: repo, encoding: "utf8" });
}
function assign(context) {
  const result = runCommand(context.repo, ["loop", "assign", itemRef, "loop:builtin:review", "--repo", context.repo]);
  assert.equal(result.status, 0, result.stderr);
  const [assignmentId, selector, executable] = result.stdout.trimEnd().split("\n");
  return { assignmentId, selector, executable, path: join(context.repo, ".local", "burnlist", "loop", "v2", "assignments", assignmentId.slice(11)) };
}
function pinError(executable) {
  return `burnlist: ELOOP_PIN_BYTES_UNAVAILABLE: pinned=${executable} current=${executable}; restore the assignment artifact or safely unassign and reassign the item\n`;
}

test("loop view renders unpinned review with canonical selector", () => {
  const context = fixture();
  try {
    const result = runCommand(context.repo, ["loop", "view", "review", "--repo", context.repo]);
    assert.equal(result.status, 0, `${result.stderr}`);
    assert.match(result.stdout, /loop:builtin:review/);
    assert.equal(result.stderr, "");
  } finally { context.cleanup(); }
});

test("loop view renders item-pinned authority from fixture assignment", () => {
  const context = fixture();
  try {
    assign(context);
    const result = runCommand(context.repo, ["loop", "view", itemRef, "--repo", context.repo]);
    assert.equal(result.status, 0, `${result.stderr}`);
    assert.match(result.stdout, /loop:builtin:review/);
    assert.equal(result.stderr, "");
  } finally { context.cleanup(); }
});

test("loop view rejects invalid selectors and keeps stdout empty on failure", () => {
  const context = fixture();
  try {
    const invalid = runCommand(context.repo, ["loop", "view", "nonsense", "--repo", context.repo]);
    assert.equal(invalid.status, 1);
    assert.equal(invalid.stdout, "");
    assert.equal(invalid.stderr, "burnlist: E_LOOP_SELECTOR_INVALID: Invalid Loop selector: nonsense\n");
  } finally { context.cleanup(); }
});

test("item-pinned view reports stable recovery for missing, corrupt, and drifted artifacts", () => {
  for (const mutation of ["missing", "corrupt", "symlink", "binding-drift"]) {
    const context = fixture();
    try {
      const assigned = assign(context);
      if (mutation === "missing") rmSync(join(assigned.path, "recipe.frozen"));
      if (mutation === "corrupt") writeFileSync(join(assigned.path, "recipe.frozen"), "not a frozen recipe\n");
      if (mutation === "symlink") {
        rmSync(join(assigned.path, "recipe.frozen"));
        symlinkSync(join(context.repo, "notes"), join(assigned.path, "recipe.frozen"));
      }
      if (mutation === "binding-drift") {
        const path = join(assigned.path, "manifest.json");
        const manifest = JSON.parse(readFileSync(path, "utf8"));
        manifest.itemRef = "item:260722-001#OTHER";
        writeFileSync(path, `${JSON.stringify(manifest)}\n`, { mode: 0o600 });
      }
      const result = runCommand(context.repo, ["loop", "view", itemRef, "--repo", context.repo]);
      assert.equal(result.status, 1, mutation);
      assert.equal(result.stdout, "", mutation);
      assert.equal(result.stderr, pinError(assigned.executable), mutation);
    } finally { context.cleanup(); }
  }
});

test("loop view rejects duplicate, missing, and unknown --repo options", () => {
  const context = fixture();
  try {
    const duplicate = runCommand(context.repo, ["loop", "view", "review", "--repo", context.repo, "--repo", context.repo]);
    assert.equal(duplicate.status, 1);
    assert.equal(duplicate.stdout, "");
    assert.match(duplicate.stderr, /--repo must be specified at most once/u);

    const missing = runCommand(context.repo, ["loop", "view", "review", "--repo"]);
    assert.equal(missing.status, 1);
    assert.equal(missing.stdout, "");
    assert.match(missing.stderr, /--repo requires a path/u);

    const unknown = runCommand(context.repo, ["loop", "view", "review", "--repo", context.repo, "--mystery"]);
    assert.equal(unknown.status, 1);
    assert.equal(unknown.stdout, "");
    assert.match(unknown.stderr, /Unknown option: --mystery/u);
  } finally { context.cleanup(); }
});

test("loop view emits empty stdout for unavailable Run store and unavailable Loop package", () => {
  const context = fixture();
  try {
    const runUnavailable = runCommand(context.repo, ["loop", "view", runRef, "--repo", context.repo]);
    assert.equal(runUnavailable.status, 1);
    assert.equal(runUnavailable.stdout, "");
    assert.equal(runUnavailable.stderr, "burnlist: E_RUN_UNAVAILABLE: Run-frozen authority is unavailable before the Run store is installed\n");

    const loopMissing = runCommand(context.repo, ["loop", "view", "loop:builtin:does-not-exist", "--repo", context.repo]);
    assert.equal(loopMissing.status, 1);
    assert.equal(loopMissing.stdout, "");
    assert.match(loopMissing.stderr, /not found/u);
  } finally { context.cleanup(); }
});

test("injected verified Run reader renders identical bytes for TTY and pipe and ignores record loopRef", async () => {
  const context = fixture();
  try {
    const assigned = assign(context);
    const frozenRecipe = readFileSync(join(assigned.path, "recipe.frozen"));
    const runReader = async (runId) => ({ runId, loopRef: "loop:builtin:attacker\nINJECTED", frozenRecipe });
    const capture = (isTTY) => {
      let bytes = ""; return { stream: { isTTY, write(value) { bytes += value; } }, read: () => bytes };
    };
    const pipe = capture(false), tty = capture(true);
    await runLoopCli(["view", runRef, "--repo", context.repo], { runReader, stdout: pipe.stream });
    await runLoopCli(["view", runRef, "--repo", context.repo], { runReader, stdout: tty.stream });
    assert.equal(tty.read(), pipe.read());
    assert.match(pipe.read(), /^MODE: RUN-FROZEN$/m);
    assert.match(pipe.read(), /^LOOP: loop:builtin:review$/m);
    assert.match(pipe.read(), /^EXECUTION: assigned=er1-sha256:[a-f0-9]{64} current=not-checked status=not-checked$/m);
    assert.doesNotMatch(pipe.read(), /attacker|INJECTED|\x1b|\r/u);
  } finally { context.cleanup(); }
});

test("real executable emits the same view bytes through a pipe and a PTY", { skip: process.platform !== "darwin" }, () => {
  const context = fixture();
  try {
    const args = ["loop", "view", "review", "--repo", context.repo];
    const pipe = runCommand(context.repo, args);
    assert.equal(pipe.status, 0, pipe.stderr);
    const expect = [
      "set timeout 20",
      'spawn -noecho sh -c {stty -onlcr; exec "$BL_NODE" "$BL_CLI" loop view review --repo "$BL_REPO"}',
      "expect eof",
      "set result [wait]",
      "exit [lindex $result 3]",
    ].join("; ");
    const pty = spawnSync("expect", ["-c", expect], {
      cwd: context.repo,
      encoding: "utf8",
      env: { ...process.env, BL_NODE: process.execPath, BL_CLI: cli, BL_REPO: context.repo },
    });
    assert.equal(pty.status, 0, pty.stderr);
    assert.equal(pty.stdout, pipe.stdout);
  } finally { context.cleanup(); }
});

test("loop --help lists view and assign/unassign syntax", () => {
  const context = fixture({ git: false });
  try {
    const help = runCommand(context.repo, ["loop", "--help"]);
    assert.equal(help.status, 0, help.stderr);
    assert.equal(help.stderr, "");
    assert.match(help.stdout, /Usage: burnlist loop assign <ItemRef> <LoopRef> \[--repo <path>\] \| burnlist loop unassign <ItemRef> \[--repo <path>\] \| burnlist loop view <LoopRef\|ItemRef\|review> \[--repo <path>\]/u);
  } finally { context.cleanup(); }
});

test("existing loop assign/unassign smoke stays stable", () => {
  const context = fixture();
  try {
    const assign = runCommand(context.repo, ["loop", "assign", itemRef, "loop:builtin:review", "--repo", context.repo]);
    assert.equal(assign.status, 0, `${assign.stderr}`);
    assert.match(assign.stdout, /^as\d+-sha256:/u);

    const unassign = runCommand(context.repo, ["loop", "unassign", itemRef, "--repo", context.repo]);
    assert.equal(unassign.status, 0, `${unassign.stderr}`);
    assert.match(unassign.stdout, /^as\d+-sha256:/u);
  } finally { context.cleanup(); }
});
