import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ClipboardList } from "lucide-react";
import { DomainNote } from "../DomainNote/DomainNote";
import { MetricTiles } from "../MetricTiles/MetricTiles";
import { KpiItem } from "../KpiItem/KpiItem";
import { ProgressDonut } from "../ProgressDonut/ProgressDonut";
import { OvenView } from "./OvenView";

function render(def, payload) {
  return renderToString(createElement(OvenView, { def, payload }));
}

test("resolves declarative component props to the handwritten markup", () => {
  const payload = {
    total: 3,
    summary: { passed: 2, ratio: 0.001234, meanAbsoluteDelta: 0.12, maximumAbsoluteDelta: 7, isTarget: true, rationale: "Target evidence" },
  };
  const def = {
    sections: [{
      key: "metrics",
      element: "div",
      className: "visual-parity-content",
      cells: [
        {
          component: "MetricTiles",
          key: "metrics",
          bind: {
            passed: { source: "/summary/passed" },
            total: { source: "/total" },
            ratio: { source: "/summary/ratio" },
            meanAbsoluteDelta: { source: "/summary/meanAbsoluteDelta" },
            maximumAbsoluteDelta: { source: "/summary/maximumAbsoluteDelta" },
          },
        },
        {
          component: "DomainNote",
          key: "note",
          bind: { isTarget: { source: "/summary/isTarget" }, rationale: { source: "/summary/rationale" } },
        },
      ],
    }],
  };
  const props = { passed: 2, total: 3, ratio: 0.001234, meanAbsoluteDelta: 0.12, maximumAbsoluteDelta: 7 };
  const expected = createElement(
    "div",
    { className: "visual-parity-content" },
    createElement(MetricTiles, props),
    createElement(DomainNote, { isTarget: true, rationale: "Target evidence" }),
  );

  assert.equal(render(def, payload), renderToString(expected));
});

test("renders nested component and text slots byte-equivalently", () => {
  const def = {
    sections: [{
      key: "progress",
      element: "div",
      className: "kpi-content",
      cells: [{
        component: "KpiItem",
        key: "progress",
        props: { className: "kpi-item", heading: "Progress", title: "Current progress" },
        slots: {
          visual: { component: "ProgressDonut", bind: { percent: { source: "/percent" } } },
          value: { text: "72%" },
        },
      }],
    }],
  };
  const expected = createElement(
    "div",
    { className: "kpi-content" },
    createElement(KpiItem, {
      className: "kpi-item",
      heading: "Progress",
      title: "Current progress",
      visual: createElement(ProgressDonut, { percent: 72 }),
      value: "72%",
    }),
  );

  assert.equal(render(def, { percent: 72 }), renderToString(expected));
});

test("resolves a named icon slot to the matching handwritten element", () => {
  const iconProps = { "aria-hidden": "true", className: "driving-parity-kpi-gauge driving-parity-kpi-scenario-icon" };
  const def = {
    sections: [{
      key: "current-section",
      element: "div",
      cells: [{
        component: "KpiItem",
        key: "current",
        props: { className: "kpi-item", heading: "Current" },
        slots: { visual: { icon: "ClipboardList" }, value: { text: "Complete" } },
      }],
    }],
  };
  const expected = createElement("div", null, createElement(KpiItem, {
    className: "kpi-item",
    heading: "Current",
    visual: createElement(ClipboardList, iconProps),
    value: "Complete",
  }));

  assert.equal(render(def, {}), renderToString(expected));
});

test("applies named format transforms before passing bound props", () => {
  const def = {
    sections: [{
      key: "formatted-note",
      element: "div",
      cells: [{ key: "formatted-note", component: "DomainNote", props: { isTarget: true }, bind: { rationale: { source: "/ratio", format: "percent" } } }],
    }],
  };
  const expected = createElement("div", null, createElement(DomainNote, { isTarget: true, rationale: "12.35%" }));

  assert.equal(render(def, { ratio: 0.12345 }), renderToString(expected));
});

test("rejects unknown registry keys", () => {
  assert.throws(() => render({ sections: [{ cells: [{ component: "MissingComponent" }] }] }, {}), /Unknown oven component: MissingComponent/u);
  assert.throws(() => render({ sections: [{ cells: [{ component: "DomainNote", bind: { rationale: { source: "/value", format: "missing" } } }] }] }, { value: "x" }), /Unknown oven format: missing/u);
  assert.throws(() => render({ sections: [{ cells: [{ component: "KpiItem", slots: { visual: { icon: "MissingIcon" } } }] }] }, {}), /Unknown oven icon: MissingIcon/u);
  assert.throws(() => render({ sections: [{ cells: [{ component: "toString" }] }] }, {}), /Unknown oven component: toString/u);
  assert.throws(() => render({ sections: [{ cells: [{ component: "DomainNote", bind: { rationale: { source: "/value", format: "toString" } } }] }] }, { value: "x" }), /Unknown oven format: toString/u);
  assert.throws(() => render({ sections: [{ cells: [{ component: "KpiItem", slots: { visual: { icon: "toString" } } }] }] }, {}), /Unknown oven icon: toString/u);
});
