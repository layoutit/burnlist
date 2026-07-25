import assert from "node:assert/strict";
import test from "node:test";
import { compileGlyph } from "./glyph-compile.mjs";

const landing = `
<screen id="home" title="Burnlist" version="1">
  <brand-header title="Burnlist" subtitle="Observer" />
  <section-heading id="burnlists-heading" title="Burnlists" source="burnlists" />
  <burnlist-list id="burnlists" source="burnlists" flex="1" />
  <footer hints="enter:open · o:ovens · esc:exit" />
</screen>`;

test("compileGlyph builds frozen screen IR", () => {
  const result = compileGlyph(landing, { file: "home.glyph" });
  assert.equal(result.ok, true);
  assert.equal(result.ir.schema, "burnlist-glyph-screen@1");
  assert.deepEqual(result.ir.root.children[2].attributes, { id: "burnlists", source: "burnlists", flex: 1 });
  assert.equal(Object.isFrozen(result.ir.root), true);
});

test("compileGlyph accepts closed Oven and item detail surfaces", () => {
  const oven = compileGlyph(`<screen id="oven" title="Oven" version="1"><oven-detail source="oven" /><footer hints="q:back" /></screen>`);
  const item = compileGlyph(`<screen id="item" title="Item" version="1"><item-detail source="item" /><footer hints="q:back" /></screen>`);
  assert.equal(oven.ok, true);
  assert.equal(item.ok, true);
});

test("compileGlyph rejects executable or unknown component trees", () => {
  const result = compileGlyph(`<screen id="bad" title="Bad" version="1"><script source="projects" /></screen>`);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((entry) => entry.code === "GLYPH_ELEMENT"), true);
});

test("compileGlyph validates unique ids and declared sources", () => {
  const result = compileGlyph(`
    <screen id="home" title="Bad" version="1">
      <columns>
        <resource-list id="same" title="A" source="projects" />
        <resource-list id="same" title="B" source="secrets" />
      </columns>
    </screen>`);
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.some((entry) => entry.code === "GLYPH_DUPLICATE_ID"), true);
  assert.equal(result.diagnostics.some((entry) => entry.code === "GLYPH_SOURCE"), true);
});
