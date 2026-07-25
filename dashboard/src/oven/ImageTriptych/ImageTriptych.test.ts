import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { componentMediaImages } from "../../../../tui/src/catalog/component-media-fixture";
import { ImageTriptych } from "./ImageTriptych";

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

test("paired Visual Parity renders the real shared PNG triptych as accessible images", () => {
  const html = renderToString(createElement(ImageTriptych, {
    images: [...componentMediaImages],
    label: "Night scene",
    frame: 7,
  }));
  assert.equal((html.match(/<img /gu) ?? []).length, 3);
  for (const image of componentMediaImages) {
    assert.ok(html.includes(`src="${image.src}"`), `${image.label} must retain the shared PNG source`);
    assert.ok(html.includes(`alt="Night scene ${image.label.toLowerCase()} frame 7"`));
  }
});
