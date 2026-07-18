import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  assertDomEquivalent,
  domEquivalent,
  extractById,
  extractFirstByClass,
} from "../test-support/dom-normalize";

test("ignores indentation and collapses text whitespace", () => {
  assertDomEquivalent("<div>\n  <span>a\n   b</span>\n</div>", "<div><span>a b</span></div>");
});

test("ignores attribute order and normalizes empty-element syntax", () => {
  assertDomEquivalent(
    '<svg class="a" viewBox="0 0 58 58" aria-hidden="true"/>',
    '<svg aria-hidden="true" class="a" viewBox="0 0 58 58"></svg>',
  );
});

test("detects changed attributes, structure, and text", () => {
  assert.equal(domEquivalent('<div class="a"></div>', '<div class="b"></div>').equal, false);
  assert.equal(domEquivalent("<div><span>x</span></div>", "<div></div>").equal, false);
  assert.equal(domEquivalent("<div>a</div>", "<div>b</div>").equal, false);
});

test("decodes equivalent entities in text and attributes", () => {
  assertDomEquivalent('<div title="&#39;">&#39;</div>', '<div title="&#x27;">&#x27;</div>');
  assertDomEquivalent('<div title="&#39;">&#39;</div>', "<div title=\"'\">'</div>");
  assertDomEquivalent(
    '<div title="&amp; &lt; &gt; &quot;">&amp; &lt; &gt; &quot;</div>',
    '<div title="&#38; &#60; &#62; &#34;">&#38; &#60; &#62; &#34;</div>',
  );
});

test("does not make genuinely different characters equivalent", () => {
  assert.equal(domEquivalent("<div>a</div>", "<div>b</div>").equal, false);
  assert.equal(domEquivalent('<div title="&#39;">&#39;</div>', '<div title="&quot;">&quot;</div>').equal, false);
});

test("drops comments", () => {
  assertDomEquivalent("<div><!-- x -->a</div>", "<div>a</div>");
});

test("treats void and self-closing elements equivalently", () => {
  assertDomEquivalent('<img src="x">', '<img src="x"/>');
  assertDomEquivalent('<circle cx="1"/>', '<circle cx="1"></circle>');
});

test("extracts an element by id and class token", () => {
  const html = '<main><div class="outer"><div id="k"><span>x</span></div></div></main>';
  assertDomEquivalent(extractById(html, "k"), '<div id="k"><span>x</span></div>');
  assertDomEquivalent(extractFirstByClass(html, "outer"), '<div class="outer"><div id="k"><span>x</span></div></div>');
});

test("extracts a region from the renderer golden", () => {
  const golden = readFileSync("ovens/differential-testing/renderer/goldens/dt-main.html", "utf8");
  const slice = extractById(golden, "driving-parity-kpi-strip");
  assert.ok(slice.length > 0);
  assert.match(slice, /driving-parity-kpi-item/u);
  assert.equal(domEquivalent(golden, golden).equal, true);
});
