import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { ArrowLeft } from "lucide-react";
import { VerdictHeader } from "./VerdictHeader";

function FrozenVerdictHeader({ targetPass, framesCount, error }) {
  return createElement(
    "header",
    { className: "visual-parity-heading" },
    createElement("a", { className: "visual-parity-back", href: "/" }, createElement(ArrowLeft, { "aria-hidden": "true" }), "Burnlists"),
    createElement(
      "div",
      null,
      createElement("div", { className: `visual-parity-verdict ${targetPass ? "pass" : "fail"}` }, targetPass ? "Target qualified" : "Target open"),
      createElement("p", null, framesCount, " settled frames · isolated render passes · live refresh"),
    ),
    error && createElement("span", { className: "visual-parity-refresh-error" }, error),
  );
}

test("VerdictHeader matches the qualified state with a refresh error", () => {
  const props = { targetPass: true, framesCount: 3, error: "Refresh delayed." };
  assert.equal(renderToString(createElement(VerdictHeader, props)), renderToString(createElement(FrozenVerdictHeader, props)));
});

test("VerdictHeader matches the open state without a refresh error", () => {
  const props = { targetPass: false, framesCount: 1, error: "" };
  assert.equal(renderToString(createElement(VerdictHeader, props)), renderToString(createElement(FrozenVerdictHeader, props)));
});
