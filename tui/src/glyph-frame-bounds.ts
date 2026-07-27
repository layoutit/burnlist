import { TERMINAL_RESOURCE_LIMITS } from "./oven-runtime/resource-limits";

export type GlyphGridSize = Readonly<{ cols: number; rows: number }>;

function whole(value: number, name: string): number {
  if (!Number.isFinite(value) || !Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive whole number.`);
  return value;
}

/** Reject caller-provided grid dimensions before glyphcss allocates a cell buffer. */
export function assertGlyphGridSize(cols: number, rows: number): GlyphGridSize {
  const width = whole(cols, "Glyph grid width");
  const height = whole(rows, "Glyph grid height");
  if (width > Math.floor(TERMINAL_RESOURCE_LIMITS.frameWorkCells / height)) throw new Error("Glyph frame exceeds the terminal cell limit.");
  return { cols: width, rows: height };
}

/** Fit terminal-owned viewport dimensions instead of allocating unbounded glyph buffers. */
export function fitGlyphGridSize(cols: number, rows: number): GlyphGridSize {
  const width = Math.max(1, Number.isFinite(cols) ? Math.floor(cols) : 1);
  const height = Math.max(1, Number.isFinite(rows) ? Math.floor(rows) : 1);
  if (width <= Math.floor(TERMINAL_RESOURCE_LIMITS.frameWorkCells / height)) return { cols: width, rows: height };
  const scale = Math.sqrt(TERMINAL_RESOURCE_LIMITS.frameWorkCells / (width * height));
  const fittedWidth = Math.max(1, Math.floor(width * scale));
  return { cols: fittedWidth, rows: Math.max(1, Math.min(height, Math.floor(TERMINAL_RESOURCE_LIMITS.frameWorkCells / fittedWidth))) };
}

export function assertGlyphPolygonCount(count: number): void {
  if (!Number.isSafeInteger(count) || count < 0 || count > TERMINAL_RESOURCE_LIMITS.polygons) throw new Error("Glyph geometry exceeds the terminal polygon limit.");
}
