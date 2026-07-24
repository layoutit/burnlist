import { afterEach, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { CatalogApp } from "./catalog-app";

const renderers: Array<{ destroy(): void }> = [];
afterEach(() => { while (renderers.length) renderers.pop()?.destroy(); });
async function press(setup: Awaited<ReturnType<typeof createTestRenderer>>, key: string) {
  setup.mockInput.pressKey(key);
  await new Promise((resolve) => setTimeout(resolve, 8));
  await setup.flush();
}

test("catalog exposes wide, narrow, animated, and reduced-motion chiminea previews", async () => {
  const setup = await createTestRenderer({ width: 82, height: 26, useThread: false });
  renderers.push(setup.renderer);
  const root = createRoot(setup.renderer);
  flushSync(() => root.render(<CatalogApp shutdown={() => {}} />));
  await setup.waitForFrame((frame) => frame.includes("Terminal catalog"));
  for (let index = 0; index < 12; index += 1) await press(setup, "ARROW_DOWN");
  await press(setup, "RETURN");
  await setup.waitForFrame((frame) => frame.includes("Oven fire") && frame.includes("glyphcss flame · animated") && frame.includes("╭────╮"));
  await press(setup, "v");
  await setup.waitForFrame((frame) => frame.includes("narrow") && frame.includes("╭────╮"));
  await press(setup, "ARROW_RIGHT");
  await setup.waitForFrame((frame) => frame.includes("reduced-motion") && frame.includes("glyphcss flame · reduced motion") && frame.includes("════════════"));
  const lines = setup.captureCharFrame().split("\n");
  expect(lines.at(-2)).toContain("q:back");
  expect(lines.slice(0, -2).join("\n")).not.toContain("q:back");
  root.unmount();
});
