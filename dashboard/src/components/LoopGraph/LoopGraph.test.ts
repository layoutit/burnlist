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

test("renders bounded provenance-labelled activity and explicit hook availability", () => {
  const html = renderToStaticMarkup(createElement(LoopGraph, { run: projection({
    activity: {
      hooks: "available",
      records: [
        { at: 1, origin: "runner", kind: "claimed", nodeId: "verify", attempt: 1 },
        { at: 2, origin: "host-hook", kind: "subagent-started", provider: "claude", nodeId: "verify", attempt: 1, subagentId: "review-1", parentAgentId: "host-1" },
        { at: 3, origin: "agent-reported", kind: "tool-finished", provider: "codex", nodeId: "verify", attempt: 1, tool: "node-test", outcome: "pass" },
      ],
    },
  }) }));
  assert.match(html, /aria-label="Recent Loop activity"/u);
  assert.match(html, /ACTIVITY · HOOKS AVAILABLE/u);
  assert.match(html, /host-hook<\/span><strong>subagent-started<\/strong><span>subagent review-1/u);
  assert.match(html, /agent-reported<\/span><strong>tool-finished<\/strong><span>tool node-test → pass/u);
  const unavailable = renderToStaticMarkup(createElement(LoopGraph, { run: projection({ activity: { hooks: "unavailable", records: [] } }) }));
  assert.match(unavailable, /HOOKS UNAVAILABLE/u);
  assert.match(unavailable, /No activity reported/u);
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

test("compact topology keeps the serial dogfood Loop labelled within tablet width", () => {
  const run = projection({
    currentNode: "review",
    graph: {
      entry: "start",
      nodes: [
        { id: "start", kind: "agent", role: "maker", authority: "write" },
        { id: "decompose", kind: "agent", role: "maker", authority: "write" },
        { id: "implement", kind: "agent", role: "maker", authority: "write" },
        { id: "validate", kind: "check", measure: "test", capability: "repo-verify" },
        { id: "review", kind: "agent", role: "reviewer", authority: "read" },
        { id: "integrate", kind: "agent", role: "maker", authority: "write" },
        { id: "final-validate", kind: "check", measure: "test", capability: "repo-verify" },
        { id: "final-review", kind: "agent", role: "reviewer", authority: "read" },
        { id: "converged", kind: "gate", gateKind: "convergence" },
        { id: "completed", kind: "terminal", terminalState: "converged" },
      ],
      edges: [
        { from: "start", on: "complete", to: "decompose" },
        { from: "decompose", on: "complete", to: "implement" },
        { from: "implement", on: "complete", to: "validate" },
        { from: "validate", on: "pass", to: "review" },
        { from: "validate", on: "fail", to: "decompose" },
        { from: "review", on: "approve", to: "integrate" },
        { from: "integrate", on: "complete", to: "final-validate" },
        { from: "final-validate", on: "pass", to: "final-review" },
        { from: "final-validate", on: "fail", to: "decompose" },
        { from: "final-review", on: "approve", to: "converged" },
        { from: "review", on: "reject", to: "decompose" },
        { from: "final-review", on: "reject", to: "decompose" },
        { from: "converged", on: "pass", to: "completed" },
      ],
    },
  });
  const compact = renderToStaticMarkup(createElement(LoopCompact, { run, labels: "outcomes" }));
  assert.match(compact, /S[\s\S]*D[\s\S]*I[\s\S]*R[\s\S]*F[\s\S]*G[\s\S]*B/u);
  assert.match(compact, /reject/u);
  const drawing = compact.replace(/<[^>]+>/gu, "");
  assert.ok(Math.max(...drawing.split("\n").map((line) => line.length)) < 70);
});
