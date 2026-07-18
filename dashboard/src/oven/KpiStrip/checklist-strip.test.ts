import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { KpiItem } from "../KpiItem/KpiItem";
import { KpiStrip } from "./KpiStrip";

test("Checklist KPI strip preserves its complete static structure", () => {
  const scenarioIcon = createElement("svg", { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" });
  const donut = createElement("svg", { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-progress-donut", viewBox: "0 0 58 58" });
  const progressValue = createElement(
    Fragment,
    null,
    createElement("span", { className: "pass" }, 2),
    createElement("span", { className: "separator" }, "·"),
    createElement("span", { className: "total" }, 2),
    " ",
    createElement("span", { className: "pass" }, "(", 100, "%)"),
  );
  const strip = createElement(
    KpiStrip,
    { ariaLabel: "Burnlist progress KPIs", className: "driving-parity-kpi-strip has-burns checklist-kpi-strip" },
    createElement(KpiItem, {
      className: "driving-parity-kpi-item driving-parity-kpi-section checklist-kpi-current",
      title: "No active task",
      visual: scenarioIcon,
      heading: "Current",
      value: "Complete",
    }),
    createElement(KpiItem, {
      className: "driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress",
      title: "2 of 2 tasks complete",
      visual: donut,
      heading: "Progress",
      value: progressValue,
    }),
    createElement(KpiItem, {
      className: "driving-parity-kpi-item driving-parity-kpi-section",
      heading: "Elapsed",
      value: "20m",
      visual: scenarioIcon,
    }),
    createElement(KpiItem, {
      className: "driving-parity-kpi-item driving-parity-kpi-section",
      heading: "Avg pace",
      value: "10m",
      visual: scenarioIcon,
    }),
    createElement(KpiItem, {
      className: "driving-parity-kpi-item driving-parity-kpi-section",
      heading: "Time left",
      value: "--",
      visual: scenarioIcon,
    }),
  );
  const expected = "<div aria-label=\"Burnlist progress KPIs\" class=\"driving-parity-kpi-strip has-burns checklist-kpi-strip\"><div class=\"driving-parity-kpi-item driving-parity-kpi-section checklist-kpi-current\" title=\"No active task\"><svg aria-hidden=\"true\" class=\"driving-parity-kpi-gauge driving-parity-kpi-scenario-icon\"></svg><div class=\"driving-parity-kpi-text\"><div class=\"driving-parity-kpi-heading\">Current</div><div class=\"driving-parity-kpi-ratio\">Complete</div></div></div><div class=\"driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress\" title=\"2 of 2 tasks complete\"><svg aria-hidden=\"true\" class=\"driving-parity-kpi-gauge driving-parity-kpi-progress-donut\" viewBox=\"0 0 58 58\"></svg><div class=\"driving-parity-kpi-text\"><div class=\"driving-parity-kpi-heading\">Progress</div><div class=\"driving-parity-kpi-ratio\"><span class=\"pass\">2</span><span class=\"separator\">·</span><span class=\"total\">2</span> <span class=\"pass\">(100%)</span></div></div></div><div class=\"driving-parity-kpi-item driving-parity-kpi-section\"><svg aria-hidden=\"true\" class=\"driving-parity-kpi-gauge driving-parity-kpi-scenario-icon\"></svg><div class=\"driving-parity-kpi-text\"><div class=\"driving-parity-kpi-heading\">Elapsed</div><div class=\"driving-parity-kpi-ratio\">20m</div></div></div><div class=\"driving-parity-kpi-item driving-parity-kpi-section\"><svg aria-hidden=\"true\" class=\"driving-parity-kpi-gauge driving-parity-kpi-scenario-icon\"></svg><div class=\"driving-parity-kpi-text\"><div class=\"driving-parity-kpi-heading\">Avg pace</div><div class=\"driving-parity-kpi-ratio\">10m</div></div></div><div class=\"driving-parity-kpi-item driving-parity-kpi-section\"><svg aria-hidden=\"true\" class=\"driving-parity-kpi-gauge driving-parity-kpi-scenario-icon\"></svg><div class=\"driving-parity-kpi-text\"><div class=\"driving-parity-kpi-heading\">Time left</div><div class=\"driving-parity-kpi-ratio\">--</div></div></div></div>";
  const frozenReferenceStrip = createElement("div", { "aria-label": "Burnlist progress KPIs", className: "driving-parity-kpi-strip has-burns checklist-kpi-strip" },
    createElement("div", { className: "driving-parity-kpi-item driving-parity-kpi-section checklist-kpi-current", title: "No active task" },
      scenarioIcon,
      createElement("div", { className: "driving-parity-kpi-text" },
        createElement("div", { className: "driving-parity-kpi-heading" }, "Current"),
        createElement("div", { className: "driving-parity-kpi-ratio" }, "Complete"))),
    createElement("div", { className: "driving-parity-kpi-item driving-parity-kpi-section driving-parity-kpi-progress", title: "2 of 2 tasks complete" },
      donut,
      createElement("div", { className: "driving-parity-kpi-text" },
        createElement("div", { className: "driving-parity-kpi-heading" }, "Progress"),
        createElement("div", { className: "driving-parity-kpi-ratio" },
          createElement("span", { className: "pass" }, 2),
          createElement("span", { className: "separator" }, "·"),
          createElement("span", { className: "total" }, 2),
          " ",
          createElement("span", { className: "pass" }, "(", 100, "%)")))),
    createElement("div", { className: "driving-parity-kpi-item driving-parity-kpi-section" },
      scenarioIcon,
      createElement("div", { className: "driving-parity-kpi-text" },
        createElement("div", { className: "driving-parity-kpi-heading" }, "Elapsed"),
        createElement("div", { className: "driving-parity-kpi-ratio" }, "20m"))),
    createElement("div", { className: "driving-parity-kpi-item driving-parity-kpi-section" },
      scenarioIcon,
      createElement("div", { className: "driving-parity-kpi-text" },
        createElement("div", { className: "driving-parity-kpi-heading" }, "Avg pace"),
        createElement("div", { className: "driving-parity-kpi-ratio" }, "10m"))),
    createElement("div", { className: "driving-parity-kpi-item driving-parity-kpi-section" },
      scenarioIcon,
      createElement("div", { className: "driving-parity-kpi-text" },
        createElement("div", { className: "driving-parity-kpi-heading" }, "Time left"),
        createElement("div", { className: "driving-parity-kpi-ratio" }, "--"))));

  assert.equal(renderToStaticMarkup(strip), expected);
  assert.equal(renderToString(strip), renderToString(frozenReferenceStrip));
});
