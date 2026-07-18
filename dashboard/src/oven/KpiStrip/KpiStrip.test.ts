import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { KpiStrip } from "./KpiStrip";

test("KpiStrip preserves exact attributes and child output", () => {
  const strip = createElement(KpiStrip, {
    ariaLabel: "Burnlist progress KPIs",
    className: "driving-parity-kpi-strip has-burns checklist-kpi-strip",
    children: "CHILD",
  });
  const expected = "<div aria-label=\"Burnlist progress KPIs\" class=\"driving-parity-kpi-strip has-burns checklist-kpi-strip\">CHILD</div>";

  assert.equal(renderToStaticMarkup(strip), expected);
  assert.equal(renderToString(strip), expected);
});

test("KpiStrip omits an undefined aria-label attribute", () => {
  const markup = renderToStaticMarkup(createElement(KpiStrip, { className: "checklist-kpi-strip" }));

  assert.doesNotMatch(markup, / aria-label=/u);
});
