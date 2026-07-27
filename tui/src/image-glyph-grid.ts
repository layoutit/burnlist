import { buildCellGrid, type CellGrid } from "glyphcss";
import { supersampleImage } from "./image-supersample";
import type { RgbaImage } from "./png-glyph";

const shades = [..."░▒▓█"];

function sample(pixels: Uint8Array, pixelWidth: number, x: number, y: number, channel: number) {
  return pixels[(y * pixelWidth + x) * 4 + channel] ?? 0;
}

/** Browser-safe 2×2 supersampling projection shared with production GlyphImage. */
export function imageGlyphFrame(image: RgbaImage, maxWidth: number, maxHeight: number): CellGrid {
  const sampled = supersampleImage(image, maxWidth, maxHeight);
  const chars: string[] = [], colors: string[] = [];
  for (let row = 0; row < sampled.rows; row += 1) {
    for (let column = 0; column < sampled.cols; column += 1) {
      const channels = [0, 1, 2].map((channel) => {
        let total = 0;
        for (let y = 0; y < 2; y += 1) for (let x = 0; x < 2; x += 1) {
          total += sample(sampled.pixels, sampled.pixelWidth, column * 2 + x, row * 2 + y, channel);
        }
        return Math.round(total / 4);
      });
      const luminance = channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      chars.push(shades[Math.max(0, Math.min(shades.length - 1, Math.floor(luminance / 256 * shades.length)))]!);
      colors.push(`#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`);
    }
  }
  return buildCellGrid(
    chars,
    colors,
    Float64Array.from({ length: sampled.cols * sampled.rows }, () => 0),
    sampled.cols,
    sampled.rows,
  );
}
