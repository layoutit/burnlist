import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AsciiBlock } from "./AsciiBlock";

test("AsciiBlock renders uncoloured text without character spans", () => {
  const markup = renderToStaticMarkup(createElement(AsciiBlock, { text: "A B\nC D", label: "glyph scene" }));
  assert.match(markup, /<pre[^>]*>A B\nC D<\/pre>/u);
  assert.doesNotMatch(markup, /<span/u);
});

test("AsciiBlock coalesces adjacent colours into one span per run", () => {
  const markup = renderToStaticMarkup(createElement(AsciiBlock, {
    text: "aab\nccc",
    colors: [["red", "red", "blue"], ["blue", "blue", "blue"]],
  }));
  assert.equal((markup.match(/<span /gu) ?? []).length, 3);
  assert.match(markup, /style="color:red">aa<\/span>/u);
  assert.match(markup, /style="color:blue">b<\/span>\n<span style="color:blue">ccc<\/span>/u);
});
