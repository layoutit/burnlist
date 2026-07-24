import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoopCompact } from "./LoopCompact";
import { LoopGraph, type LoopGraphProjection } from "./LoopGraph";
import { LoopLegend } from "./LoopLegend";

function projection(overrides: Partial<LoopGraphProjection> = {}): LoopGraphProjection {
  return {
    loopId: "loop:builtin:review",
    state: "running",
    currentNode: "verify",
    attempt: 1,
    cycle: 0,
    graph: {
      nodes: [
        { id: "implement", kind: "agent", role: "implementer", authority: "write" },
        { id: "verify", kind: "check", measure: "test", capability: "repo-verify" },
        { id: "review", kind: "agent", role: "reviewer", authority: "read" },
      ],
      edges: [{ from: "implement", on: "success", to: "verify" }, { from: "verify", on: "success", to: "review" }],
    },
    transitions: [{ sequence: 1, from: "implement", outcome: "success", to: "verify" }],
    ...overrides,
  };
}

test("highlights exactly the active node with accessible current state", () => {
  const html = renderToStaticMarkup(createElement(LoopGraph, { run: projection() }));
  assert.match(html, /data-loop-state="running"/);
  assert.match(html, /aria-current="step"[^>]*>.*VERIFY/s);
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.match(html, /\+---/);
  assert.match(html, /───▶/);
  assert.match(html, /ACTIVE: VERIFY · test · repo-verify/);
});

test("classifies prepared, repair, converged, and error presentations", () => {
  const states = [
    [projection({ state: "prepared", currentNode: "implement" }), "prepared"],
    [projection({ cycle: 2, currentNode: "implement" }), "repair"],
    [projection({ state: "converged", currentNode: "review" }), "converged"],
    [projection({ state: "needs-human", currentNode: "review" }), "error"],
  ] as const;
  for (const [run, expected] of states) {
    assert.match(renderToStaticMarkup(createElement(LoopGraph, { run })), new RegExp(`data-loop-state="${expected}"`));
  }
});

test("renders a diagnostic without requiring a run projection", () => {
  const html = renderToStaticMarkup(createElement(LoopGraph, { diagnostic: "corrupt", message: "Journal could not be verified." }));
  assert.match(html, /role="alert"/);
  assert.match(html, /Journal could not be verified/);
  assert.match(html, /LOOP UNAVAILABLE/);
});

test("compact topology and legend remain independently composable", () => {
  const run = projection();
  run.graph.edges.push({ from: "verify", on: "fail", to: "implement" });
  const compact = renderToStaticMarkup(createElement(LoopCompact, { run }));
  const legend = renderToStaticMarkup(createElement(LoopLegend, { run }));
  assert.match(compact, /I.*▶.*V.*▶.*R/u);
  assert.match(compact, /aria-current="step">V/u);
  assert.doesNotMatch(compact, /repo-verify/u);
  assert.match(compact, /▲/u);
  assert.match(compact, /└/u);
  assert.match(legend, /<dt>V<\/dt><dd><strong>VERIFY<\/strong> · test · repo-verify/u);
  const labeled = renderToStaticMarkup(createElement(LoopCompact, {
    run, labels: "outcomes", symbols: { implement: "M", verify: "T" },
  }));
  assert.match(labeled, /M.*success.*T/u);
  assert.match(labeled, /fail/u);
});
