import { expect, test } from "bun:test";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const output = resolve(root, "dashboard/src/generated/terminal-frames");
const runCheck = async () => {
  const child = Bun.spawn([resolve(root, "tui/node_modules/.bin/bun"), "src/catalog/frame-renderer.tsx", "--check"], { cwd: resolve(root, "tui"), stdout: "pipe", stderr: "pipe" });
  const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  return { code, stderr };
};

test("frame checker rejects extra, stale, missing, and locked evidence", async () => {
  const index = resolve(output, "index.json"), extra = resolve(output, "extra.json"), lock = `${output}.lock`;
  const original = await readFile(index, "utf8");
  const frame = resolve(output, JSON.parse(original).entries[0].path), moved = `${frame}.moved`;
  try {
    await writeFile(extra, "{}\n"); expect((await runCheck()).code).not.toBe(0); await rm(extra);
    await writeFile(index, `${original} `); expect((await runCheck()).code).not.toBe(0); await writeFile(index, original);
    await rename(frame, moved); expect((await runCheck()).code).not.toBe(0); await rename(moved, frame);
    await writeFile(lock, "test"); expect((await runCheck()).code).not.toBe(0); await rm(lock);
    expect((await runCheck()).code).toBe(0);
  } finally { await rm(extra, { force: true }); await rm(lock, { force: true }); try { await rename(moved, frame); } catch {} await writeFile(index, original); }
}, 15_000);
