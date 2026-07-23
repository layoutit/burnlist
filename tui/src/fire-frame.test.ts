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
});
