import { afterEach, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { createRoot, flushSync } from "@opentui/react";
import { GlyphImage } from "./glyph-image";
import { visualParityPng } from "./catalog/visual-parity-fixture";

const originalOverride = process.env.BURNLIST_NATIVE_IMAGES;
afterEach(() => {
  if (originalOverride === undefined) delete process.env.BURNLIST_NATIVE_IMAGES;
  else process.env.BURNLIST_NATIVE_IMAGES = originalOverride;
});

async function registeredImages(override: "0" | "1") {
  process.env.BURNLIST_NATIVE_IMAGES = override;
  const setup = await createTestRenderer({ width: 30, height: 10, useThread: false });
  const root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(<GlyphImage source={visualParityPng.current} width={24} height={8} />));
    await setup.renderOnce();
    return (setup.renderer as unknown as { nativeImages: readonly unknown[] }).nativeImages.length;
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
}

test("disabled native images paint only the glyph fallback", async () => {
  expect(await registeredImages("0")).toBe(0);
});

test("enabled native images register one bounded thumbnail", async () => {
  expect(await registeredImages("1")).toBe(1);
});

test("a native image triptych shares one row and advances only by its columns", async () => {
  process.env.BURNLIST_NATIVE_IMAGES = "1";
  const setup = await createTestRenderer({ width: 80, height: 12, useThread: false });
  const root = createRoot(setup.renderer);
  try {
    flushSync(() => root.render(<box width={72} height={8} flexDirection="row">
      {Object.values(visualParityPng).map((source, index) =>
        <GlyphImage key={index} source={source} width={24} height={8} />)}
    </box>));
    await setup.renderOnce();
    const placements = (setup.renderer as unknown as { nativeImages: readonly { x: number; y: number; width: number; height: number }[] }).nativeImages;
    expect(placements).toHaveLength(3);
    expect(placements.map(({ x, y, width, height }) => [x, y, width, height])).toEqual([
      [0, 0, 24, 8],
      [24, 0, 24, 8],
      [48, 0, 24, 8],
    ]);
  } finally {
    root.unmount();
    setup.renderer.destroy();
  }
});
