import { expect, test } from "bun:test";
import { createFireFrameRenderer } from "./fire-frame";
import { supersampleImage } from "./image-supersample";
import { TERMINAL_RESOURCE_LIMITS } from "./oven-runtime/resource-limits";
import { decodePngDataUri } from "./png-glyph";

const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const chunk = (type: string, data: Uint8Array) => {
  const bytes = new Uint8Array(12 + data.length);
  new DataView(bytes.buffer).setUint32(0, data.length);
  bytes.set([...type].map((glyph) => glyph.charCodeAt(0)), 4);
  bytes.set(data, 8);
  return bytes;
};
const png = (...chunks: Uint8Array[]) => `data:image/png;base64,${Buffer.from(Uint8Array.from([...signature, ...chunks.flatMap((part) => [...part])])).toString("base64")}`;
const header = (width: number, height: number) => {
  const data = new Uint8Array(13);
  const view = new DataView(data.buffer);
  view.setUint32(0, width); view.setUint32(4, height); data[8] = 8; data[9] = 6;
  return chunk("IHDR", data);
};

test("rejects oversized PNG dimensions and excessive PNG chunk work before decode", () => {
  expect(() => decodePngDataUri(png(header(TERMINAL_RESOURCE_LIMITS.pngDimension + 1, 1), chunk("IEND", new Uint8Array())))).toThrow("dimensions");
  expect(() => decodePngDataUri(png(header(1, 1), ...Array.from({ length: TERMINAL_RESOURCE_LIMITS.pngChunks }, () => chunk("tEXt", new Uint8Array())), chunk("IEND", new Uint8Array())))).toThrow("too many chunks");
});

test("rejects oversized compressed sources and unsupported binary model media", () => {
  const oversized = Buffer.alloc(TERMINAL_RESOURCE_LIMITS.pngCompressedBytes + 1).toString("base64");
  expect(() => decodePngDataUri(`data:image/png;base64,${oversized}`)).toThrow("compressed payload");
  expect(() => decodePngDataUri("https://assets.example/fire.glb")).toThrow("GLB");
  expect(() => decodePngDataUri("data:model/gltf-binary;base64,AA==")).toThrow("GLB");
});

test("caps terminal image cells and rejects oversized caller-owned RGBA buffers", () => {
  const image = { width: 2, height: 2, pixels: new Uint8Array(16) };
  const frame = supersampleImage(image, 10_000, 10_000);
  expect(frame.cols * frame.rows).toBeLessThanOrEqual(TERMINAL_RESOURCE_LIMITS.imageCells);
  expect(() => supersampleImage({ width: TERMINAL_RESOURCE_LIMITS.pngDimension + 1, height: 1, pixels: new Uint8Array() }, 1, 1)).toThrow("terminal limit");
});

test("rejects glyph buffers above the frame-work ceiling before glyphcss work", () => {
  expect(() => createFireFrameRenderer(TERMINAL_RESOURCE_LIMITS.frameWorkCells + 1, 1)).toThrow("cell limit");
  expect(createFireFrameRenderer(20, 12)(0).char).toHaveLength(240);
});
