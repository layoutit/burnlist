import { expect, test } from "bun:test";
import { CHIMINEA_SHELL_CELLS, createChimineaFrameRenderer } from "./chiminea-frame";

test("procedural chiminea preserves every shell cell around animated glyphcss fire", () => {
  const render = createChimineaFrameRenderer(24, 12);
  for (const time of [0, 0.24, 1.2]) {
    const frame = render(time);
    const left = 1;
    for (const { row, col, glyph } of CHIMINEA_SHELL_CELLS) {
      expect(frame.char[row * frame.cols + left + col]).toBe(glyph);
    }
    expect(frame.char.slice(6 * frame.cols, 9 * frame.cols).some((glyph) => /[.:;+=xX#%@]/u.test(glyph))).toBe(true);
  }
});

test("reduced-motion chiminea is deterministic", () => {
  const render = createChimineaFrameRenderer(24, 12);
  expect(render(0, true).char).toEqual(render(99, true).char);
  expect(render(0, true).color).toEqual(render(99, true).color);
});
