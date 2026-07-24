import { afterEach, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { CatalogApp } from "./catalog-app";

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

test("catalog uses left/right keys to switch the compiled Visual Parity IR domain", async () => {
  const setup = await createTestRenderer({ width: 90, height: 28, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  for (let index = 0; index < 6; index += 1) await press(setup, "ARROW_DOWN");
  await press(setup, "RETURN"); await setup.waitForFrame((frame) => frame.includes("Frame 7") && frame.includes("←/→:domain"));
  await press(setup, "ARROW_RIGHT"); await setup.waitForFrame((frame) => frame.includes("Frame 8") && frame.includes("[mobile]"));
  await press(setup, "q"); await setup.waitForFrame((frame) => frame.includes("Terminal catalog")); root.unmount();
});

test("catalog Enter expands the compiled Streaming Diff hunk without leaking redacted content", async () => {
  const setup = await createTestRenderer({ width: 48, height: 18, useThread: false }); renderers.push(setup.renderer);
  const root = createRoot(setup.renderer); flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  for (let index = 0; index < 7; index += 1) await press(setup, "ARROW_DOWN"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("Session run-42") && frame.includes("enter:expand"));
  expect(setup.captureCharFrame()).not.toContain("+new"); await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("+new")); const frame = setup.captureCharFrame(); expect(frame).not.toContain("DO NOT SHOW"); assertFrameFits(frame, 48); expect(frame.split("\n").at(-2)).toContain("q:back"); root.unmount();
});
