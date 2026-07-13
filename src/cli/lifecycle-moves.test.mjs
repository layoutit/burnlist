import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { burnItem, closeLifecycle, findBurnlistDir, moveLifecycle, withLock } from "./lifecycle-moves.mjs";

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-lifecycle-moves-"));
  return { root, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function folder(root, lifecycle, id) {
  return join(root, "notes", "burnlists", lifecycle, id);
}

function writePlan(root, lifecycle, id) {
  const dir = folder(root, lifecycle, id);
  mkdirSync(dir, { recursive: true });
  const planPath = join(dir, "burnlist.md");
  writeFileSync(planPath, [
    "# Test Burnlist",
    "",
    "## Active Checklist",
    "- [ ] B1 | Test staged burn",
    "",
    "## Completed",
    "",
  ].join("\n"));
  return { dir, planPath };
}

test("withLock takes over a dead owner and preserves a replacement owner on release", () => {
  const context = fixture();
  try {
    const dir = join(context.root, "260713-001");
    const lock = join(dir, ".lock");
    mkdirSync(dir, { recursive: true });
    writeFileSync(lock, JSON.stringify({ token: "dead", pid: 999999999 }));
    let owner;
    withLock(dir, () => {
      owner = JSON.parse(readFileSync(lock, "utf8"));
    });
    assert.equal(owner.pid, process.pid);
    assert.notEqual(owner.token, "dead");
    assert.equal(existsSync(lock), false);

    withLock(dir, () => {
      writeFileSync(lock, JSON.stringify({ token: "replacement", pid: process.pid }));
    });
    assert.equal(JSON.parse(readFileSync(lock, "utf8")).token, "replacement");
    rmSync(lock, { force: true });
  } finally {
    context.cleanup();
  }
});

test("withLock rejects a live foreign owner", () => {
  const context = fixture();
  try {
    const dir = join(context.root, "260713-001");
    const lock = join(dir, ".lock");
    mkdirSync(dir, { recursive: true });
    writeFileSync(lock, JSON.stringify({ token: "foreign", pid: process.pid }));
    assert.throws(() => withLock(dir, () => {}), /260713-001 is busy \(locked\)/u);
  } finally {
    context.cleanup();
  }
});

test("withLock treats a malformed lock as busy", () => {
  const context = fixture();
  try {
    const dir = join(context.root, "260713-001");
    const lock = join(dir, ".lock");
    mkdirSync(dir, { recursive: true });
    writeFileSync(lock, "");
    assert.throws(() => withLock(dir, () => {}), /260713-001 is busy \(locked\)/u);
    assert.equal(readFileSync(lock, "utf8"), "");
  } finally {
    context.cleanup();
  }
});

test("two racing lock acquirers have exactly one winner", async () => {
  const context = fixture();
  try {
    const dir = join(context.root, "260713-001");
    mkdirSync(dir, { recursive: true });
    const script = [
      `import { withLock } from ${JSON.stringify(new URL("./lifecycle-moves.mjs", import.meta.url).href)};`,
      "try {",
      "  withLock(process.argv[1], () => {",
      "    process.stdout.write('won\\n');",
      "    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 750);",
      "  });",
      "} catch (error) { process.stderr.write(error.message); process.exitCode = 1; }",
    ].join("\n");
    const run = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script, dir]);
      let output = "";
      child.stdout.on("data", (chunk) => { output += chunk; });
      child.on("close", (status) => resolve({ output, status }));
    });
    const results = await Promise.all([run(), run()]);
    assert.deepEqual(results.map((result) => result.status).sort(), [0, 1]);
    assert.equal(results.filter((result) => result.output === "won\n").length, 1);
  } finally {
    context.cleanup();
  }
});

test("concurrent same-id lifecycle moves publish only one target", async () => {
  const context = fixture();
  try {
    const id = "260713-001";
    writePlan(context.root, "draft", id);
    const script = [
      `import { moveLifecycle } from ${JSON.stringify(new URL("./lifecycle-moves.mjs", import.meta.url).href)};`,
      "try {",
      "  moveLifecycle({ repoRoot: process.argv[1], id: process.argv[2], from: 'draft', to: 'ready', gate() {} });",
      "} catch (error) { process.stderr.write(error.message); process.exitCode = 1; }",
    ].join("\n");
    const run = () => new Promise((resolve) => {
      const child = spawn(process.execPath, ["--input-type=module", "--eval", script, context.root, id]);
      child.on("close", (status) => resolve(status));
    });
    assert.deepEqual((await Promise.all([run(), run()])).sort(), [0, 1]);
    assert.equal(existsSync(folder(context.root, "draft", id)), false);
    assert.equal(existsSync(folder(context.root, "ready", id)), true);
  } finally {
    context.cleanup();
  }
});

