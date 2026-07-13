import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { burnItem, findBurnlistDir, moveLifecycle, withLock } from "./lifecycle-moves.mjs";

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
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ token: "dead", pid: 999999999 }));
    let owner;
    withLock(dir, () => {
      owner = JSON.parse(readFileSync(join(lock, "owner.json"), "utf8"));
    });
    assert.equal(owner.pid, process.pid);
    assert.notEqual(owner.token, "dead");
    assert.equal(existsSync(lock), false);

    withLock(dir, () => {
      writeFileSync(join(lock, "owner.json"), JSON.stringify({ token: "replacement", pid: process.pid }));
    });
    assert.equal(JSON.parse(readFileSync(join(lock, "owner.json"), "utf8")).token, "replacement");
    rmSync(lock, { recursive: true, force: true });
  } finally {
    context.cleanup();
  }
});

test("withLock rejects a live foreign owner", () => {
  const context = fixture();
  try {
    const dir = join(context.root, "260713-001");
    const lock = join(dir, ".lock");
    mkdirSync(lock, { recursive: true });
    writeFileSync(join(lock, "owner.json"), JSON.stringify({ token: "foreign", pid: process.pid }));
    assert.throws(() => withLock(dir, () => {}), /260713-001 is busy \(locked\)/u);
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
