import { afterEach, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { CatalogApp } from "./catalog-app";
import { createModelLabClient } from "./model-lab-controller";
import { GeneralComponentsSurface } from "./general-components-surface";
import { generalComponentsFixture } from "./general-components-fixture";

const renderers: Array<{ destroy(): void }> = [];
afterEach(() => { while (renderers.length) renderers.pop()?.destroy(); });
async function press(setup: Awaited<ReturnType<typeof createTestRenderer>>, key: string) {
  setup.mockInput.pressKey(key); await new Promise((resolve) => setTimeout(resolve, 8)); await setup.flush();
}
function assertFrameFits(frame: string, width: number) { for (const line of frame.split("\n")) expect(Array.from(line).length).toBeLessThanOrEqual(width); }

test("catalog reaches glyph, structural, progress, and shared list fixtures with safe navigation", async () => {
  const setup = await createTestRenderer({ width: 90, height: 24, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); let exits = 0;
  flushSync(() => root.render(<CatalogApp shutdown={() => { exits += 1; }} />));
  await setup.waitForFrame((frame) => frame.includes("Terminal catalog") && frame.includes("Glyph flame") && frame.includes("Structural layout") && frame.includes("Progress components") && frame.includes("Tables and lists"));
  await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Glyph fixture") && frame.includes("q:back"));
  await press(setup, "v"); await setup.waitForFrame((frame) => frame.includes("narrow"));
  await press(setup, "r"); await setup.waitForFrame((frame) => frame.includes("narrow") && frame.includes("r1"));
  await press(setup, "q"); await setup.waitForFrame((frame) => frame.includes("Terminal catalog"));
  await press(setup, "ARROW_DOWN"); await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Structural layout") && frame.includes("First checkpoint"));
  await press(setup, "q"); await press(setup, "ARROW_DOWN"); await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Burnlist progress") && frame.includes("Progress"));
  await press(setup, "q"); await press(setup, "ARROW_DOWN"); await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Run overview") && frame.includes("q:back"));
  await press(setup, "q"); await press(setup, "ARROW_DOWN"); await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("STATE") && frame.includes("ACTIVE") && frame.includes("↑/↓:row"));
  await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Expanded detail"));
  await press(setup, "ARROW_DOWN"); await setup.waitForFrame((frame) => frame.includes("B6"));
  await press(setup, "q"); await press(setup, "ARROW_DOWN"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("Keyboard controls") && frame.includes("● Fields !1") && frame.includes("Prev") && frame.includes("Next"));
  await press(setup, "v"); await setup.waitForFrame((frame) => frame.includes("wide") && frame.includes("v:view"));
  await press(setup, "q"); await press(setup, "q"); expect(exits).toBe(0);
  setup.mockInput.pressEscape(); await new Promise((resolve) => setTimeout(resolve, 60)); await setup.flush(); expect(exits).toBe(1); root.unmount();
});

test("catalog preview stays bounded in narrow mode and reserves its footer", async () => {
  const setup = await createTestRenderer({ width: 48, height: 18, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  await setup.waitForFrame((frame) => frame.includes("Terminal catalog")); await press(setup, "RETURN"); await press(setup, "v");
  await setup.waitForFrame((frame) => frame.includes("narrow") && frame.includes("q:back"));
  const frame = setup.captureCharFrame(); assertFrameFits(frame, 48); expect(frame.split("\n").at(-2)).toContain("q:back"); root.unmount();
});

test("General Components uses vertical text-native summaries in real 36–42 column frames", async () => {
  for (const width of [36, 42]) for (const checkpoint of generalComponentsFixture.checkpoints) {
    const setup = await createTestRenderer({ width, height: 18, useThread: false }); renderers.push(setup.renderer);
    const root = createRoot(setup.renderer); flushSync(() => root.render(<GeneralComponentsSurface checkpoint={checkpoint} width={width} />)); await setup.flush();
    const frame = setup.captureCharFrame(); assertFrameFits(frame, width);
    expect(frame).toContain("GENERAL COMPONENTS");
    expect(frame.split("\n").filter((line) => line.includes("─")).every((line) => /^[─\s]+$/u.test(line))).toBe(true);
    expect(frame.split("\n").some((line) => /\[$/u.test(line.trimEnd()))).toBe(false);
    root.unmount();
  }
});

test("catalog uses left/right keys to switch the compiled Visual Parity IR domain", async () => {
  const setup = await createTestRenderer({ width: 90, height: 28, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  for (let index = 0; index < 6; index += 1) await press(setup, "ARROW_DOWN");
  await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("F7") && frame.includes("←/→:domain"));
  await press(setup, "ARROW_RIGHT"); await setup.waitForFrame((frame) => frame.includes("F8") && frame.includes("[mobile]"));
  await press(setup, "q"); await setup.waitForFrame((frame) => frame.includes("Terminal catalog")); root.unmount();
});

test("catalog Visual Parity Up/Down advances the admitted selected-frame window", async () => {
  const setup = await createTestRenderer({ width: 90, height: 28, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  for (let index = 0; index < 6; index += 1) await press(setup, "ARROW_DOWN"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("Frame 1/")); await press(setup, "ARROW_DOWN"); await setup.waitForFrame((frame) => frame.includes("Frame 2/")); root.unmount();
});

test("catalog Enter expands the compiled Streaming Diff hunk without leaking redacted content", async () => {
  const setup = await createTestRenderer({ width: 48, height: 18, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  for (let index = 0; index < 7; index += 1) await press(setup, "ARROW_DOWN"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("Session run-42") && frame.includes("enter:expand"));
  expect(setup.captureCharFrame()).not.toContain("+new"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("+new")); const frame = setup.captureCharFrame(); expect(frame).not.toContain("DO NOT SHOW"); assertFrameFits(frame, 48); expect(frame.split("\n").at(-2)).toContain("q:back"); root.unmount();
});

test("catalog dispatches a real Differential field drill-down and q returns only to the catalog", async () => {
  const setup = await createTestRenderer({ width: 82, height: 26, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  for (let index = 0; index < 9; index += 1) await press(setup, "ARROW_DOWN"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("Differential Testing") && frame.includes("←/→:state"));
  await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Tail 0"));
  await press(setup, "ARROW_RIGHT"); await setup.waitForFrame((frame) => frame.includes("empty"));
  await press(setup, "q"); await setup.waitForFrame((frame) => frame.includes("Terminal catalog")); root.unmount();
});

test("catalog pages a 70-field Differential fixture through advertised n/p keys", async () => {
  const setup = await createTestRenderer({ width: 82, height: 26, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  for (let index = 0; index < 9; index += 1) await press(setup, "ARROW_DOWN"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("n/p:page") && frame.includes("Tail 0")); await press(setup, "ARROW_DOWN"); await setup.waitForFrame((frame) => frame.includes("› Tail 1")); await press(setup, "n"); await press(setup, "n"); await setup.waitForFrame((frame) => frame.includes("Tail 69")); root.unmount();
});

test("catalog Performance field preview does not advertise Differential paging", async () => {
  const setup = await createTestRenderer({ width: 82, height: 26, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  for (let index = 0; index < 12; index += 1) await press(setup, "ARROW_DOWN"); await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Performance Tracing") && frame.includes("↑/↓:field") && !frame.includes("n/p:page")); const before = setup.captureCharFrame(); await press(setup, "n"); await press(setup, "p"); const after = setup.captureCharFrame(); expect(after).toContain("Fields"); expect(after).not.toContain("No fields match"); expect(after).toContain(before.includes("Tail") ? "Tail" : "Fields"); root.unmount();
});

test("catalog scrolls the reducer-expanded Checklist detail into its real wide and narrow preview", async () => {
  const setup = await createTestRenderer({ width: 82, height: 26, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  for (let index = 0; index < 10; index += 1) await press(setup, "ARROW_DOWN"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("Checklist") && frame.includes("enter:latest detail")); expect(setup.captureCharFrame()).not.toContain("Outcome:");
  await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Outcome:")); assertFrameFits(setup.captureCharFrame(), 82);
  await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Current") && !frame.includes("Outcome:"));
  await press(setup, "v"); await setup.waitForFrame((frame) => frame.includes("narrow")); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("Outcome:")); const frame = setup.captureCharFrame(); assertFrameFits(frame, 82); expect(frame.split("\n").at(-2)).toContain("q:back"); root.unmount();
});

test("catalog selects a Model Lab retained frame in its real preview", async () => {
  const setup = await createTestRenderer({ width: 82, height: 26, useThread: false }); renderers.push(setup.renderer);
  const sessionId = "a".repeat(32), calls: Array<[string, any]> = [], fetch = async (url: string, init: any = {}) => { calls.push([url, init]); const commandCount = calls.filter(([path]) => path.endsWith("/commands")).length; return new Response(JSON.stringify(url.includes("/state?") ? { schema: "burnlist-model-lab-terminal@1", status: "ready", sessionId, generation: 1, state: { frame: { index: 3, id: "frame-3", count: 8 } } } : { schema: "burnlist-model-lab-terminal@1", sessionId, requestId: "catalog-frame-3", frameIndex: 3, status: commandCount === 1 ? "pending" : "complete", result: commandCount === 1 ? undefined : { ok: true, frameIndex: 3 } }), { status: 200 }); }, client = createModelLabClient({ endpoint: "http://127.0.0.1:9999", token: "controller-token", fetch });
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} modelLabClient={client} />));
  for (let index = 0; index < 11; index += 1) await press(setup, "ARROW_DOWN"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("MODEL LAB") && frame.includes("Frame 2/7")); await press(setup, "ARROW_RIGHT"); await setup.waitForFrame((frame) => frame.includes("Frame 3/7 frame-3")); expect(calls.map(([url]) => url)).toEqual(["http://127.0.0.1:9999/api/model-lab-terminal/commands", "http://127.0.0.1:9999/api/model-lab-terminal/commands", `http://127.0.0.1:9999/api/model-lab-terminal/state?sessionId=${sessionId}`]); expect(calls[0]![1].headers["x-burnlist-token"]).toBe("controller-token"); assertFrameFits(setup.captureCharFrame(), 82); root.unmount();
});
