import type { RgbaImage } from "./png-glyph";

export interface SupersampledFrame {
  cols: number;
  rows: number;
  pixelWidth: number;
  pixelHeight: number;
  pixels: Uint8Array;
}

function fittedCells(image: RgbaImage, maxWidth: number, maxHeight: number): { cols: number; rows: number } {
  const widthLimit = Math.max(1, Math.floor(maxWidth));
  const heightLimit = Math.max(1, Math.floor(maxHeight));
  const cellAspectRatio = 0.5;
  let cols = widthLimit;
  let rows = Math.max(1, Math.round((image.height / image.width) * cols * cellAspectRatio));
  if (rows > heightLimit) {
    rows = heightLimit;
    cols = Math.max(1, Math.min(widthLimit, Math.round((rows / cellAspectRatio) * image.width / image.height)));
  }
  return { cols, rows };
}

function channel(image: RgbaImage, x: number, y: number, offset: number): number {
  const boundedX = Math.max(0, Math.min(image.width - 1, x));
  const boundedY = Math.max(0, Math.min(image.height - 1, y));
  return image.pixels[(boundedY * image.width + boundedX) * 4 + offset]!;
}

function bilinear(image: RgbaImage, x: number, y: number, offset: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const xMix = x - x0;
  const yMix = y - y0;
  const top = channel(image, x0, y0, offset) * (1 - xMix) + channel(image, x0 + 1, y0, offset) * xMix;
  const bottom = channel(image, x0, y0 + 1, offset) * (1 - xMix) + channel(image, x0 + 1, y0 + 1, offset) * xMix;
  return Math.round(top * (1 - yMix) + bottom * yMix);
}

export function supersampleImage(image: RgbaImage, maxWidth: number, maxHeight: number): SupersampledFrame {
  const { cols, rows } = fittedCells(image, maxWidth, maxHeight);
  const pixelWidth = cols * 2;
  const pixelHeight = rows * 2;
  const pixels = new Uint8Array(pixelWidth * pixelHeight * 4);
  const scaleX = image.width / pixelWidth;
  const scaleY = image.height / pixelHeight;
  for (let y = 0; y < pixelHeight; y += 1) {
    const sourceY = (y + 0.5) * scaleY - 0.5;
    for (let x = 0; x < pixelWidth; x += 1) {
      const sourceX = (x + 0.5) * scaleX - 0.5;
      const target = (y * pixelWidth + x) * 4;
      for (let offset = 0; offset < 4; offset += 1) {
        pixels[target + offset] = bilinear(image, sourceX, sourceY, offset);
      }
    }
  }
  return { cols, rows, pixelWidth, pixelHeight, pixels };
}
