import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { DomainNote } from "./DomainNote";

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
