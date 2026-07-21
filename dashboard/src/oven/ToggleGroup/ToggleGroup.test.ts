import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { assertDomEquivalent } from "../test-support/dom-normalize";
import { ToggleGroup } from "./ToggleGroup";

test("ToggleGroup renders the generic group wrapper", () => {
  const actual = renderToStaticMarkup(createElement(
    ToggleGroup,
    {
      id: "example-toggle",
      className: "chart-toggle differential-tabs",
      ariaLabel: "Example chart mode",
    },
    createElement("button", { type: "button" }, "Current"),
  ));

  assertDomEquivalent(
    actual,
    '<div id="example-toggle" class="chart-toggle differential-tabs" role="group" aria-label="Example chart mode"><button type="button">Current</button></div>',
  );
});
