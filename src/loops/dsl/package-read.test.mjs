import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compileLoopPackage } from "./compile.mjs";

const execFileAsync = promisify(execFile);

const reviewSource = new URL("../../../loops/review/", import.meta.url);

async function reviewFiles() {
  return {
    "review.loop": await readFile(new URL("review.loop", reviewSource)),
    "instructions.md": await readFile(new URL("instructions.md", reviewSource)),
  };
}

async function supportsFifo(path) {
  try {
    await execFileAsync("mkfifo", [path]);
    return true;
  } catch {
    return false;
  }
}

test("descriptor package reads reject symlinks and oversized entries", async () => {
  const files = await reviewFiles();
  const folder = await mkdtemp(join(tmpdir(), "burnlist-loop-package-read-"));
  try {
    await writeFile(join(folder, "review.loop"), files["review.loop"]);
    await writeFile(join(folder, "instructions.md"), files["instructions.md"]);
    assert.equal((await compileLoopPackage(folder)).ok, true);

    await rm(join(folder, "example"), { force: true }).catch(() => {});
    await symlink(join(folder, "review.loop"), join(folder, "example"));
    let result = await compileLoopPackage(folder);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "E_PACKAGE_SYMLINK"));

    await rm(join(folder, "example"));
    await mkdir(join(folder, "example"));
    await writeFile(join(folder, "example", "item.md"), Buffer.alloc(65537, 65));
    result = await compileLoopPackage(folder);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "E_FILE_SIZE"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("descriptor package read hooks run beforeLeafRead before afterLeafOpenForTest", async () => {
  const files = await reviewFiles();
  const folder = await mkdtemp(join(tmpdir(), "burnlist-loop-read-hooks-"));
  try {
    await writeFile(join(folder, "review.loop"), files["review.loop"]);
    await writeFile(join(folder, "instructions.md"), files["instructions.md"]);
    await mkdir(join(folder, "example"));
    await writeFile(join(folder, "example", "item.md"), files["review.loop"]);

    const hooks = [];
    const result = await compileLoopPackage(folder, {
      beforeLeafRead: ({ path }) => hooks.push(`before:${path}`),
      afterLeafOpenForTest: ({ path }) => hooks.push(`after:${path}`),
    });

    assert.equal(result.ok, true);
    assert.deepEqual(hooks, [
      "before:example/item.md",
      "after:example/item.md",
      "before:instructions.md",
      "after:instructions.md",
      "before:review.loop",
      "after:review.loop",
    ]);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("descriptor package reads reject same-size rewrites", async () => {
  const files = await reviewFiles();
  const outer = await mkdtemp(join(tmpdir(), "burnlist-loop-race-"));
  const folder = join(outer, "package");
  const raceState = {
    hookReached: false,
    changed: false,
    restored: false,
    preservedInode: false,
    preservedSize: false,
  };

  try {
    await mkdir(folder);
    await writeFile(join(folder, "review.loop"), files["review.loop"]);
    await writeFile(join(folder, "instructions.md"), files["instructions.md"]);
    await mkdir(join(folder, "example"));
    await writeFile(join(folder, "example", "item.md"), files["review.loop"]);

    const result = await compileLoopPackage(folder, {
      afterLeafOpenForTest: async ({ path }) => {
        if (path !== "review.loop") return;

        raceState.hookReached = true;
        const target = join(folder, "example", "item.md");
        const beforeBytes = await readFile(target);
        const before = await lstat(target);

        const changed = Buffer.from(beforeBytes);
        changed[0] = changed[0] === 114 ? 83 : 114;
        await writeFile(target, changed);

        const changedBytes = await readFile(target);
        const during = await lstat(target);

        await writeFile(target, beforeBytes);
        const restoredBytes = await readFile(target);
        const restored = await lstat(target);

        raceState.changed = Buffer.compare(beforeBytes, changedBytes) !== 0;
        raceState.restored = Buffer.compare(beforeBytes, restoredBytes) === 0;
        raceState.preservedInode = before.ino === restored.ino;
        raceState.preservedSize = before.size === restored.size;
      },
    });

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "E_PACKAGE_RACE" && item.path === "example/item.md"));
    assert.equal(raceState.hookReached, true);
    assert.equal(raceState.changed, true);
    assert.equal(raceState.restored, true);
    assert.equal(raceState.preservedInode, true);
    assert.equal(raceState.preservedSize, true);
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("descriptor package reads reject root membership races", async () => {
  const files = await reviewFiles();
  const outer = await mkdtemp(join(tmpdir(), "burnlist-loop-race-"));
  const folder = join(outer, "package");
  const raceState = {
    hookReached: false,
    added: false,
    restored: false,
    transientInode: null,
    transientSize: null,
    transientWasMissing: false,
  };

  try {
    await mkdir(folder);
    await writeFile(join(folder, "review.loop"), files["review.loop"]);
    await writeFile(join(folder, "instructions.md"), files["instructions.md"]);
    await mkdir(join(folder, "example"));
    await writeFile(join(folder, "example", "item.md"), files["review.loop"]);

    const result = await compileLoopPackage(folder, {
      afterLeafOpenForTest: async ({ path }) => {
        if (path !== "instructions.md") return;

        raceState.hookReached = true;
        const transient = join(folder, "transient-entry.md");
        const before = await lstat(transient).catch(() => null);
        raceState.transientWasMissing = before === null;

        await writeFile(transient, "unexpected");
        const created = await lstat(transient);
        raceState.added = true;
        raceState.transientInode = created.ino;
        raceState.transientSize = created.size;

        await rm(transient);
        const after = await lstat(transient).catch(() => null);
        raceState.restored = after === null;
      },
    });

    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "E_PACKAGE_RACE" && item.path === ""));
    assert.equal(raceState.hookReached, true);
    assert.equal(raceState.transientWasMissing, true);
    assert.equal(raceState.added, true);
    assert.equal(raceState.restored, true);
    assert.equal(typeof raceState.transientInode, "number");
    assert.equal(raceState.transientSize, 10);
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("descriptor package reads reject swapped example paths without following FIFO", async (t) => {
  const files = await reviewFiles();
  const outer = await mkdtemp(join(tmpdir(), "burnlist-loop-example-fifo-"));
  const folder = join(outer, "package");
  try {
    await mkdir(folder);
    await writeFile(join(folder, "review.loop"), files["review.loop"]);
    await writeFile(join(folder, "instructions.md"), files["instructions.md"]);
    await mkdir(join(folder, "example"));
    await writeFile(join(folder, "example", "item.md"), files["review.loop"]);

    const fifoTarget = join(outer, "outside-fifo");
    await mkdir(fifoTarget);
    if (!(await supportsFifo(join(fifoTarget, "item.md")))) {
      t.skip("mkfifo unavailable in test environment");
      return;
    }

    const regularTarget = join(outer, "outside-regular");
    await mkdir(regularTarget);
    await writeFile(join(regularTarget, "item.md"), files["review.loop"]);

    let firstHookCount = 0;
    const fifoStart = Date.now();
    let result = await compileLoopPackage(folder, {
      beforeLeafRead: async ({ path }) => {
        if (path === "example/item.md") {
          firstHookCount += 1;
          await rm(join(folder, "example"), { recursive: true, force: true });
          await symlink(fifoTarget, join(folder, "example"));
        }
      },
    });
    const fifoElapsed = Date.now() - fifoStart;
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "E_PACKAGE_RACE"));
    assert.equal(firstHookCount, 1);
    assert.ok(fifoElapsed < 2000);

    await rm(join(folder, "example"), { recursive: true, force: true });
    await mkdir(join(folder, "example"));
    await writeFile(join(folder, "example", "item.md"), files["review.loop"]);

    let secondHookCount = 0;
    const start = Date.now();
    result = await compileLoopPackage(folder, {
      beforeLeafRead: async ({ path }) => {
        if (path === "example/item.md") {
          secondHookCount += 1;
          await rm(join(folder, "example"), { recursive: true, force: true });
          await symlink(regularTarget, join(folder, "example"));
        }
      },
    });
    const elapsed = Date.now() - start;
    assert.equal(secondHookCount, 1);
    assert.ok(elapsed < 2000);
    assert.equal(result.ok, false);
    assert.ok(result.diagnostics.some((item) => item.code === "E_PACKAGE_RACE"));
  } finally {
    await rm(outer, { recursive: true, force: true });
  }
});

test("descriptor package diagnostics are merged and truncated after discovery, missing-file, and compiler findings", async () => {
  const files = await reviewFiles();
  const folder = await mkdtemp(join(tmpdir(), "burnlist-loop-package-diagnostics-"));
  try {
    const badCount = 90;
    const extras = Array.from({ length: badCount }, (_, index) => ` bad-${String(index).padStart(3, "0")}="x"`).join("");
    const malformed = files["review.loop"].toString()
      .replace('version="0.1.0"', "version=\"0\"")
      .replace('max-rounds="3"', `max-rounds="0"${extras}`)
      .replace('<edge from="implement" on="complete" to="verify"/>', '<edge from="implement" on="error" to="completed"/>');

    await writeFile(join(folder, "review.loop"), malformed);
    await writeFile(join(folder, "note.md"), "ignored\n");

    const budgetOffset = malformed.indexOf("<budget");
    const implementOffset = malformed.indexOf('<agent id="implement"');
    const verifyOffset = malformed.indexOf('<check id="verify"');
    const reviewOffset = malformed.indexOf('<agent id="review"');
    const convergedOffset = malformed.indexOf('<gate id="converged"');
    const convergenceDominanceOffset = malformed.indexOf('<edge from="implement" on="error" to="completed"/>');

    const expected = [
      { path: "", byteOffset: 0, code: "E_TOO_MANY_DIAGNOSTICS", message: "Too many diagnostics (maximum 100)" },
      { path: "instructions.md", byteOffset: 0, code: "E_PACKAGE_MISSING", message: "Required package file is missing" },
      { path: "note.md", byteOffset: 0, code: "E_PACKAGE_PATH", message: "Unknown package file" },
      { path: "review.loop", byteOffset: 0, code: "E_SCALAR", message: "version must be a Stage 1 SemVer" },
      ...Array.from({ length: badCount }, (_, index) => ({
        path: "review.loop",
        byteOffset: budgetOffset,
        code: "E_ATTRIBUTE_UNKNOWN",
        message: `Attribute bad-${String(index).padStart(3, "0")} is not allowed on <budget>`,
      })),
      { path: "review.loop", byteOffset: budgetOffset, code: "E_SCALAR", message: "max-rounds must be an integer from 1 through 100" },
      { path: "review.loop", byteOffset: implementOffset, code: "E_EDGE_MISSING", message: "Missing edge for implement/complete" },
      { path: "review.loop", byteOffset: verifyOffset, code: "E_REACHABILITY", message: "Node verify is not reachable from entry" },
      { path: "review.loop", byteOffset: reviewOffset, code: "E_REACHABILITY", message: "Node review is not reachable from entry" },
      { path: "review.loop", byteOffset: convergedOffset, code: "E_REACHABILITY", message: "Node converged is not reachable from entry" },
      { path: "review.loop", byteOffset: convergenceDominanceOffset, code: "E_CONVERGENCE_DOMINATION", message: "Only convergence gate pass may target the converged terminal" },
    ];

    const result = await compileLoopPackage(folder);
    assert.equal(result.ok, false);
    assert.equal(result.diagnostics.length, 100);
    assert.deepEqual(result.diagnostics, expected);
    assert.ok(result.diagnostics.some((item) => item.path === "instructions.md" && item.code === "E_PACKAGE_MISSING"));
    assert.ok(result.diagnostics.some((item) => item.path === "note.md" && item.code === "E_PACKAGE_PATH"));
    assert.ok(result.diagnostics.some((item) => item.code === "E_ATTRIBUTE_UNKNOWN"));
    assert.ok(result.diagnostics.some((item) => item.code === "E_CONVERGENCE_DOMINATION"));
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});
