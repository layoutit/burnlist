import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error Production DSL remains JavaScript by design.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { admitTerminalOven, type JsonValue, type TerminalOvenIR } from "../terminal-contract";
import { initTerminalRuntime, reduceTerminalRuntime } from "../state-runtime";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { TerminalOvenViewport } from "./terminal-oven-viewport";
import { visualParityFixture } from "../../catalog/visual-parity-fixture";
import { visualParityPng } from "../../catalog/visual-parity-fixture";
import { decodePngDataUri } from "../../png-glyph";
import { prepareTerminalComponentResult } from "./terminal-oven-viewport";

const payload = visualParityFixture.payload;

function compiled(): TerminalOvenIR {
  const source = readFileSync(new URL("../../../../ovens/visual-parity/visual-parity.oven", import.meta.url), "utf8"), result = compileOven(source, { file: "ovens/visual-parity/visual-parity.oven" });
  if (!result.ok) throw new Error(result.diagnostics.map((item: { message: string }) => item.message).join("\n"));
  return result.ir as TerminalOvenIR;
}
async function frame(width: number, height: number, domain = "desktop") {
  const ir = compiled(), initial = initTerminalRuntime(ir, payload), state = domain === "desktop" ? initial : reduceTerminalRuntime(initial, { type: "domainSelected", id: "domain-select", value: domain }, ir);
  const result = admitTerminalOven(ir, { status: "ready", payload }, { viewport: { width, height }, controls: state.controls }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  expect(result.status).toBe("ready");
  const setup = await createTestRenderer({ width, height, useThread: false }), root = createRoot(setup.renderer);
  try { flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />)); await setup.flush(); return setup.captureCharFrame(); } finally { root.unmount(); setup.renderer.destroy(); }
}

test("official Visual Parity IR renders readable wide and narrow real OpenTUI media frames", async () => {
  for (const [width, height] of [[90, 24], [42, 24]] as const) {
    const output = await frame(width, height);
    for (const label of ["desktop", "mobile", "Frames", "Current", "Reference", "Difference", "Frame 7", "q:back"]) expect(output).toContain(label);
    expect(output).not.toContain("esc:exit");
    expect(output.split("\n").every((line) => Array.from(line).length <= width)).toBe(true);
  }
});

test("the terminal domain keyboard action selects the next IR-bound media scope", async () => {
  const output = await frame(72, 22, "mobile");
  expect(output).toContain("[mobile]"); expect(output).toContain("Frame 8"); expect(output).toContain("Mobile remains diagnostic.");
});

test("triptych fixture has distinct image pixels and preflight fails closed before paint", () => {
  expect(new Set(Object.values(visualParityPng)).size).toBe(3);
  expect(new Set(Object.values(visualParityPng).map((source) => Array.from(decodePngDataUri(source).pixels).join(","))).size).toBe(3);
  const ir = compiled(), { framesCount: _framesCount, ...verdict } = payload.verdict, admitted = admitTerminalOven(ir, { status: "ready", payload: { ...payload, verdict } as unknown as JsonValue }, { viewport: { width: 72, height: 22 } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  const prepared = prepareTerminalComponentResult(admitted); expect(prepared.status).toBe("error"); expect(prepared.diagnostics.at(-1)?.code).toBe("RENDER_BINDING");
});

test("corrupt required triptych PNG fails closed before React paint", () => {
  const broken = JSON.parse(JSON.stringify(payload)); broken.byDomain.desktop.frames[0].images[2].src = "data:image/png;base64,AA==";
  const admitted = admitTerminalOven(compiled(), { status: "ready", payload: broken }, { viewport: { width: 72, height: 22 } }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  const prepared = prepareTerminalComponentResult(admitted); expect(prepared.status).toBe("error"); expect(prepared.diagnostics.at(-1)?.message).toContain("PNG signature");
});
