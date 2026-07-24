import { readFileSync } from "node:fs";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { expect, test } from "bun:test";
// @ts-expect-error Production compiler is JavaScript.
import { compileOven } from "../../../../src/ovens/dsl/oven-compile.mjs";
import { modelLabFixture } from "../../catalog/model-lab-fixture";
import { TerminalOvenViewport } from "./terminal-oven-viewport";
import { TERMINAL_IMPLEMENTED_CAPABILITIES } from "./terminal-capabilities";
import { admitTerminalOven } from "../terminal-contract";
import type { JsonValue } from "../terminal-contract";
import { applyVerifiedModelLabFrame, createModelLabClient } from "../../catalog/model-lab-controller";

const compiled = compileOven(readFileSync(new URL("../../../../ovens/model-lab/model-lab.oven", import.meta.url), "utf8"), { file: "ovens/model-lab/model-lab.oven" });
async function capture(payload: JsonValue, width: number, selections = {}) {
  const result = admitTerminalOven(compiled.ir, { status: "ready", payload }, { viewport: { width, height: 18 }, selections }, [], TERMINAL_IMPLEMENTED_CAPABILITIES);
  const setup = await createTestRenderer({ width, height: 18, useThread: false }), root = createRoot(setup.renderer); flushSync(() => root.render(<TerminalOvenViewport result={result} footer="q:back" />)); await setup.renderOnce(); const frame = setup.captureCharFrame(); root.unmount(); setup.renderer.destroy(); return frame;
}
test("Model Lab compiled composition preserves readiness, retained evidence, comparisons, and unavailable/failure states", async () => {
  expect(compiled.ok).toBe(true);
  for (const width of [36, 78]) { const ready = await capture(modelLabFixture.ready, width); expect(ready).toContain("MODEL LAB"); expect(ready).toContain("READY"); expect(ready).toContain("Frame 2/7"); expect(ready).toContain("q:back"); expect(ready.split("\n").every((line) => Array.from(line).length <= width)).toBe(true); }
  expect(await capture(modelLabFixture.unavailable, 78)).toContain("UNAVAILABLE"); expect(await capture(modelLabFixture.failure, 78)).toContain("FAILURE");
});
test("Model Lab selection waits for an idempotent correlated protocol result before refreshing evidence", async () => {
  const sessionId = "a".repeat(32), calls: any[] = [], fetch = async (url: string, init: any = {}) => { calls.push([url, init]); const pending = calls.filter(([path]) => path.endsWith("/commands")).length === 1; return new Response(JSON.stringify(url.includes("/state?") ? { schema: "burnlist-model-lab-terminal@1", status: "ready", sessionId, generation: 1, state: { frame: { index: 4, id: "frame-4", count: 8 } } } : { schema: "burnlist-model-lab-terminal@1", sessionId, requestId: "frame-4", frameIndex: 4, status: pending ? "pending" : "complete", result: pending ? undefined : { ok: true, frameIndex: 4 } }), { status: 200 }); };
  const selected = await createModelLabClient({ endpoint: "http://127.0.0.1:9999/", token: "token", fetch }).select({ sessionId, requestId: "frame-4", frameIndex: 4 }); expect(calls[0][0]).toBe("http://127.0.0.1:9999/api/model-lab-terminal/commands"); expect(calls[0][1].headers["x-burnlist-token"]).toBe("token"); expect(selected.frame?.id).toBe("frame-4"); expect(await capture(applyVerifiedModelLabFrame(modelLabFixture.ready, selected.frame!), 78)).toContain("Frame 4/7 frame-4");
});
