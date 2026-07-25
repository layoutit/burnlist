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
}

const transparent = RGBA.fromInts(0, 0, 0, 0);
const fallback = RGBA.fromInts(255, 120, 32, 255);

export class GlyphSurfaceRenderable extends Renderable {
  private currentFrame?: CellGrid;
  private readonly colors = new Map<string, RGBA>();

  constructor(ctx: RenderContext, options: GlyphSurfaceOptions) {
    super(ctx, options);
    this.currentFrame = options.frame;
  }

  set frame(value: CellGrid | undefined) {
    this.currentFrame = value;
    this.requestRender();
  }

  get frame(): CellGrid | undefined {
    return this.currentFrame;
  }

  private color(value: string | null): RGBA {
    if (!value) return fallback;
    const existing = this.colors.get(value);
    if (existing) return existing;
    const parsed = RGBA.fromHex(value);
    this.colors.set(value, parsed);
    return parsed;
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
          transparent,
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
