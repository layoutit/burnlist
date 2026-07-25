import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { pairedPreviewRects } from "../dashboard/src/components/TerminalFrame/pair-layout.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

function overlap(left, right) {
  return left.y === right.y && left.x < right.x + right.width && right.x < left.x + left.width;
}

test("paired component panes stack before their measured minimum would overlap", () => {
  for (const [component, width, expectedStacked] of [
    ["badge", 800, true],
    ["badge", 1200, false],
    ["field-list-cards", 1200, true],
    ["field-list-cards", 1600, false],
  ]) {
    const [consolePane, terminalPane] = pairedPreviewRects(width, component);
    assert.equal(consolePane.width <= width && terminalPane.width <= width, true);
    assert.equal(overlap(consolePane, terminalPane), false);
    assert.equal(consolePane.y !== terminalPane.y, expectedStacked);
  }
});

test("FieldListCards Storybook CSS enforces bounded vertical card flow", async () => {
  const css = await readFile(resolve(root, "dashboard/src/components/TerminalFrame/terminal-frame.css"), "utf8");
  assert.match(css, /grid-template-columns:\s*repeat\(auto-fit,\s*minmax\(min\(100%,\s*var\(--pair-min-pane/u);
  assert.match(css, /\.storybook-field-list-pattern \.hybrid-list\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;[^}]*gap:/su);
  assert.match(css, /\.storybook-field-list-pattern \.hybrid-row\s*\{[^}]*position:\s*relative;[^}]*flex:\s*0 0 auto;[^}]*width:\s*100%;/su);
});
