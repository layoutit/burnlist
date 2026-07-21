import assert from "node:assert/strict";
import { test } from "node:test";
import { Fragment, createElement } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { KpiItem } from "./KpiItem";

test("KpiItem preserves the exact Checklist item markup", () => {
  const visual = createElement("svg", { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" });
  const item = createElement(KpiItem, {
    className: "driving-parity-kpi-item driving-parity-kpi-section checklist-kpi-current",
    title: "No active task",
    visual,
    heading: "Current",
    value: "Complete",
  });
  const expected = "<div class=\"driving-parity-kpi-item driving-parity-kpi-section checklist-kpi-current\" title=\"No active task\"><svg aria-hidden=\"true\" class=\"driving-parity-kpi-gauge driving-parity-kpi-scenario-icon\"></svg><div class=\"driving-parity-kpi-text\"><div class=\"driving-parity-kpi-heading\">Current</div><div class=\"driving-parity-kpi-ratio\">Complete</div></div></div>";

  assert.equal(renderToStaticMarkup(item), expected);
  assert.equal(renderToString(item), expected);
});

test("KpiItem omits an undefined title attribute", () => {
  const markup = renderToStaticMarkup(createElement(KpiItem, { heading: "Elapsed", value: "2m" }));

  assert.doesNotMatch(markup, / title=/u);
});

test("KpiItem preserves the value fragment topology", () => {
  const value = createElement(
    Fragment,
    null,
    createElement("span", { className: "pass" }, 2),
    createElement("span", { className: "separator" }, "·"),
    createElement("span", { className: "total" }, 2),
    " ",
    createElement("span", { className: "pass" }, "(", 100, "%)"),
  );
  const kpiItemElement = createElement(KpiItem, {
    className: "driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress",
    visual: createElement("svg", { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-progress-donut", viewBox: "0 0 58 58" }),
    heading: "Progress",
    value,
  });
  function FrozenProgressItem() {
    return createElement("div", { className: "driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress" },
      createElement("svg", { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-progress-donut", viewBox: "0 0 58 58" }),
      createElement("div", { className: "driving-parity-kpi-text" },
        createElement("div", { className: "driving-parity-kpi-heading" }, "Progress"),
        createElement("div", { className: "driving-parity-kpi-ratio" },
          createElement("span", { className: "pass" }, 2),
          createElement("span", { className: "separator" }, "·"),
          createElement("span", { className: "total" }, 2),
          " ",
          createElement("span", { className: "pass" }, "(", 100, "%)"))));
  }

  assert.equal(renderToString(kpiItemElement), renderToString(createElement(FrozenProgressItem)));
  const item = createElement(KpiItem, { heading: "Progress", value });
  assert.equal(renderToStaticMarkup(item), "<div><div class=\"driving-parity-kpi-text\"><div class=\"driving-parity-kpi-heading\">Progress</div><div class=\"driving-parity-kpi-ratio\"><span class=\"pass\">2</span><span class=\"separator\">·</span><span class=\"total\">2</span> <span class=\"pass\">(100%)</span></div></div></div>");
});
