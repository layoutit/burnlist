import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { test } from "node:test";
import { OvenRuntime, resolveOvenRuntimeInputs } from "./OvenRuntime";

test("controlled payload mode suppresses live snapshot subscriptions", () => {
  const payload = { validated: true };
  assert.deepEqual(resolveOvenRuntimeInputs({
    initialPayload: { stale: true },
    payload,
    refreshSeconds: 2,
  }), {
    inputPayload: payload,
    live: false,
    refreshSeconds: undefined,
  });
});

test("live mode keeps shared snapshots with no payload or an initial payload", () => {
  assert.deepEqual(resolveOvenRuntimeInputs({ refreshSeconds: 2 }), {
    inputPayload: undefined,
    live: true,
    refreshSeconds: 2,
  });

  const initialPayload = { retained: true };
  assert.deepEqual(resolveOvenRuntimeInputs({ initialPayload, refreshSeconds: 2 }), {
    inputPayload: initialPayload,
    live: true,
    refreshSeconds: 2,
  });
});

test("live mode does not require a legacy refresh interval", () => {
  assert.deepEqual(resolveOvenRuntimeInputs({}), {
    inputPayload: undefined,
    live: true,
    refreshSeconds: undefined,
  });
});

test("runtime visibly labels retained canonical data after a refresh failure", () => {
  const ir = { contract: "fixture", controls: [], collections: [], root: [] };
  const markup = renderToStaticMarkup(createElement(OvenRuntime, {
    ir,
    initialPayload: { version: 1 },
    initialAction: { type: "payloadRejected", error: "offline", generation: 0 },
  }));
  assert.match(markup, /role="alert"/u);
  assert.match(markup, /Showing the last canonical snapshot\. offline/u);
});

test("runtime shows canonical missing as an error without old payload", () => {
  const ir = { contract: "fixture", controls: [], collections: [], root: [] };
  const markup = renderToStaticMarkup(createElement(OvenRuntime, {
    ir,
    initialPayload: { version: 1 },
    initialAction: { type: "payloadMissing", error: "Oven is unbound.", generation: 0 },
  }));
  assert.match(markup, /role="alert"/u);
  assert.match(markup, /Oven is unbound\./u);
  assert.doesNotMatch(markup, /Showing the last canonical snapshot/u);
});
