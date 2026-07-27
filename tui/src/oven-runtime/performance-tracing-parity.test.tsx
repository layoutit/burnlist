import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error Production compiler is JavaScript.
import { compileOven } from "../../../src/ovens/dsl/oven-compile.mjs";
// @ts-expect-error Canonical validator is JavaScript.
import { assertPerformanceTracingData } from "../../../ovens/performance-tracing/contract.mjs";
import { performanceTracingFixture, sourceText } from "../catalog/performance-tracing-fixture";
import { adaptPerformanceTracingEnvelope } from "../../../dashboard/src/lib/performance-tracing-adapter";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./components/terminal-capabilities";
import { TerminalOvenViewport } from "./components/terminal-oven-viewport";
import { admitTerminalOven } from "./terminal-contract";

const source = readFileSync(new URL("../../../ovens/performance-tracing/performance-tracing.oven", import.meta.url), "utf8"), compiled = compileOven(source, { file: "ovens/performance-tracing/performance-tracing.oven" });
if (!compiled.ok) throw new Error("Performance Tracing fixture must compile");
test("Performance Tracing uses canonical reports through the generic Differential adapter and renderer", async () => {
  for (const report of Object.values(performanceTracingFixture.reports)) { expect(assertPerformanceTracingData(report)).toBe(report); expect(String(report.provenance.files["source.mjs"].sha256)).toBe(createHash("sha256").update(sourceText).digest("hex")); expect(Number(report.provenance.files["source.mjs"].bytes)).toBe(Buffer.byteLength(sourceText)); }
  expect(() => assertPerformanceTracingData({ ...performanceTracingFixture.reports.normal, status: "fail" })).toThrow();
  expect(() => adaptPerformanceTracingEnvelope({ payload: {} })).toThrow();
  expect(performanceTracingFixture.payload).toEqual(adaptPerformanceTracingEnvelope({ payload: performanceTracingFixture.reports.normal }));
  expect(performanceTracingFixture.failedBudget).toEqual(adaptPerformanceTracingEnvelope({ payload: performanceTracingFixture.reports.failedBudget }));
  for (const [checkpoint, payload, expected] of [["normal", performanceTracingFixture.payload, "frame.p95"], ["failed-budget", performanceTracingFixture.failedBudget, "frame.p95"], ["empty", performanceTracingFixture.empty, "No Performance Tracing scenarios"]] as const) for (const [width, height] of [[78, 22], [36, 18]] as const) {
    const result = admitTerminalOven(compiled.ir, { status: "ready", payload }, { viewport: { width, height } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
    expect(result.status).toBe("ready"); const setup = await createTestRenderer({ width, height, useThread: false }), root = createRoot(setup.renderer);
    flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />)); await setup.renderOnce(); const frame = setup.captureCharFrame();
    expect(frame).toContain(expected); expect(frame).toContain("q:back"); expect(frame).not.toContain("esc:exit"); expect(frame.split("\n").every((line) => Array.from(line).length <= width)).toBe(true);
    if (checkpoint === "failed-budget") expect(frame).toContain("frame.p95"); root.unmount(); setup.renderer.destroy();
  }
});
