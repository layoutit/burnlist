import {
  RGBA,
  Renderable,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core";
import { extend } from "@opentui/react";
import type { CellGrid } from "glyphcss";

export interface GlyphSurfaceOptions extends RenderableOptions<GlyphSurfaceRenderable> {
  frame?: CellGrid;
  cellBackground?: string;
  cellBackgroundRegions?: readonly Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
    color: string;
  }>[];
}

const transparent = RGBA.fromInts(0, 0, 0, 0);
const fallback = RGBA.fromInts(255, 120, 32, 255);

export class GlyphSurfaceRenderable extends Renderable {
  private currentFrame?: CellGrid;
  private currentCellBackground?: string;
  private currentCellBackgroundRegions: GlyphSurfaceOptions["cellBackgroundRegions"] = [];
  private readonly colors = new Map<string, RGBA>();

  constructor(ctx: RenderContext, options: GlyphSurfaceOptions) {
    super(ctx, options);
    this.currentFrame = options.frame;
    this.currentCellBackground = options.cellBackground;
    this.currentCellBackgroundRegions = options.cellBackgroundRegions ?? [];
  }

  set frame(value: CellGrid | undefined) {
    this.currentFrame = value;
    this.requestRender();
  }

  get frame(): CellGrid | undefined {
    return this.currentFrame;
  }

  set cellBackground(value: string | undefined) {
    this.currentCellBackground = value;
    this.requestRender();
  }

  get cellBackground(): string | undefined {
    return this.currentCellBackground;
  }

  set cellBackgroundRegions(value: GlyphSurfaceOptions["cellBackgroundRegions"]) {
    this.currentCellBackgroundRegions = value ?? [];
    this.requestRender();
  }

  get cellBackgroundRegions(): GlyphSurfaceOptions["cellBackgroundRegions"] {
    return this.currentCellBackgroundRegions;
  }

  private color(value: string | null): RGBA {
    if (!value) return fallback;
    const existing = this.colors.get(value);
    if (existing) return existing;
    const parsed = RGBA.fromHex(value);
    this.colors.set(value, parsed);
    return parsed;
  }

  private background(col: number, row: number): RGBA {
    const region = this.currentCellBackgroundRegions?.find((entry) => (
      col >= entry.x
      && col < entry.x + entry.width
      && row >= entry.y
      && row < entry.y + entry.height
    ));
    const color = region?.color ?? this.currentCellBackground;
    return !color || color === "transparent" ? transparent : this.color(color);
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const frame = this.currentFrame;
    if (!frame) return;
    const width = Math.min(this.width, frame.cols);
    const height = Math.min(this.height, frame.rows);
    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const index = row * frame.cols + col;
        buffer.setCell(
          this.x + col,
          this.y + row,
          frame.char[index] ?? " ",
          this.color(frame.color[index] ?? null),
          this.background(col, row),
        );
      }
    }
  }
}

declare module "@opentui/react" {
  interface OpenTUIComponents {
    glyphSurface: typeof GlyphSurfaceRenderable;
  }
}

extend({ glyphSurface: GlyphSurfaceRenderable });
