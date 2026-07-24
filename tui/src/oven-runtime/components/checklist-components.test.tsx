import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error Production compiler is JavaScript.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { checklistFixture } from "../../catalog/checklist-fixture";
import { TerminalOvenViewport } from "./terminal-oven-viewport";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { admitTerminalOven } from "../terminal-contract";
import { initTerminalRuntime, reduceTerminalRuntime } from "../state-runtime";

const compiled = compileOven(readFileSync(new URL("../../../../ovens/checklist/checklist.oven", import.meta.url), "utf8"), { file: "ovens/checklist/checklist.oven" });
test("compiled Checklist uses generic composite roots at wide and narrow active, completed, and long-list states", async () => {
  expect(compiled.ok).toBe(true);
  for (const payload of [checklistFixture.active, checklistFixture.completed, checklistFixture.longList]) for (const [width, height] of [[78, 22], [36, 18]] as const) {
    const result = admitTerminalOven(compiled.ir, { status: "ready", payload }, { viewport: { width, height }, expandedKeys: [] }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
    expect(result.status).toBe("ready"); const setup = await createTestRenderer({ width, height, useThread: false }), root = createRoot(setup.renderer); flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />)); await setup.renderOnce(); const frame = setup.captureCharFrame();
    expect(frame).toContain("q:back"); expect(frame).not.toContain("esc:exit"); expect(frame.split("\n").slice(0, -2).every((line) => !line.includes("q:back"))).toBe(true); expect(frame.split("\n").every((line) => Array.from(line).length <= width)).toBe(true); root.unmount(); setup.renderer.destroy();
  }
});
test("Checklist detail is reachable through the generic expanded-key reducer", async () => {
  const initial = initTerminalRuntime(compiled.ir, checklistFixture.active);
  const expanded = reduceTerminalRuntime(initial, { type: "toggleExpanded", key: "checklist-event-cards:latest" }, compiled.ir);
  expect(initial.expandedKeys).toEqual([]); expect(expanded.expandedKeys).toEqual(["checklist-event-cards:latest"]);
  const capture = async (expandedKeys: readonly string[]) => {
    const setup = await createTestRenderer({ width: 78, height: 34, useThread: false }), root = createRoot(setup.renderer);
    const result = admitTerminalOven(compiled.ir, { status: "ready", payload: checklistFixture.active }, { viewport: { width: 78, height: 34 }, expandedKeys }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
    flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />)); await setup.renderOnce(); const frame = setup.captureCharFrame(); root.unmount(); setup.renderer.destroy(); return frame;
  };
  expect(await capture(initial.expandedKeys)).not.toContain("Outcome:");
  expect(await capture(expanded.expandedKeys)).toContain("Outcome:");
  const collapsed = reduceTerminalRuntime(expanded, { type: "toggleExpanded", key: "checklist-event-cards:latest" }, compiled.ir);
  expect(collapsed.expandedKeys).toEqual([]); expect(await capture(collapsed.expandedKeys)).not.toContain("Outcome:");
});
