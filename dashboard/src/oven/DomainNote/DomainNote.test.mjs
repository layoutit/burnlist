import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { build } from "esbuild";

const componentPath = new URL("./DomainNote.tsx", import.meta.url).pathname;
const libPath = new URL("../../lib", import.meta.url).pathname;
const ovenPath = new URL("..", import.meta.url).pathname;
let outputDir;
let DomainNote;

before(async () => {
  outputDir = await mkdtemp(join(process.cwd(), ".domain-note-test-"));
  const outputPath = join(outputDir, "DomainNote.mjs");
  await build({
    entryPoints: [componentPath], bundle: true, format: "esm", outfile: outputPath, platform: "node",
    alias: { "@lib": libPath, "@oven": ovenPath }, jsx: "automatic", packages: "external", target: "node18",
  });
  ({ DomainNote } = await import(`${new URL(`file://${outputPath}`).href}?test=${Date.now()}`));
});

after(async () => {
  await rm(outputDir, { force: true, recursive: true });
});

function FrozenDomainNote({ isTarget, rationale }) {
  return createElement(
    "div",
    { className: "visual-parity-domain-note" },
    createElement("strong", null, isTarget ? "Qualifying target" : "Diagnostic context"),
    createElement("span", null, rationale),
  );
}

test("DomainNote matches target and diagnostic labels", () => {
  for (const props of [
    { isTarget: true, rationale: "Exact zero tolerance." },
    { isTarget: false, rationale: "Used for diagnosis." },
  ]) {
    assert.equal(renderToString(createElement(DomainNote, props)), renderToString(createElement(FrozenDomainNote, props)));
  }
});
