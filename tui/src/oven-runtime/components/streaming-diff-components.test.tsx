import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error production compiler intentionally remains JavaScript.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { admitTerminalOven } from "../terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { TerminalOvenViewport } from "./terminal-oven-viewport";
import { streamingDiffModel } from "./streaming-diff-components";

const source = readFileSync(new URL("../../../../ovens/streaming-diff/streaming-diff.oven", import.meta.url), "utf8");
const compiled = compileOven(source, { file: "ovens/streaming-diff/streaming-diff.oven" });
if (!compiled.ok) throw new Error(compiled.diagnostics.map((item: { message: string }) => item.message).join("\n"));
const payload = { identity: { session: "run-42" }, cards: [{ toolUseId: "edit-7", revId: "a1b2", ts: "2026-07-24", status: "partial", partialReason: "Capture still running", files: [{ path: "src/app.ts", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" }, { path: "secrets.env", kind: "redacted", diff: "DO NOT SHOW", meta: { reason: "Sensitive content" } }, { path: "logo.png", kind: "binary", diff: "NO", meta: { bytes: 128 } }] }] } as const;

test("official Streaming Diff IR renders bounded cards, metadata, and a footer at wide and narrow sizes", async () => {
  for (const [width, height] of [[78, 20], [34, 16]] as const) {
    const result = admitTerminalOven(compiled.ir, { status: "ready", payload }, { viewport: { width, height }, expandedKeys: ["streaming-diff:first-file"] }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
    expect(result.status).toBe("ready");
    const setup = await createTestRenderer({ width, height, useThread: false }), root = createRoot(setup.renderer);
    flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />)); await setup.renderOnce();
    const frame = setup.captureCharFrame(); expect(frame).toContain("run-42"); expect(frame).toContain("src/app.ts"); expect(frame).toContain("q:back"); expect(frame).not.toContain("esc:exit"); expect(frame).not.toContain("DO NOT SHOW");
    if (!result.state.expandedKeys.length) { expect(frame).toContain("Press Enter"); expect(frame).not.toContain("Diff content is unavailable."); }
    expect(frame.split("\n").every((line) => Array.from(line).length <= width)).toBe(true); root.unmount(); setup.renderer.destroy();
  }
});

test("array-valued diff-card source follows canonical withholding semantics", () => {
  const model = streamingDiffModel(compiled.ir.root[1]!, payload, true);
  expect(model.cards).toHaveLength(1); expect(model.cards[0]!.files).toHaveLength(3);
  expect(model.cards[0]!.files[0]!.diff).toContain("+new");
  expect(model.cards[0]!.files[1]!.diff).toBeUndefined(); expect(model.cards[0]!.files[2]!.diff).toBeUndefined();
  const hostile = { identity: { session: "x" }, cards: [{ toolUseId: "t", revId: "r", files: [{ path: "a", kind: "modified", diff: "SECRET", meta: { redacted: true } }, { path: "b", kind: "renamed", diff: "RENAMED" }, { path: "c", kind: "binary", diff: "BINARY", meta: { redacted: true } }] }] };
  const safe = streamingDiffModel(compiled.ir.root[1]!, hostile as never, true); expect(JSON.stringify(safe)).not.toContain("SECRET"); expect(JSON.stringify(safe)).not.toContain("RENAMED"); expect(JSON.stringify(safe)).not.toContain("BINARY");
});