test("burn rejects an id duplicated across lifecycle folders", () => {
  const context = fixture();
  try {
    const id = "260713-001";
    writePlan(context.root, "inprogress", id);
    mkdirSync(folder(context.root, "draft", id), { recursive: true });
    assert.throws(() => burnItem(context.root, id, "B1"), /ambiguous across draft, inprogress/u);
  } finally {
    context.cleanup();
  }
});

test("exported lifecycle operations reject traversal ids before filesystem access", () => {
  const context = fixture();
  try {
    assert.throws(() => findBurnlistDir(context.root, "../x"), /Invalid Burnlist id: \.\.\/x/u);
    assert.throws(() => moveLifecycle({
      repoRoot: context.root,
      id: "../x",
      from: "draft",
      to: "ready",
      gate() {},
    }), /Invalid Burnlist id: \.\.\/x/u);
    assert.throws(() => burnItem(context.root, "../x", "B1"), /Invalid Burnlist id: \.\.\/x/u);
    assert.equal(existsSync(join(context.root, "notes")), false);
  } finally {
    context.cleanup();
  }
});

test("burn validates its staged markdown before replacing burnlist.md", () => {
  const context = fixture();
  const originalDate = globalThis.Date;
  try {
    const { planPath } = writePlan(context.root, "inprogress", "260713-001");
    const before = readFileSync(planPath, "utf8");
    class InvalidTimestampDate extends originalDate {
      getFullYear() { return Number.NaN; }
    }
    globalThis.Date = InvalidTimestampDate;
    assert.throws(() => burnItem(context.root, "260713-001", "B1"), /invalid timestamp/u);
    assert.equal(readFileSync(planPath, "utf8"), before);
    assert.equal(readdirSync(join(context.root, "notes", "burnlists", "inprogress", "260713-001")).some((name) => name.endsWith(".tmp")), false);
  } finally {
    globalThis.Date = originalDate;
    context.cleanup();
  }
});

test("close leaves its source unchanged when a populated target prevents the rename", () => {
  const context = fixture();
  try {
    const id = "260713-001";
    const { planPath } = writePlan(context.root, "inprogress", id);
    writeFileSync(planPath, [
      "# Test Burnlist",
      "",
      "## Active Checklist",
      "",
      "## Completed",
      "- B1 | 2026-07-13T12:00:00+00:00 | Test staged burn",
      "",
    ].join("\n"));
    const before = readFileSync(planPath, "utf8");
    const target = folder(context.root, "completed", id);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "existing"), "keep\n");
    assert.throws(() => closeLifecycle(context.root, id), /260713-001: target exists/u);
    assert.equal(readFileSync(planPath, "utf8"), before);
    assert.equal(readFileSync(planPath, "utf8").includes("## Completion Digest"), false);
  } finally {
    context.cleanup();
  }
});

test("close leaves its source unchanged when an empty target already exists", () => {
  const context = fixture();
  try {
    const id = "260713-001";
    const { planPath } = writePlan(context.root, "inprogress", id);
    writeFileSync(planPath, [
      "# Test Burnlist",
      "",
      "## Active Checklist",
      "",
      "## Completed",
      "- B1 | 2026-07-13T12:00:00+00:00 | Test staged burn",
      "",
    ].join("\n"));
    const before = readFileSync(planPath, "utf8");
    mkdirSync(folder(context.root, "completed", id), { recursive: true });
    assert.throws(() => closeLifecycle(context.root, id), /260713-001: target exists/u);
    assert.equal(readFileSync(planPath, "utf8"), before);
  } finally {
    context.cleanup();
  }
});

test("afterMove failure rolls back a lifecycle move without changing its plan", () => {
  const context = fixture();
  try {
    const id = "260713-001";
    const { planPath } = writePlan(context.root, "inprogress", id);
    const before = readFileSync(planPath, "utf8");
    assert.throws(() => moveLifecycle({
      repoRoot: context.root,
      id,
      from: "inprogress",
      to: "completed",
      gate() {},
      afterMove() { throw new Error("digest failed"); },
    }), /digest failed/u);
    assert.equal(readFileSync(planPath, "utf8"), before);
    assert.equal(existsSync(folder(context.root, "completed", id)), false);
  } finally {
    context.cleanup();
  }
});
