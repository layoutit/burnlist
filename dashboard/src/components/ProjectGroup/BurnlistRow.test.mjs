import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./BurnlistRow.tsx", import.meta.url).pathname;
const layoutPath = new URL("../../layout", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;

test("a blocked table row exposes its reason without rendering navigation semantics", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "burnlist-row-test-"));
  try {
    const outputPath = join(outputDir, "BurnlistRow.mjs");
    await build({
      entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
      alias: { "@layout": layoutPath, "@lib": libPath }, jsx: "automatic", target: "node18",
    });
    const { BurnlistRow } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`);
    const entry = {
      id: "blocked-checklist", repo: "fixture", repoKey: null, repoRoot: null,
      planPath: null, planLabel: null, title: "Checklist data", status: "active", statusLabel: "Blocked",
      total: 0, done: null, remaining: null, percent: null, errors: 1, warnings: 0,
      updatedAt: null, lastCompletedAt: null, ovenId: "third-party-oven", ovenName: "Third party",
      href: "/Oven/blocked-checklist", progressLabel: "Blocked", blockers: "The data binding is unavailable.",
    };
    const row = BurnlistRow({ entry, filter: "active", ambiguous: false, projectLabel: "Fixture", projectRowSpan: 1 });
    const markup = renderToStaticMarkup(createElement("table", null, createElement("tbody", null, row)));

    assert.equal(row.props.onClick, undefined);
    assert.equal(row.props.role, undefined);
    assert.equal(row.props.tabIndex, undefined);
    assert.match(markup, /The data binding is unavailable\./u);
    assert.match(markup, /data-variant="outline" class="ui-badge ui-badge--outline" data-oven="third-party-oven"/u);
    assert.match(markup, />Third party<\/span>/u);
    assert.match(markup, /class="burnlist-table-title"[^>]*>Checklist data/u);
    assert.match(markup, /scope="rowgroup" title="Fixture">Fixture/u);
    assert.match(markup, /data-blocked-reason="true"/u);
    assert.doesNotMatch(markup, /(?:href=|role="link"|tabindex=)/u);
  } finally {
    await rm(outputDir, { force: true, recursive: true });
  }
});
