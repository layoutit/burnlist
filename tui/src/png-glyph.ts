import { inflateSync } from "node:zlib";

export interface RgbaImage {
  width: number;
  height: number;
  pixels: Uint8Array;
}

const signature = [137, 80, 78, 71, 13, 10, 26, 10];

function readU32(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>> 0;
}

function paeth(left: number, above: number, upperLeft: number): number {
  const estimate = left + above - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const aboveDistance = Math.abs(estimate - above);
  const diagonalDistance = Math.abs(estimate - upperLeft);
  return leftDistance <= aboveDistance && leftDistance <= diagonalDistance ? left : aboveDistance <= diagonalDistance ? above : upperLeft;
}

function unfilter(raw: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  if (raw.length !== (stride + 1) * height) throw new Error("PNG scanline length is inconsistent.");
  const output = new Uint8Array(stride * height);
  let inputOffset = 0;
  for (let row = 0; row < height; row += 1) {
    const filter = raw[inputOffset++]!;
    if (filter > 4) throw new Error("PNG uses an unsupported scanline filter.");
    const rowOffset = row * stride;
    for (let column = 0; column < stride; column += 1) {
      const value = raw[inputOffset++]!;
      const left = column >= channels ? output[rowOffset + column - channels]! : 0;
      const above = row ? output[rowOffset + column - stride]! : 0;
      const upperLeft = row && column >= channels ? output[rowOffset + column - stride - channels]! : 0;
      const predictor = filter === 1 ? left
        : filter === 2 ? above
          : filter === 3 ? Math.floor((left + above) / 2)
            : filter === 4 ? paeth(left, above, upperLeft) : 0;
      output[rowOffset + column] = (value + predictor) & 255;
    }
  }
  return output;
}

function rgba(scan: Uint8Array, width: number, height: number, colorType: number, palette: Uint8Array | null, transparency: Uint8Array | null): Uint8Array {
  const output = new Uint8Array(width * height * 4);
  const channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
  for (let pixel = 0; pixel < width * height; pixel += 1) {
    const source = pixel * channels;
    const target = pixel * 4;
    if (colorType === 0) {
      output.set([scan[source]!, scan[source]!, scan[source]!, 255], target);
    } else if (colorType === 2) {
      output.set([scan[source]!, scan[source + 1]!, scan[source + 2]!, 255], target);
    } else if (colorType === 3) {
      const index = scan[source]!;
      const offset = index * 3;
      if (!palette || offset + 2 >= palette.length) throw new Error("PNG palette index is invalid.");
      output.set([palette[offset]!, palette[offset + 1]!, palette[offset + 2]!, transparency?.[index] ?? 255], target);
    } else if (colorType === 4) {
      output.set([scan[source]!, scan[source]!, scan[source]!, scan[source + 1]!], target);
    } else {
      output.set([scan[source]!, scan[source + 1]!, scan[source + 2]!, scan[source + 3]!], target);
    }
  }
  return output;
}

export function decodePngDataUri(source: string): RgbaImage {
  const prefix = "data:image/png;base64,";
  if (!source.startsWith(prefix)) throw new Error("Image is not an inline PNG.");
  const encoded = source.slice(prefix.length);
  if (!encoded || encoded.length > 24_000_000 || !/^[a-z0-9+/=\r\n]+$/iu.test(encoded)) throw new Error("PNG data is invalid or too large.");
  const bytes = new Uint8Array(Buffer.from(encoded, "base64"));
  if (signature.some((value, index) => bytes[index] !== value)) throw new Error("PNG signature is invalid.");
  let offset = 8;
  let width = 0;
  let height = 0;
  let colorType = -1;
  let channels = 0;
  let palette: Uint8Array | null = null;
  let transparency: Uint8Array | null = null;
  const compressed: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error("PNG chunk exceeds its payload.");
    const data = bytes.subarray(start, end);
    if (type === "IHDR") {
      width = readU32(data, 0);
      height = readU32(data, 4);
      const bitDepth = data[8];
      colorType = data[9] ?? -1;
      if (bitDepth !== 8 || ![0, 2, 3, 4, 6].includes(colorType) || data[12] !== 0) throw new Error("PNG format is unsupported.");
      channels = colorType === 0 || colorType === 3 ? 1 : colorType === 2 ? 3 : colorType === 4 ? 2 : 4;
      if (!width || !height || width * height > 16_000_000) throw new Error("PNG dimensions are outside the terminal limit.");
    } else if (type === "PLTE") palette = new Uint8Array(data);
    else if (type === "tRNS") transparency = new Uint8Array(data);
    else if (type === "IDAT") compressed.push(new Uint8Array(data));
    else if (type === "IEND") break;
    offset = end + 4;
  }
  if (!width || !height || !compressed.length) throw new Error("PNG is incomplete.");
  const expected = (width * channels + 1) * height;
  if (expected > 68_000_000) throw new Error("PNG expands beyond the terminal limit.");
  const packed = Buffer.concat(compressed.map((part) => Buffer.from(part)));
  const raw = new Uint8Array(inflateSync(packed, { maxOutputLength: expected }));
  return { width, height, pixels: rgba(unfilter(raw, width, height, channels), width, height, colorType, palette, transparency) };
}
