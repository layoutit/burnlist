import { describe, expect, test } from "bun:test";
import { createFireFrameRenderer } from "./fire-frame";

describe("glyphcss fire frame", () => {
  test("is deterministic at a point in time and animated across time", () => {
    const render = createFireFrameRenderer(20, 12);
    const first = render(0.25);
    const repeat = render(0.25);
    const later = render(1.25);
    expect(first.char.join("")).toBe(repeat.char.join(""));
    expect(first.char.some((glyph) => glyph !== " ")).toBe(true);
    expect(later.char.join("")).not.toBe(first.char.join(""));
    expect(later.color.some((color) => color?.startsWith("#"))).toBe(true);
  });

  test("keeps a readable flame silhouette while its glyph energy animates", () => {
    const frame = createFireFrameRenderer(12, 7)(0.4);
    const rows = Array.from({ length: 7 }, (_, row) => frame.char.slice(row * 12, (row + 1) * 12));
    const occupied = rows.map((row) => row.filter((glyph) => glyph !== " ").length);
    expect(occupied.at(-1)).toBeGreaterThan(occupied[0]!);
    expect(occupied.reduce((total, count) => total + count, 0)).toBeGreaterThan(35);
  });
});
