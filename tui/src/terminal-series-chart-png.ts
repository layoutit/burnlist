import { deflateSync } from "node:zlib";
import type { NormalizedTerminalSeries } from "./terminal-series-chart-model";

type Rgba = readonly [number, number, number, number];
const cache = new Map<string, string>();
const MAX_CACHE_ENTRIES = 64;

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

function png(width: number, height: number, pixels: Uint8Array) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const scanlines = Buffer.alloc(height * (width * 4 + 1));
  for (let row = 0; row < height; row += 1) Buffer.from(pixels.subarray(row * width * 4, (row + 1) * width * 4)).copy(scanlines, row * (width * 4 + 1) + 1);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(scanlines, { level: 6 })),
    chunk("IEND", new Uint8Array()),
  ]);
}

function hex(value: string, alpha = 255): Rgba {
  const match = /^#?([\da-f]{6})$/i.exec(value);
  if (!match) return [128, 128, 128, alpha];
  const number = Number.parseInt(match[1]!, 16);
  return [number >> 16, number >> 8 & 255, number & 255, alpha];
}

function blend(pixels: Uint8Array, width: number, height: number, x: number, y: number, color: Rgba) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const index = (y * width + x) * 4, mix = color[3] / 255, inverse = 1 - mix;
  pixels[index] = Math.round(color[0] * mix + pixels[index]! * inverse);
  pixels[index + 1] = Math.round(color[1] * mix + pixels[index + 1]! * inverse);
  pixels[index + 2] = Math.round(color[2] * mix + pixels[index + 2]! * inverse);
  pixels[index + 3] = Math.min(255, color[3] + Math.round(pixels[index + 3]! * inverse));
}

function line(pixels: Uint8Array, width: number, height: number, x1: number, y1: number, x2: number, y2: number, color: Rgba, thickness = 1, dashed = false) {
  const steps = Math.max(1, Math.ceil(Math.hypot(x2 - x1, y2 - y1) * 2));
  for (let step = 0; step <= steps; step += 1) {
    if (dashed && Math.floor(step / 5) % 2) continue;
    const mix = step / steps, x = Math.round(x1 + (x2 - x1) * mix), y = Math.round(y1 + (y2 - y1) * mix);
    for (let oy = -thickness; oy <= thickness; oy += 1) {
      for (let ox = -thickness; ox <= thickness; ox += 1) {
        if (ox * ox + oy * oy <= thickness * thickness) blend(pixels, width, height, x + ox, y + oy, color);
      }
    }
  }
}

/** Cached high-density image projection of the same model used by the Braille fallback. */
export function terminalSeriesPngDataUri(model: NormalizedTerminalSeries, columns: number, rows: number) {
  const width = Math.max(16, Math.floor(columns) * 6), height = Math.max(16, Math.floor(rows) * 10);
  const key = JSON.stringify([width, height, model.mode, model.domain, model.colors, model.points]);
  const hit = cache.get(key);
  if (hit) return hit;
  const pixels = new Uint8Array(width * height * 4);
  const points = model.points.filter((point) => Number.isFinite(point.value));
  if (points.length) {
    const min = model.domain.min, span = Math.max(0.000001, model.domain.max - min);
    const px = (index: number) => points.length === 1 ? Math.floor(width / 2) : Math.round(index / (points.length - 1) * (width - 3)) + 1;
    const py = (value: number) => Math.max(1, Math.min(height - 2, Math.round((model.domain.max - value) / span * (height - 3)) + 1));
    const guide = hex(model.layout.divider, 90);
    if (model.mode === "delta" && min <= 0 && model.domain.max >= 0) line(pixels, width, height, 0, py(0), width - 1, py(0), guide, 0, true);
    for (let index = 0; index < points.length - 1; index += 1) {
      const first = points[index]!, next = points[index + 1]!, failing = first.state === "fail" || next.state === "fail";
      const color = hex(failing ? model.colors.fail : model.colors.pass);
      const left = px(index), right = px(index + 1), top = py(first.value!), bottom = py(next.value!);
      for (let x = left; x <= right; x += 1) {
        const mix = right === left ? 0 : (x - left) / (right - left);
        const pathY = Math.round(top + (bottom - top) * mix);
        for (let y = pathY + 1; y < height; y += 1) blend(pixels, width, height, x, y, [color[0], color[1], color[2], 18]);
      }
      line(pixels, width, height, left, top, right, bottom, color, 2);
      if (model.mode === "value" && failing && Number.isFinite(first.reference) && Number.isFinite(next.reference)) {
        line(pixels, width, height, left, py(first.reference!), right, py(next.reference!), hex(model.colors.pass, 190), 1, true);
      }
    }
    for (const index of [0, points.length - 1]) {
      const point = points[index]!, color = hex(point.state === "fail" ? model.colors.fail : model.colors.pass);
      for (let oy = -2; oy <= 2; oy += 1) for (let ox = -2; ox <= 2; ox += 1) if (ox * ox + oy * oy <= 4) blend(pixels, width, height, px(index) + ox, py(point.value!) + oy, color);
    }
  }
  const uri = `data:image/png;base64,${png(width, height, pixels).toString("base64")}`;
  cache.set(key, uri);
  if (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return uri;
}
