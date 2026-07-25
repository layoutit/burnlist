import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LoopProgress } from "./LoopProgress";

const graph = {
  entry: "make",
  nodes: [
    { id: "make", kind: "agent", role: "Maker" },
    { id: "review", kind: "agent", role: "Review" },
  ],
  edges: [{ from: "make", on: "complete", to: "review" }],
};

function fixture(selectedItemId: string) {
  return {
    generatedAt: "2026-07-24T20:00:00Z",
    repoKey: "0123456789ab",
    title: "Progress",
    repo: "burnlist",
    planLabel: "inprogress",
    selectedItemId,
    total: 2, done: 0, remaining: 2, percent: 0, warnings: [], completed: [], history: [],
    active: [
      { id: "O0", title: "Seed Oven", fields: { Action: "Show the work simply.", "Files/search": "ovens/ dashboard/src/oven/" }, loop: null },
      { id: "H3", title: "Accept reports", fields: { Action: "Bind results safely.", "Files/search": "src/loops/run/" },
        loop: { selector: "loop:builtin:review", assignmentId: "a", executionRevision: "e", packageRevision: "p", graph } },
    ],
    loopRun: {
      schema: "burnlist-loop-read-projection@1", runId: "run-1", itemRef: "item:260724-002#O0",
      loopId: "loop:builtin:review", loopRevision: null, createdAt: 1, updatedAt: 2,
      state: "running", currentNode: "review", attempt: 1, cycle: 0, revision: "r",
      budget: { limits: { maxRounds: 1, maxMinutes: 1, maxAgentRuns: 1, maxCheckRuns: 1, maxTransitions: 1, maxOutputBytes: 1 },
        counters: { rounds: 0, agentRuns: 0, checkRuns: 0, transitions: 0, outputBytes: 0 },
        elapsedMilliseconds: 1, journal: { maximum: 1, used: 0, remaining: 1 } },
      latestResult: null, graph, transitions: [],
    },
  } as any;
}

test("shows low-text canonical context and never fabricates hook activity", () => {
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data: fixture("O0") }));
  for (const label of ["NOW", "WHY", "SYSTEM", "FILES", "HOOKS"]) assert.match(markup, new RegExp(`>${label}<`, "u"));
  for (const label of ["LOOP", "SYSTEM FLOW"]) assert.match(markup, new RegExp(`>${label} `, "u"));
  assert.match(markup, />O0 · Review</u);
  assert.match(markup, />Observer</u);
  assert.match(markup, /Makes truthful progress easy to see/u);
  assert.doesNotMatch(markup, /Show the work simply/u);
  assert.match(markup, /Unavailable/u);
  assert.doesNotMatch(markup, /recently touched|observed file/u);
});

test("selection changes declared context without changing the authoritative Run node", () => {
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data: fixture("H3") }));
  assert.match(markup, />O0 · Review</u);
  assert.match(markup, />CONTEXT</u);
  assert.match(markup, />H3 · Accept reports</u);
  assert.match(markup, /src\/loops\/run\//u);
  assert.match(markup, /Keeps each step controlled and verifiable/u);
  assert.doesNotMatch(markup, /Bind results safely/u);
  assert.match(markup, /Run remains authoritative for another item/u);
  assert.match(markup, /Loop for H3/u);
  assert.match(markup, /<li class=" is-running"><span><strong>Validate \+ review<\/strong>/u);
  assert.match(markup, /<li class=""><span><strong>Agent \+ workspace<\/strong>/u);
  assert.match(markup, /class="is-active"/u);
});

test("technical host-report actions become simple subsystem WHY text", () => {
  const data = fixture("H3");
  data.active[1].fields.Action = "Validate an external report against its durable claim, rederive candidate identity, append the result exactly once, and select a declared edge.";
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data }));
  assert.match(markup, /Keeps each step controlled and verifiable/u);
  assert.doesNotMatch(markup, /durable claim|candidate identity|declared edge/u);
});

test("renders only bounded provenance-labelled sanitized activity", () => {
  const data = fixture("O0");
  data.loopRun.activity = { hooks: "available", records: Array.from({ length: 12 }, (_, index) => ({
    at: index, origin: index % 2 ? "host-hook" : "agent-reported", kind: index % 2 ? "subagent-started" : "tool-finished",
    nodeId: "review", attempt: 1, provider: index % 2 ? "claude" : "codex", subagentId: index % 2 ? `child-${index}` : undefined,
    tool: index % 2 ? undefined : "node-test", observedPath: index % 2 ? `src/subagents/${index}.mjs` : "src/loops/run/binder.mjs", truncated: index === 11,
  })) };
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data }));
  assert.match(markup, />ACTIVITY </u);
  assert.match(markup, />HOOKS<\/span><p>available</u);
  assert.match(markup, /host-hook/u);
  assert.match(markup, /subagent child-11/u);
  assert.match(markup, /agent-reported/u);
  assert.match(markup, /node-test/u);
  assert.match(markup, /truncated/u);
  assert.match(markup, />10 recent</u);
  assert.match(markup, />OBSERVED</u);
  assert.match(markup, /src\/loops\/run\/binder\.mjs/u);
  assert.doesNotMatch(markup, /FILES<\/span>.*src\/loops\/run\/binder\.mjs/u);
  assert.equal((markup.match(/class="loop-progress__activity"/gu) ?? []).length, 1);
  assert.equal((markup.match(/subagent child-/gu) ?? []).length + (markup.match(/node-test/gu) ?? []).length, 10);
});

test("shows observed agent facts, elapsed time, and forecast provenance", () => {
  const data = fixture("O0");
  data.loopRun.activity = { hooks: "available", records: [{
    at: 1, origin: "host-hook", kind: "agent-started", provider: "codex",
    nodeId: "review", attempt: 1, model: "gpt-test", effort: "medium",
  }] };
  data.loopRun.budget.elapsedMilliseconds = 125_000;
  data.loopRun.forecast = {
    schema: "burnlist-loop-forecast@1",
    key: { role: "reviewer", provider: "codex", model: "gpt-test", effort: "medium", complexityBand: "high" },
    wallTime: { low: 60_000, high: 180_000, sampleCount: 5, unit: "milliseconds" },
    aggregateWork: { low: 90_000, high: 240_000, sampleCount: 5, unit: "milliseconds" },
    totalTokens: { low: 2_000, high: 9_000, sampleCount: 4, unit: "tokens" },
    confidence: "medium",
    provenance: { kind: "local-observations", matchingObservations: 5, tokenObservations: 4, parallelObservations: 2 },
    cost: null,
    costProvenance: "unavailable",
  };
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data }));
  for (const label of ["AGENT", "ELAPSED", "FORECAST", "PROVENANCE"]) {
    assert.match(markup, new RegExp(`>${label}<`, "u"));
  }
  assert.match(markup, /codex · gpt-test · effort medium/u);
  assert.match(markup, /2.1 min/u);
  assert.match(markup, /wall 1 min–3 min · work 1.5 min–4 min/u);
  assert.match(markup, /medium · 5 local observations · tokens 2,000–9,000/u);
  assert.doesNotMatch(markup, /\$|cost estimate/u);
});

test("activity viewport has a stable ten-row height", async () => {
  const css = await readFile("dashboard/src/oven/LoopProgress/LoopProgress.css", "utf8");
  assert.match(css, /\.loop-progress__activity ol \{[^}]*block-size: 150px;[^}]*overflow: hidden;/su);
  assert.match(css, /\.loop-progress__activity li \{[^}]*min-height: 15px;[^}]*line-height: 15px;/su);
});
