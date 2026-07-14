import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveOvenPackageDir } from "../server/fs-safe.mjs";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-storage-"));
  const repo = join(root, "repo");
  mkdirSync(repo);
  return { repo, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(context, args, input) {
  return execFileSync(process.execPath, [binPath, ...args], { cwd: context.repo, encoding: "utf8", input });
}

function detailWithStoredBytes(targetBytes, fill = "d") {
  const detail = {
    version: 1,
    columns: 2,
    rows: 32,
    rowHeight: 48,
    cells: Array.from({ length: 32 }, (_, index) => ({
      id: `cell-${index + 1}`,
      title: "Title",
      description: "",
      widget: "metric",
      source: "/metric",
      format: "plain",
      column: 1,
      row: index + 1,
      columnSpan: 1,
      rowSpan: 1,
    })),
  };
  let remaining = targetBytes - Buffer.byteLength(`${JSON.stringify(detail, null, 2)}\n`);
  for (const cell of detail.cells) {
    const amount = Math.min(2_000, Math.ceil(remaining / Buffer.byteLength(fill)));
    cell.description = fill.repeat(amount);
    remaining -= Buffer.byteLength(cell.description);
  }
  assert.equal(remaining, 0, "test fixture cannot reach its requested detail size");
  return detail;
}

test("--package accepts a 133KB envelope when each stored component fits", () => {
  const context = fixture();
  try {
    const instructions = `# ${"x".repeat(65_533)}`;
    const detail = detailWithStoredBytes(69 * 1024);
    const packageInput = JSON.stringify({ instructions, detail });
    const instructionsPath = join(context.repo, "instructions.md");
    const detailPath = join(context.repo, "detail.json");
    writeFileSync(instructionsPath, instructions);
    writeFileSync(detailPath, JSON.stringify(detail));

    run(context, ["oven", "create", "from-package", "--package", "-"], packageInput);
    run(context, ["oven", "create", "from-files", "--instructions", instructionsPath, "--detail", detailPath]);

    const packageDir = resolveOvenPackageDir(join(context.repo, ".local", "burnlist", "ovens", "from-package"));
    const filesDir = resolveOvenPackageDir(join(context.repo, ".local", "burnlist", "ovens", "from-files"));
    const packageInstructions = readFileSync(join(packageDir, "instructions.md"), "utf8");
    const packageDetail = readFileSync(join(packageDir, "detail.json"), "utf8");
    assert.equal(Buffer.byteLength(packageInstructions), 64 * 1024);
    assert.equal(Buffer.byteLength(packageDetail), 69 * 1024);
    assert.ok(Buffer.byteLength(packageInput) > 128 * 1024);
    assert.equal(packageInstructions, readFileSync(join(filesDir, "instructions.md"), "utf8"));
    assert.equal(packageDetail, readFileSync(join(filesDir, "detail.json"), "utf8"));
  } finally { context.cleanup(); }
});

test("--package rejects oversized stored instructions and detail independently", () => {
  const context = fixture();
  try {
    const detail = detailWithStoredBytes(69 * 1024);
    assert.throws(
      () => run(context, ["oven", "create", "large-instructions", "--package", "-"], JSON.stringify({
        instructions: `# ${"\u0800".repeat(21_845)}`, detail,
      })),
      (error) => String(error.stderr).includes("instructions.md") && String(error.stderr).includes("65536 byte limit"),
    );
    const oversizedDetail = detailWithStoredBytes(69 * 1024);
    for (const cell of oversizedDetail.cells) cell.description = "\u0800".repeat(2_000);
    assert.throws(
      () => run(context, ["oven", "create", "large-detail", "--package", "-"], JSON.stringify({
        instructions: "# Valid", detail: oversizedDetail,
      })),
      (error) => String(error.stderr).includes("detail.json") && String(error.stderr).includes("131072 byte limit"),
    );
  } finally { context.cleanup(); }
});
