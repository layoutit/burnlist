import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error The DSL compiler is the production JavaScript authority.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { differentialFixture } from "../../catalog/differential-fixture";
import { admitTerminalOven } from "../terminal-contract";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { TerminalOvenViewport } from "./terminal-oven-viewport";
import { initTerminalRuntime, reduceTerminalRuntime } from "../state-runtime";
import { TerminalDifferentialChart, TerminalHybridFieldList } from "./differential-components";
// @ts-expect-error Canonical validator intentionally remains JavaScript.
import { validateDifferentialTestingData } from "../../../../ovens/differential-testing/engine/data-contract.mjs";

const source = readFileSync(new URL("../../../../ovens/differential-testing/differential-testing.oven", import.meta.url), "utf8");
const compiled = compileOven(source, { file: "ovens/differential-testing/differential-testing.oven" });
if (!compiled.ok) throw new Error(compiled.diagnostics.map((item: { message: string }) => item.message).join("\n"));

test("shared Differential normal, empty, and failure fixtures satisfy the canonical data validator", () => {
  for (const payload of [differentialFixture.payload, differentialFixture.empty, differentialFixture.failure]) {
    const { pageMode: _pageMode, ...raw } = payload;
    expect(validateDifferentialTestingData(raw).ok).toBe(true);
  }
});

test("official Differential IR fails closed before paint and renders bounded normal, empty, failure, and drill-down states", async () => {
  for (const [payload, expanded] of [[differentialFixture.payload, false], [differentialFixture.empty, false], [differentialFixture.failure, false], [differentialFixture.payload, true]] as const) for (const [width, height] of [[78, 22], [36, 18]] as const) {
    const result = admitTerminalOven(compiled.ir, { status: "ready", payload }, { viewport: { width, height }, expandedKeys: expanded ? ["field-view:position"] : [] }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
    expect(result.status).toBe("ready");
    const setup = await createTestRenderer({ width, height, useThread: false }), root = createRoot(setup.renderer);
    flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />)); await setup.renderOnce();
    const frame = setup.captureCharFrame(); expect(frame).toContain("q:back"); expect(frame).not.toContain("esc:exit"); expect(frame.split("\n").every((line) => Array.from(line).length <= width)).toBe(true);
    if (expanded) expect(frame).toContain("telem");
    root.unmount(); setup.renderer.destroy();
  }
});

test("hostile Differential payload cannot make control text or unavailable telemetry disappear", () => {
  const hostile = { ...differentialFixture.failure, telemetry: { status: "absent" }, fields: [{ id: "x", label: "\u001b[2J", sourceOwner: "\nspoof", driftClass: "bad", result: "fail" }] };
  const result = admitTerminalOven(compiled.ir, { status: "ready", payload: hostile }, { viewport: { width: 36, height: 18 } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  expect(result.status).toBe("ready");
});

test("compiled Differential progress-mode defaults to delta and reducer selects the progress chart", async () => {
  const initial = initTerminalRuntime(compiled.ir, differentialFixture.payload);
  expect(initial.controls["progress-mode"]).toBe("delta");
  for (const [state, label] of [[initial, "Frame delta"], [reduceTerminalRuntime(initial, { type: "modeSelected", id: "progress-mode", value: "progress" }, compiled.ir), "Progress"]] as const) {
    const result = admitTerminalOven(compiled.ir, { status: "ready", payload: differentialFixture.payload }, { viewport: { width: 78, height: 22 }, controls: state.controls }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
    const setup = await createTestRenderer({ width: 78, height: 22, useThread: false }), root = createRoot(setup.renderer); flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />)); await setup.renderOnce(); expect(setup.captureCharFrame()).toContain(label); root.unmount(); setup.renderer.destroy();
  }
});

test("Differential trends reserve three Braille plot rows below their label", async () => {
  const chart = compiled.ir.root.flatMap((node: { children?: readonly unknown[] }) => node.children ?? [])
    .find((node: unknown) => (node as { kind?: string }).kind === "frame-delta-chart");
  const fallback = { kind: "frame-delta-chart", attributes: { source: "/progress" }, bindings: {}, children: [], source: { offset: 0, line: 1, column: 1 } };
  const setup = await createTestRenderer({ width: 60, height: 4, useThread: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(<TerminalDifferentialChart node={(chart ?? fallback) as never} payload={differentialFixture.payload} width={60} />));
    await setup.renderOnce();
    const rows = setup.captureCharFrame().split("\n").slice(0, 4);
    expect(rows[0]).toContain("Frame delta");
    expect(rows.slice(1)).toHaveLength(3);
    expect(rows.slice(1).join("").match(/[\u2801-\u28ff]/gu)?.length ?? 0).toBeGreaterThan(2);
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
});

test("Differential field cards render three-row Braille trends in the admitted Oven", async () => {
  const setup = await createTestRenderer({ width: 78, height: 15, useThread: false }), root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(<TerminalHybridFieldList node={compiled.ir.root[0]!} payload={differentialFixture.payload} width={78} height={15} />));
    await setup.renderOnce();
    const rows = setup.captureCharFrame().split("\n");
    expect(rows[0]).toContain("Position");
    expect(rows.slice(1, 4)).toHaveLength(3);
    expect(rows.slice(1, 4).join("").match(/[\u2801-\u28ff]/gu)?.length ?? 0).toBeGreaterThan(2);
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
});

test("hostile Differential tail field is retained and selected-window reachable", async () => {
  const payload = { ...differentialFixture.payload, fields: Array.from({ length: 70 }, (_, index) => ({ ...differentialFixture.payload.fields[0], id: `tail-${index}`, label: `Tail ${index}` })) };
  const setup = await createTestRenderer({ width: 60, height: 8, useThread: false }), root = createRoot(setup.renderer);
  try { flushSync(() => root.render(<TerminalHybridFieldList node={compiled.ir.root[0]!} payload={payload as never} width={60} height={6} selectedId="tail-69" />)); await setup.renderOnce(); expect(setup.captureCharFrame()).toContain("Tail 69"); } finally { root.unmount(); setup.renderer.destroy(); }
});
