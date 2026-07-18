import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./ImageTriptych.tsx", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;
let outputDir;
let ImageTriptych;

before(async () => {
  outputDir = await mkdtemp(join(process.cwd(), ".image-triptych-test-"));
  const outputPath = join(outputDir, "ImageTriptych.mjs");
  await build({
    entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
    alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18",
  });
  ({ ImageTriptych } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`));
});

after(async () => {
  await rm(outputDir, { force: true, recursive: true });
});

function FrozenImageTriptych({ images, label, frame }) {
  return createElement(
    "div",
    { className: "visual-parity-shots" },
    images.map((image) => createElement(
      "figure",
      { key: image.label },
      createElement("figcaption", null, image.label),
      createElement("img", { alt: `${label} ${image.label.toLowerCase()} frame ${frame}`, height: image.height, src: image.src ?? undefined, width: image.width }),
    )),
  );
}

test("ImageTriptych matches the three image snapshot", () => {
  const props = {
    images: [
      { label: "Reference", height: 100, src: "/reference.png", width: 200 },
      { label: "Candidate", height: 100, src: null, width: 200 },
      { label: "Diff", height: 100, src: "/diff.png", width: 200 },
    ],
    label: "Dashboard",
    frame: 4,
  };
  assert.equal(renderToString(createElement(ImageTriptych, props)), renderToString(createElement(FrozenImageTriptych, props)));
});
