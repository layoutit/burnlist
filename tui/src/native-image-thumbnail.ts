import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { decodePngDataUri, type RgbaImage } from "./png-glyph";

const cache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 96;
const PIXELS_PER_CELL_X = 4;
const PIXELS_PER_CELL_Y = 8;

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(data: Uint8Array) {
  let value = 0xffffffff;
  for (const byte of data) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function chunk(name: string, data: Uint8Array) {
  const type = Buffer.from(name), output = Buffer.alloc(12 + data.length);
  output.writeUInt32BE(data.length, 0);
  type.copy(output, 4);
  Buffer.from(data).copy(output, 8);
  output.writeUInt32BE(crc32(output.subarray(4, 8 + data.length)), 8 + data.length);
  return output;
}

function encode(image: RgbaImage) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8;
  header[9] = 6;
  const stride = image.width * 4, scanlines = Buffer.alloc(image.height * (stride + 1));
  for (let row = 0; row < image.height; row += 1) {
    Buffer.from(image.pixels.subarray(row * stride, (row + 1) * stride)).copy(scanlines, row * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 4 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

function resize(image: RgbaImage, width: number, height: number): RgbaImage {
  if (image.width <= width && image.height <= height) return image;
  const scale = Math.min(width / image.width, height / image.height);
  const targetWidth = Math.max(1, Math.round(image.width * scale));
  const targetHeight = Math.max(1, Math.round(image.height * scale));
  const pixels = new Uint8Array(targetWidth * targetHeight * 4);
  for (let y = 0; y < targetHeight; y += 1) {
    const sourceY = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / targetHeight));
    for (let x = 0; x < targetWidth; x += 1) {
      const sourceX = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / targetWidth));
      const source = (sourceY * image.width + sourceX) * 4, target = (y * targetWidth + x) * 4;
      pixels[target] = image.pixels[source]!;
      pixels[target + 1] = image.pixels[source + 1]!;
      pixels[target + 2] = image.pixels[source + 2]!;
      pixels[target + 3] = image.pixels[source + 3]!;
    }
  }
  return { width: targetWidth, height: targetHeight, pixels };
}

/**
 * Shrinks an admitted PNG to the physical detail a terminal rectangle can show.
 * The bounded cache retains thumbnails, never the multi-megabyte source string.
 */
export function nativeImageThumbnail(source: string, columns: number, rows: number): string {
  const width = Math.max(1, Math.floor(columns)) * PIXELS_PER_CELL_X;
  const height = Math.max(1, Math.floor(rows)) * PIXELS_PER_CELL_Y;
  const digest = createHash("sha256").update(source).digest("base64url");
  const key = `${digest}:${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const thumbnail = resize(decodePngDataUri(source), width, height);
  const result = `data:image/png;base64,${encode(thumbnail).toString("base64")}`;
  cache.set(key, result);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return result;
}
