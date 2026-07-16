import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function largeDetail() {
  return {
    version: 1,
    columns: 2,
    rows: 5,
    rowHeight: 48,
    cells: Array.from({ length: 10 }, (_, index) => ({
      id: `cell-${index + 1}`,
      title: `Cell ${index + 1}`,
      description: "x".repeat(2_000),
      widget: "metric",
      source: `/cell-${index + 1}`,
      format: "plain",
      column: (index % 2) + 1,
      row: Math.floor(index / 2) + 1,
      columnSpan: 1,
      rowSpan: 1,
    })),
  };
}

test("oven list --json drains complete large stdout captured through a pipe", () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-cli-stdout-"));
  const repo = join(root, "repo");
  const ovensDir = join(repo, ".local", "burnlist", "ovens");
  try {
    mkdirSync(join(ovensDir, "large-oven"), { recursive: true });
    writeFileSync(join(ovensDir, "large-oven", "instructions.md"), "# Large Oven\n\nPipe flush regression fixture.\n");
    writeFileSync(join(ovensDir, "large-oven", "detail.json"), JSON.stringify(largeDetail()));

    const stdout = execFileSync(process.execPath, [binPath, "oven", "list", "--json", "--ovens-dir", ovensDir], {
      cwd: repo,
      encoding: "utf8",
    });
    assert.ok(Buffer.byteLength(stdout) > 16 * 1024, "fixture output must exceed the pipe buffer");
    const ovens = JSON.parse(stdout);
    const largeOven = ovens.find((oven) => oven.id === "large-oven");
    assert.equal(largeOven.detail.cells.length, 10);
    assert.equal(largeOven.detail.cells[9].description.length, 2_000);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
