import {
  Renderable,
  type OptimizedBuffer,
  type RenderContext,
  type RenderableOptions,
} from "@opentui/core";
import { extend } from "@opentui/react";
import { ptr } from "bun:ffi";
import type { SupersampledFrame } from "./image-supersample";

export interface SupersampleSurfaceOptions extends RenderableOptions<SupersampleSurfaceRenderable> {
  frame?: SupersampledFrame;
}

export class SupersampleSurfaceRenderable extends Renderable {
  private currentFrame?: SupersampledFrame;

  constructor(ctx: RenderContext, options: SupersampleSurfaceOptions) {
    super(ctx, options);
    this.currentFrame = options.frame;
  }

  set frame(value: SupersampledFrame | undefined) {
    this.currentFrame = value;
    this.requestRender();
  }

  get frame(): SupersampledFrame | undefined {
    return this.currentFrame;
  }

  protected renderSelf(buffer: OptimizedBuffer): void {
    const frame = this.currentFrame;
    if (!frame || !frame.pixels.byteLength || this.width < 1 || this.height < 1) return;
    buffer.pushScissorRect(this.x, this.y, Math.min(this.width, frame.cols), Math.min(this.height, frame.rows));
    try {
      buffer.drawSuperSampleBuffer(
        this.x,
        this.y,
        ptr(frame.pixels),
        frame.pixels.byteLength,
        "rgba8unorm",
        frame.pixelWidth * 4,
      );
    } finally {
      buffer.popScissorRect();
    }
  }
}

declare module "@opentui/react" {
  interface OpenTUIComponents {
    supersampleSurface: typeof SupersampleSurfaceRenderable;
  }
}

extend({ supersampleSurface: SupersampleSurfaceRenderable });
