import { expect, test } from "bun:test";
import { terminalPayload } from "./terminal-payload";
import { visualParityFixture } from "../catalog/visual-parity-fixture";

test("Visual Parity terminal payload drops unbound scene tiles but retains every image", () => {
  const payload = {
    schema: "burnlist-visual-parity-data@1",
    byDomain: { scene: { frames: [{ frame: 0, tiles: [{ glyph: "x" }], images: [
      { label: "Visible", src: "data:image/png;base64,a" },
      { label: "Depth", src: "data:image/png;base64,b" },
      { label: "Base", src: "data:image/png;base64,c" },
      { label: "Mask", src: "data:image/png;base64,d" },
      { label: "Output", src: "data:image/png;base64,e" },
    ] }] } },
  } as const;
  const adapted = terminalPayload("burnlist-visual-parity-data@1", payload);
  const frame = (adapted as any).byDomain.scene.frames[0];
  expect(frame.tiles).toBeUndefined();
  expect(frame.images).toHaveLength(5);
});

test("non-media contracts retain payload identity", () => {
  const payload = { rows: [{ tiles: [1] }] } as const;
  expect(terminalPayload("checklist-progress@1", payload)).toBe(payload);
});

test("Visual Parity raw server payload uses the console adapter before terminal admission", () => {
  const adapted = terminalPayload("burnlist-visual-parity-data@1", visualParityFixture.raw as never) as any;
  expect(adapted.verdict).toEqual({ targetPass: true, framesCount: 3, error: "" });
  expect(adapted.byDomain.desktop.frames[0].images).toHaveLength(3);
});
