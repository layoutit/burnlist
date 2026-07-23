import { expect, test } from "bun:test";
import { buildFrames, cellsFromFrame } from "./frame-renderer";

test("the glyphcss fixture produces deterministic raw OpenTUI frame evidence", async () => {
  const first = await buildFrames(), second = await buildFrames();
  expect(first).toEqual(second);
  const pick = (checkpoint: string) => JSON.parse(Object.entries(first).find(([, text]) => JSON.parse(text).checkpoint === checkpoint)?.[1] || "null");
  const initial = pick("t0"), animated = pick("t240"), keyboard = pick("keyboard-right"), reduced = pick("reduced-t0"), reducedLater = pick("reduced-t240");
  expect(initial.cells).toHaveLength(42 * 12);
  expect(initial.semanticText.join("\n")).toContain("é 界");
  const combining = initial.cells.findIndex((cell: { char: string }) => cell.char === "é");
  const wide = initial.cells.findIndex((cell: { char: string }) => cell.char === "界");
  expect(combining).toBeGreaterThanOrEqual(0);
  expect(initial.cells[wide + 1]).toMatchObject({ char: "", continuation: true });
  expect(initial.cells.some((cell: { fg: number; bg: number; attributes: number }) => cell.fg || cell.bg || cell.attributes)).toBe(true);
  expect(keyboard.semanticText.join("\n")).toContain("Selected · ember");
  expect(reduced.semanticText.join("\n")).toContain("motion: reduced");
  expect(animated.cells).not.toEqual(initial.cells);
  expect(reducedLater.cells).toEqual(reduced.cells);
});

test("raw buffer coordinates preserve full attributes and continuation flags", () => {
  const cells = cellsFromFrame("界\n", 2, 1, {
    char: new Uint32Array([1, 0xc0000000]),
    fg: new Uint16Array([1, 2, 3, 4, 5, 6, 7, 8]),
    bg: new Uint16Array(8),
    attributes: new Uint32Array([0x12345678, 0xfedcba98]),
  });
  expect(cells).toEqual([
    { char: "界", fg: 0x04030201, bg: 0, attributes: 0x12345678, continuation: false },
    { char: "", fg: 0x08070605, bg: 0, attributes: 0xfedcba98, continuation: true },
  ]);
});
