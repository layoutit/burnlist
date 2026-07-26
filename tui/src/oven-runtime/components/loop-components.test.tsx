import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { admitTerminalOven, type TerminalOvenIR } from "../terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { TerminalOvenViewport } from "./terminal-oven-viewport";

const graph = {
  entry: "make",
  nodes: [
    { id: "make", kind: "agent", role: "maker" },
    { id: "verify", kind: "check" },
    { id: "review", kind: "agent", role: "reviewer" },
    { id: "done", kind: "terminal" },
  ],
  edges: [
    { from: "make", on: "complete", to: "verify" },
    { from: "verify", on: "pass", to: "review" },
    { from: "verify", on: "fail", to: "make" },
    { from: "review", on: "approve", to: "done" },
  ],
} as const;

function compiled(): TerminalOvenIR {
  const source = readFileSync(new URL("../../../../ovens/loop-progress/loop-progress.oven", import.meta.url), "utf8");
  const result = compileOven(source, { file: "ovens/loop-progress/loop-progress.oven" });
  if (!result.ok) throw new Error(result.diagnostics.map((item: { message: string }) => item.message).join("\n"));
  return result.ir as TerminalOvenIR;
}

test("Loop Progress renders the same compact item topology as the web Loop progress", async () => {
  const payload = { raw: {
    selectedItemId: "H3",
    active: [
      { id: "O0", title: "First item", fields: {}, loop: null },
      { id: "H3", title: "Review the terminal", fields: {}, loop: { selector: "loop:builtin:review", graph: structuredClone(graph) } },
    ],
    loopRun: { loopId: "loop:builtin:review", state: "ACTIVE", currentNode: "review", graph, latestResult: null },
  } };
  const ir = compiled();
  const result = admitTerminalOven(ir, { status: "ready", payload }, { viewport: { width: 90, height: 24 } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  const setup = await createTestRenderer({ width: 90, height: 24, useThread: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />));
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    for (const token of ["ITEM  H3 · Review the terminal", "ACTIVE", "Current step: review", "ASSIGNED LOOP Review Loop", "S ──▶ M ──▶ V ──▶ R", "q:back"]) expect(frame).toContain(token);
    expect(frame).not.toContain("First item");
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
});
