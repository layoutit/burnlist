import { glyphFixture } from "../../../../tui/src/catalog/glyph-fixture";

export type FrameEntry = Readonly<{ id: string; path: string; sha256: string; checkpoint: string; viewport: Readonly<{ width: number; height: number }> }>;
export type FrameCell = Readonly<{ char: string; fg: number; bg: number; attributes: number; continuation: boolean }>;
export type StaticFrame = Readonly<{ semanticText: readonly string[]; cells: readonly FrameCell[]; viewport: Readonly<{ width: number; height: number }> }>;
export type FrameControls = Readonly<{ viewport: number; interaction: string; animation: string; motion: string }>;

export const frameState = (checkpoint: string) => glyphFixture.states.find((state) => state.checkpoint === checkpoint);

export function selectFrameEntry(entries: readonly FrameEntry[], controls: FrameControls) {
  return entries.find((entry) => {
    const state = frameState(entry.checkpoint);
    return entry.viewport.width === controls.viewport && state?.interaction === controls.interaction && state.animation === controls.animation && state.motion === controls.motion;
  });
}

export function cellModels(frame: StaticFrame) {
  if (frame.cells.length !== frame.viewport.width * frame.viewport.height) throw new Error("Terminal frame cell count disagrees with viewport");
  return frame.cells.map((cell, offset) => ({ ...cell, x: offset % frame.viewport.width, y: Math.floor(offset / frame.viewport.width) }));
}

export function packedRgba(value: number) {
  const unsigned = value >>> 0;
  return `rgba(${unsigned & 255}, ${(unsigned >>> 8) & 255}, ${(unsigned >>> 16) & 255}, ${((unsigned >>> 24) & 255) / 255})`;
}

export function textStyle(attributes: number) {
  const base = attributes & 255;
  return {
    fontWeight: base & 1 ? 700 : undefined,
    opacity: base & 2 ? 0.65 : undefined,
    fontStyle: base & 4 ? "italic" : undefined,
    textDecoration: [base & 8 ? "underline" : "", base & 128 ? "line-through" : ""].filter(Boolean).join(" ") || undefined,
    visibility: base & 64 ? "hidden" : undefined,
  } as const;
}
