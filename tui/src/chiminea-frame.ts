import { createFireFrameRenderer } from "./fire-frame";
import type { CellGrid } from "glyphcss";

const SHELL = [
  "        ╭────╮       ",
  "       ╭╯    ╰╮      ",
  "      ╱        ╲     ",
  "     ╱          ╲    ",
  "    │            │   ",
  "    │  ╭──────╮  │   ",
  "    │  │      │  │   ",
  "    │  │      │  │   ",
  "    │  │      │  │   ",
  "    ╰──┴──────┴──╯   ",
  "      ╱        ╲     ",
  "     ════════════    ",
] as const;

export const CHIMINEA_SHELL_CELLS = Object.freeze(SHELL.flatMap((line, row) =>
  Array.from(line, (glyph, col) => Object.freeze({ row, col, glyph })).filter(({ glyph }) => glyph !== " "),
));

export function createChimineaFrameRenderer(cols = 24, rows = 12) {
  const blank = createFireFrameRenderer(cols, rows);
  const fire = createFireFrameRenderer(6, 3);
  return (time: number, reducedMotion = false): CellGrid => {
    const frame = blank(0);
    for (let index = 0; index < frame.char.length; index += 1) {
      frame.char[index] = " ";
      frame.color[index] = null;
      frame.depth[index] = Number.POSITIVE_INFINITY;
    }
    const left = Math.max(0, Math.floor((cols - SHELL[0].length) / 2));
    for (const { row, col, glyph } of CHIMINEA_SHELL_CELLS) {
      if (row >= rows || left + col >= cols) continue;
      const index = row * cols + left + col;
      frame.char[index] = glyph;
      frame.color[index] = row < 2 ? "#777b82" : row < 10 ? "#a86f45" : "#686b70";
      frame.depth[index] = 0;
    }
    const flame = fire(reducedMotion ? 0 : time);
    for (let row = 0; row < 3; row += 1) for (let col = 0; col < 6; col += 1) {
      const targetCol = left + 7 + col;
      if (6 + row >= rows || targetCol >= cols) continue;
      const target = (6 + row) * cols + targetCol;
      if (frame.char[target] !== " ") continue;
      const source = row * 6 + col;
      frame.char[target] = flame.char[source]!;
      frame.color[target] = flame.color[source]!;
      frame.depth[target] = flame.depth[source]!;
    }
    return frame;
  };
}
