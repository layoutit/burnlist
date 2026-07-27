import { describe, expect, test } from "bun:test";
import { supersampleImage } from "./image-supersample";
import { decodePngDataUri } from "./png-glyph";

const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAAAAAAAAAAAAE0lEQVR4nGP4z8DwHwwZGP6DAQBJyAn3AAAAAAAAAABJRU5EAAAAAA==";

describe("Visual Parity PNG rendering", () => {
  test("decodes a bounded RGBA PNG and preserves its four pixels", () => {
    const image = decodePngDataUri(png);
    expect([image.width, image.height]).toEqual([2, 2]);
    expect([...image.pixels]).toEqual([
      255, 0, 0, 255, 0, 255, 0, 255,
      0, 0, 255, 255, 255, 255, 255, 255,
    ]);
  });

  test("resamples four RGBA pixels for every terminal cell", () => {
    const frame = supersampleImage(decodePngDataUri(png), 4, 3);
    expect([frame.cols, frame.rows]).toEqual([4, 2]);
    expect([frame.pixelWidth, frame.pixelHeight]).toEqual([8, 4]);
    expect(frame.pixels).toHaveLength(8 * 4 * 4);
    expect([...frame.pixels.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    expect([...frame.pixels.slice(-4)]).toEqual([255, 255, 255, 255]);
  });

  test("fits portrait images without stretching them across the full width", () => {
    const image = { width: 2, height: 4, pixels: new Uint8Array(2 * 4 * 4) };
    const frame = supersampleImage(image, 20, 5);
    expect([frame.cols, frame.rows]).toEqual([5, 5]);
  });

  test("rejects non-PNG and oversized input", () => {
    expect(() => decodePngDataUri("data:image/jpeg;base64,AA==")).toThrow("inline PNG");
    expect(() => decodePngDataUri("data:image/png;base64,AA==")).toThrow("signature");
  });
});
