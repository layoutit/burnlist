import { expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
// @ts-expect-error compiler stays JavaScript.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import fixture from "../../catalog/status-fixture.oven" with { type: "text" };
import emptyFixture from "../../catalog/status-empty-fixture.oven" with { type: "text" };
import { statusFixtureStates } from "../../catalog/status-fixture";
import { admitTerminalOven } from "../terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { TerminalOvenViewport } from "./terminal-oven-viewport";
import { statusActivityText, statusSurfaceModel } from "./status-components";

const compiled = compileOven(fixture, { file: "tui/src/catalog/status-fixture.oven" });
if (!compiled.ok) throw new Error(compiled.diagnostics.map((entry: { message: string }) => entry.message).join("\n"));
const root = compiled.ir.root[0];
const emptyCompiled = compileOven(emptyFixture, { file: "tui/src/catalog/status-empty-fixture.oven" });
if (!emptyCompiled.ok) throw new Error(emptyCompiled.diagnostics.map((entry: { message: string }) => entry.message).join("\n"));

test("compiled status bindings format safely and reserve activity geometry", () => {
  const idle = statusSurfaceModel(root, { count: 12 });
  const running = statusSurfaceModel(compiled.ir.root[1], { refresh: { status: "running" } });
  const failed = statusSurfaceModel(compiled.ir.root[1], { refresh: { status: "failed", error: "Request failed" } });
  expect(idle.title).toBe("Run overview");
  expect(idle.count).toBe("12");
  expect(running.activityText).toBe("Updating");
  expect(failed.activityText).toBe("Update failed · Request failed");
  expect(statusActivityText(idle, 14)).toHaveLength(14);
  expect(statusActivityText(running, 14)).toHaveLength(14);
  expect(statusActivityText({ ...running, activity: "failed", activityText: "Update failed" }, 8)).toBe("! Updat…");
  expect(statusSurfaceModel(compiled.ir.root[2], { note: {}, isTarget: true, rationale: "Exact target." })).toMatchObject({ title: "Qualifying target", note: "Exact target." });
  expect(statusSurfaceModel(emptyCompiled.ir.root[0], {})).toMatchObject({ title: "Run overview", empty: "No Differential Testing scenarios" });
});

test("compiled viewport bounds text and keeps footer clear in normal/loading/error/empty states", async () => {
  for (const [checkpoint, state] of Object.entries(statusFixtureStates)) {
    const payload = state.payload;
    const ir = checkpoint === "empty" ? emptyCompiled.ir : compiled.ir;
    const result = admitTerminalOven(ir, { status: "ready", payload }, { viewport: { width: 20, height: 8 } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
    expect(result.status).toBe("ready");
    const setup = await createTestRenderer({ width: 20, height: 8, useThread: false }), app = createRoot(setup.renderer);
    flushSync(() => app.render(<TerminalOvenViewport result={result} />)); await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    expect(lines.every((line) => Array.from(line).length <= 20)).toBe(true);
    expect(lines.slice(-2).join("\n")).toContain("q:back");
    expect(lines.slice(0, -2).join("\n")).toContain("Run overview");
    if (checkpoint === "error") expect(lines.join("\n")).toContain("Update failed");
    if (checkpoint === "empty") expect(lines.join("\n")).toContain("No Differential");
    app.unmount(); setup.renderer.destroy();
  }
});
