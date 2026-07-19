import test from "node:test";
import assert from "node:assert/strict";
import { scanXml } from "./xml-scan.mjs";

const bad = (text, options) => { const result = scanXml(text, options); assert.equal(result.ok, false, text); assert.ok(result.diagnostics.length); };
test("parser security matrix rejects hostile and malformed XML", () => {
  for (const text of ["<oven>", "<!DOCTYPE oven><oven/>", "<!ENTITY x 'y'><oven/>", "<!DOCTYPE x [<!ENTITY % p SYSTEM 'x'>]><oven/>", "<![CDATA[x]]><oven/>", "<?xml version='1.0'?><oven/>", "<oven a='1' a='2'/>", "<oven>text</oven>", "<oven><x></oven>", "<oven/> trailing", "<x:y/>", "<oven xmlns:x='urn:x'/>"]) bad(text);
});
test("scanner enforces limits and never throws", () => {
  bad(`<oven a="${"x".repeat(20)}"/>`, { limits: { bytes: 1000, depth: 4, nodes: 5, attrs: 5, scalar: 5 } });
  bad("<a><b><c/></b></a>", { limits: { bytes: 1000, depth: 1, nodes: 10, attrs: 5, scalar: 10 } });
  bad("<a><b/><c/><d/></a>", { limits: { bytes: 1000, depth: 5, nodes: 2, attrs: 5, scalar: 10 } });
  bad("<a x='1' y='2'/>", { limits: { bytes: 1000, depth: 5, nodes: 5, attrs: 1, scalar: 10 } });
  bad(Buffer.from([0xc3, 0x28]));
  bad("<oven>\0</oven>");
});
test("scanner decodes only predefined entities and returns source spans", () => {
  const result = scanXml("<oven title='a &amp; b &quot;c&quot;'/>");
  assert.equal(result.ok, true);
  assert.equal(result.ast.attrs.title, 'a & b "c"');
  assert.deepEqual(result.ast.span, { offset: 0, line: 1, column: 1 });
  bad("<oven title='&copy;' />");
});
test("optional extension namespaces are ignored with a warning", () => {
  const result = scanXml("<oven xmlns:x='urn:burnlist:oven:extension:test'><x:meta optional='true'><bad/></x:meta></oven>");
  assert.equal(result.ok, true);
  assert.equal(result.ast.children.length, 0);
  assert.equal(result.warnings[0].code, "XML_EXTENSION_IGNORED");
});
