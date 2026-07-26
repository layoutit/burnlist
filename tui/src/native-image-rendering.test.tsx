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

test("enabled native images register one bounded overlay above the glyph fallback", async () => {
  expect(await registeredImages("1")).toBe(1);
});
