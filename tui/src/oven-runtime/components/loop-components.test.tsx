import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { admitTerminalOven, type TerminalOvenIR } from "../terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { TerminalOvenViewport } from "./terminal-oven-viewport";
import { compactTopology } from "./loop-components";

const graph = {
  entry: "make",
  nodes: [
    { id: "make", kind: "agent", role: "maker" },
    { id: "verify", kind: "check" },
    { id: "review", kind: "agent", role: "reviewer" },
    { id: "done", kind: "terminal", terminalState: "converged" },
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
    for (const token of [
      "ITEM  H3 · Review the terminal",
      "ACTIVE",
      "Current step: review",
      "ASSIGNED LOOP Review Loop",
      "S ─begin──▶ M ─complete──▶ V ─pass──▶ R ─approve──▶ B",
      "fail",
      "q:back",
    ]) expect(frame).toContain(token);
    expect(frame).not.toContain("First item");
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
});

test("branch Loop rows match the browser's checklist workspace drawing", () => {
  const branchGraph = {
    entry: "plan",
    nodes: [
      { id: "plan", kind: "agent" },
      { id: "branches", kind: "agent" },
      { id: "merge", kind: "agent" },
      { id: "validate", kind: "check" },
      { id: "review", kind: "agent" },
      { id: "converged", kind: "gate" },
      { id: "completed", kind: "terminal", terminalState: "converged" },
      { id: "failed", kind: "terminal", terminalState: "failed" },
    ],
    edges: [
      { from: "plan", on: "complete", to: "branches" },
      { from: "branches", on: "complete", to: "merge" },
      { from: "merge", on: "complete", to: "validate" },
      { from: "validate", on: "pass", to: "review" },
      { from: "validate", on: "fail", to: "branches" },
      { from: "review", on: "approve", to: "converged" },
      { from: "review", on: "reject", to: "plan" },
      { from: "converged", on: "pass", to: "completed" },
    ],
  };
  const layout = compactTopology(
    { currentNode: "completed", graph: branchGraph } as never,
    {} as never,
    90,
  );
  expect(layout?.lines).toEqual([
    "S ─── begin ───▶ P ─ complete ──▶ B ─ complete ──▶ M",
    "                 ▲                ▲                │ complete",
    "                 │                └──── fail ──────┤",
    "                 └─── reject ─────┐                │",
    "                                  │                │",
    "                                  │                │",
    "B ◀── pass ───── G ◀─ approve ─── R ◀── pass ───── V",
  ]);
});
