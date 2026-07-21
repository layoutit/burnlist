import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { FrameCard } from "./FrameCard";

function referencePercent(value) {
  return `${(value * 100).toFixed(value < 0.01 ? 3 : 2)}%`;
}

function referenceDelta(value) {
  return value.toFixed(4).replace(/0+$/u, "").replace(/\.$/u, "");
}

function FrozenFrameCard({ status, frame, difference, images, label }) {
  return createElement(
    "article",
    { className: `visual-parity-frame ${status}` },
    createElement(
      "header",
      null,
      createElement("strong", null, "Frame ", frame),
      createElement("span", null, status, " · ", referencePercent(difference.ratio), " · mean ", referenceDelta(difference.meanAbsoluteDelta), " · max ", difference.maximumAbsoluteDelta),
    ),
    createElement(
      "div",
      { className: "visual-parity-shots" },
      images.map((image) => createElement(
        "figure",
        { key: image.label },
        createElement("figcaption", null, image.label),
        createElement("img", { alt: `${label} ${image.label.toLowerCase()} frame ${frame}`, height: image.height, src: image.src ?? undefined, width: image.width }),
      )),
    ),
  );
}

test("FrameCard matches a passing frame snapshot", () => {
  const props = {
    status: "pass",
    frame: 8,
    difference: { ratio: 0.0025, meanAbsoluteDelta: 0.0312, maximumAbsoluteDelta: 5 },
    images: [
      { label: "Reference", height: 90, src: "/reference.png", width: 160 },
      { label: "Candidate", height: 90, src: "/candidate.png", width: 160 },
      { label: "Diff", height: 90, src: "/diff.png", width: 160 },
    ],
    label: "Dashboard",
  };
  assert.equal(renderToString(createElement(FrameCard, props)), renderToString(createElement(FrozenFrameCard, props)));
});
