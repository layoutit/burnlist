import { expect, test } from "bun:test";
import { visualParityPng } from "./catalog/visual-parity-fixture";
import { nativeImageThumbnail } from "./native-image-thumbnail";
import { decodePngDataUri } from "./png-glyph";

test("native thumbnails are cached and bounded to terminal pixel density", () => {
  const original = visualParityPng.current;
  const first = nativeImageThumbnail(original, 6, 3);
  const second = nativeImageThumbnail(original, 6, 3);
  const decoded = decodePngDataUri(first);
  expect(first).toBe(second);
  expect(decoded.width).toBeLessThanOrEqual(24);
  expect(decoded.height).toBeLessThanOrEqual(24);
  expect(first.length).toBeLessThan(original.length);
});
