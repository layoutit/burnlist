import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./FileDiff.tsx", import.meta.url).pathname;
const layoutPath = new URL("../../layout", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
let outputDir;
let FileDiff;

before(async () => {
  outputDir = await mkdtemp(join(process.cwd(), ".file-diff-test-"));
  const outputPath = join(outputDir, "FileDiff.mjs");
  await build({
    entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
    alias: { "@layout": layoutPath, "@lib": libPath }, jsx: "automatic", packages: "external", target: "node18",
  });
  ({ FileDiff } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`));
});

after(async () => {
  await rm(outputDir, { force: true, recursive: true });
});

test("FileDiff preserves a chip-kind file and its metadata", () => {
  const markup = renderToStaticMarkup(createElement(FileDiff, {
    file: { path: "assets/logo.png", kind: "binary", meta: { reason: "Generated asset", bytes: 128 } },
  }));

  assert.equal(markup, "<section class=\"streaming-diff-file\"><div class=\"streaming-diff-file-head\"><code>assets/logo.png</code><span data-slot=\"badge\" data-variant=\"outline\" class=\"ui-badge ui-badge--outline\">binary</span></div><p class=\"streaming-diff-file-meta\">Generated asset · 128 bytes</p></section>");
});

test("FileDiff preserves unified text content", () => {
  const markup = renderToStaticMarkup(createElement(FileDiff, {
    file: { path: "src/app.ts", kind: "modified", diff: "@@ -1 +1 @@\n-old\n+new" },
  }));

  assert.equal(markup, "<section class=\"streaming-diff-file\"><div class=\"streaming-diff-file-head\"><code>src/app.ts</code><span data-slot=\"badge\" data-variant=\"secondary\" class=\"ui-badge ui-badge--secondary\">modified</span></div><pre class=\"streaming-diff-unified\">@@ -1 +1 @@\n-old\n+new</pre></section>");
});

test("FileDiff reports unavailable content for a text file without a diff", () => {
  const markup = renderToStaticMarkup(createElement(FileDiff, {
    file: { path: "src/app.ts", kind: "modified" },
  }));

  assert.equal(markup, "<section class=\"streaming-diff-file\"><div class=\"streaming-diff-file-head\"><code>src/app.ts</code><span data-slot=\"badge\" data-variant=\"secondary\" class=\"ui-badge ui-badge--secondary\">modified</span></div><p class=\"streaming-diff-file-meta\">Diff content is unavailable.</p></section>");
});
