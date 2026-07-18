import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./DomainTabs.tsx", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;
let outputDir;
let DomainTabs;

before(async () => {
  outputDir = await mkdtemp(join(process.cwd(), ".domain-tabs-test-"));
  const outputPath = join(outputDir, "DomainTabs.mjs");
  await build({
    entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
    alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18",
  });
  ({ DomainTabs } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`));
});

after(async () => {
  await rm(outputDir, { force: true, recursive: true });
});

function FrozenDomainTabs({ tabs, activeId, onSelect }) {
  return createElement(
    "nav",
    { "aria-label": "Visual parity domains", className: "visual-parity-domains" },
    tabs.map((tab) => {
      const current = tab.id === activeId;
      return createElement(
        "button",
        { "aria-pressed": current, className: current ? "is-active" : "", key: tab.id, onClick: () => onSelect(tab.id), type: "button" },
        createElement("span", null, tab.label),
        createElement("small", null, tab.qualification, " · ", tab.failed ? `${tab.failed} fail` : "pass"),
      );
    }),
  );
}

test("DomainTabs matches active and inactive domain buttons", () => {
  const props = {
    tabs: [
      { id: "target", label: "Target", qualification: "target", failed: 0 },
      { id: "context", label: "Context", qualification: "context", failed: 2 },
    ],
    activeId: "target",
    onSelect: () => {},
  };
  assert.equal(renderToString(createElement(DomainTabs, props)), renderToString(createElement(FrozenDomainTabs, props)));
});
