import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StreamingDiffHeading } from "./StreamingDiffHeading";

test("StreamingDiffHeading preserves the selected-feed heading markup", () => {
  const backHref = "/ovens/streaming-diff/view?repoKey=example%2Frepo";
  const markup = renderToStaticMarkup(createElement(StreamingDiffHeading, { backHref, session: "session-123" }));

  assert.equal(markup, `<header class="streaming-diff-heading"><a class="streaming-diff-back" href="${backHref}">Recent feeds</a><h1>Streaming Diff</h1><p>Session session-123</p></header>`);
});
