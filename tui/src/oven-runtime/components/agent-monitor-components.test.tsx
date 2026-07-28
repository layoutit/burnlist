import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error Production compiler is JavaScript.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { admitTerminalOven } from "../terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { TerminalOvenViewport } from "./terminal-oven-viewport";

const compiled = compileOven(
  readFileSync(new URL("../../../../ovens/agent-monitor/agent-monitor.oven", import.meta.url), "utf8"),
  { file: "ovens/agent-monitor/agent-monitor.oven" },
);
const payload = {
  monitor: {
    summary: { drift: "On course", driftDetail: "No repeated action detected.", driftLevel: "clear", display: "Live" },
    counts: { commands: 1, diffs: 1, failures: 0 },
  },
  current: { title: "Current", value: "Inspecting" },
  raw: {
    completed: [
      { key: "command", category: "command", result: "complete", line: 10, title: "build dashboard", completedAt: "2026-07-27T10:00:00.000Z" },
      { key: "diff", category: "diff", result: "complete", line: 11, title: "update oven", completedAt: "2026-07-27T10:01:00.000Z" },
    ],
  },
};

async function capture(filter: string) {
  const result = admitTerminalOven(
    compiled.ir,
    { status: "ready", payload },
    { viewport: { width: 78, height: 28 }, controls: { "agent-monitor-event-filter": filter } },
    [],
    TERMINAL_IMPLEMENTED_CAPABILITIES,
  );
  expect(result.status, JSON.stringify(result.diagnostics)).toBe("ready");
  const setup = await createTestRenderer({ width: 78, height: 28, useThread: false });
  const root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />));
    await setup.renderOnce();
    return setup.captureCharFrame();
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
}

test("official Agent Monitor uses terminal alert, activity, filter, and event table counterparts", async () => {
  expect(compiled.ok).toBe(true);
  const frame = await capture("command");
  expect(frame).toContain("✓ On course");
  expect(frame).toContain("Work rhythm");
  expect(frame).toContain("STATE");
  expect(frame).toContain("TYPE");
  expect(frame).toContain("DONE");
  expect(frame).toContain("COMMAND");
  expect(frame).not.toContain("DIFF");
  expect(frame).toContain("q:back");
});
