import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const repoRoot = resolve(new URL("../..", import.meta.url).pathname);
const binPath = join(repoRoot, "bin", "burnlist.mjs");

function largeOvenSource() {
  return `<oven id="large-oven" version="0.1.0" contract="checklist-progress@1" theme="checklist">
  <!--${"x".repeat(17_000)}-->
  <section-header title="Large Oven"/>
</oven>
`;
}

test("oven list --json drains complete large stdout captured through a pipe", () => {
  const root = mkdtempSync(join(tmpdir(), "burnlist-oven-cli-stdout-"));
  const repo = join(root, "repo");
  const ovensDir = join(repo, ".local", "burnlist", "ovens");
  try {
    mkdirSync(join(ovensDir, "large-oven"), { recursive: true });
    writeFileSync(join(ovensDir, "large-oven", "instructions.md"), "# Large Oven\n\nPipe flush regression fixture.\n");
    const source = largeOvenSource();
    assert.ok(Buffer.byteLength(source) > 16 * 1024, "fixture source must exceed the pipe buffer");
    writeFileSync(join(ovensDir, "large-oven", "large-oven.oven"), source);

    const stdout = execFileSync(process.execPath, [binPath, "oven", "list", "--json", "--ovens-dir", ovensDir], {
      cwd: repo,
      encoding: "utf8",
    });
    assert.ok(Buffer.byteLength(stdout) > 16 * 1024, "fixture output must exceed the pipe buffer");
    const ovens = JSON.parse(stdout);
    const largeOven = ovens.find((oven) => oven.id === "large-oven");
    assert.equal(largeOven.oven, source);
    assert.equal(Object.hasOwn(largeOven, "detail"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
