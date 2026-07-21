import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
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
