import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "bun:test";
import { glyphFixture } from "./glyph-fixture";
import { cellModels, packedRgba, selectFrameEntry, type FrameEntry, type StaticFrame } from "../../../dashboard/src/components/TerminalFrame/terminal-frame-model";

const root = resolve(import.meta.dir, "../../..");
const generated = resolve(root, "dashboard/src/generated/terminal-frames");
const digest = (text: string) => createHash("sha256").update(text).digest("hex");

test("Storybook consumes every indexed content-addressed frame without changing cells", async () => {
  const index = JSON.parse(await readFile(resolve(generated, "index.json"), "utf8"));
  const entries = index.entries as FrameEntry[];
  const expected = glyphFixture.states.flatMap((state) => state.viewports.map((viewport) => `${viewport}:${state.checkpoint}`)).sort();
  expect(entries.map((entry) => `${entry.viewport.width}:${entry.checkpoint}`).sort()).toEqual(expected);
  for (const entry of entries) {
    const source = await readFile(resolve(generated, entry.path), "utf8");
    const frame = JSON.parse(source) as StaticFrame;
    expect(digest(source)).toBe(entry.sha256);
    expect(entry.path).toContain(entry.sha256.slice(0, 16));
    expect(cellModels(frame)).toEqual(frame.cells.map((cell, offset) => ({ ...cell, x: offset % frame.viewport.width, y: Math.floor(offset / frame.viewport.width) })));
    expect(frame.semanticText.join("\n")).toContain(glyphFixture.title);
  }
  expect(packedRgba(0xffe8eef1)).toBe("rgba(241, 238, 232, 1)");
});

test("shared fixture defines all independent Storybook control checkpoints", async () => {
  const index = JSON.parse(await readFile(resolve(generated, "index.json"), "utf8"));
  const entries = index.entries as FrameEntry[];
  for (const state of glyphFixture.states) for (const viewport of state.viewports) expect(selectFrameEntry(entries, { viewport, interaction: state.interaction, animation: state.animation, motion: state.motion })?.checkpoint).toBe(state.checkpoint);
  expect(selectFrameEntry(entries, { viewport: 64, interaction: "right", animation: "t240", motion: "reduced" })).toBeUndefined();
  const renderer = await readFile(resolve(root, "tui/src/catalog/frame-renderer.tsx"), "utf8");
  const viewer = await readFile(resolve(root, "dashboard/src/components/TerminalFrame/TerminalFrame.tsx"), "utf8");
  expect(renderer).toContain('from "./glyph-fixture"');
  expect(viewer).toContain('tui/src/catalog/glyph-fixture');
  expect(viewer).not.toMatch(/opentui|xterm|WebSocket|\\bpty\\b/iu);
});
