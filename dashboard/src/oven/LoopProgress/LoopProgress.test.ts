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
      hostTask: "claimed",
      budget: { limits: { maxRounds: 1, maxMinutes: 1, maxAgentRuns: 1, maxCheckRuns: 1, maxTransitions: 1, maxOutputBytes: 1 },
        counters: { rounds: 0, agentRuns: 0, checkRuns: 0, transitions: 0, outputBytes: 0 },
        elapsedMilliseconds: 0, journal: { maximum: 1, used: 0, remaining: 1 } },
      latestResult: null, graph, transitions: [],
    },
  } as any;
}

test("pending assigned work answers what is happening and hides every empty telemetry section", () => {
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data: fixture("H3") }));
  assert.match(markup, />H3 · Accept reports</u);
  assert.match(markup, />PENDING</u);
  assert.match(markup, /No agent is working on this item yet\. Its Review Loop is assigned and ready to start\./u);
  assert.match(markup, />ASSIGNED LOOP <small>Review Loop</u);
  assert.match(markup, /aria-label="Assigned Loop for H3"/u);
  for (const clutter of ["RIGHT NOW", "More details", "AGENT", "TIME", "TOKENS", "ACTIVITY", "PROVENANCE", "SYSTEM FLOW", "Declared files"]) {
    assert.doesNotMatch(markup, new RegExp(clutter, "u"));
  }
  assert.doesNotMatch(markup, /O0 · Review|Run remains authoritative/u);
});

test("pending direct work stays equally small and plain", () => {
  const data = fixture("O0");
  data.loopRun = null;
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data }));
  assert.match(markup, /No agent is working on this item yet\. It is waiting to be started as direct work\./u);
  assert.match(markup, />ASSIGNED LOOP <small>Direct work</u);
  assert.match(markup, /This item uses direct work; no Loop is assigned\./u);
  assert.doesNotMatch(markup, /More details|Unavailable|observational|forecast/u);
});

test("active work reveals only populated decision-useful facts", () => {
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data: fixture("O0") }));
  assert.match(markup, />ACTIVE</u);
  assert.match(markup, /Work is active at Review\. No recent activity is available\./u);
  assert.match(markup, />RIGHT NOW</u);
  assert.match(markup, />Current step <small>canonical<\/small><\/dt><dd>Review</u);
  assert.match(markup, />Proof <small>canonical<\/small><\/dt><dd>review waiting</u);
  assert.match(markup, />More details</u);
  assert.match(markup, />Run <small>canonical<\/small><\/dt><dd>run-1 · running · claim claimed</u);
  assert.doesNotMatch(markup, />Agent <small>|>Latest activity <small>|>Tokens <small>|>Estimate <small>|>Retries <small>/u);
});

test("waiting work explains the next human action without inventing an active agent", () => {
  const data = fixture("O0");
  data.loopRun.hostTask = "awaiting-claim";
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data }));
  assert.match(markup, />WAITING</u);
  assert.match(markup, /Review is ready and waiting for an agent to claim it\./u);
  assert.match(markup, />Current step <small>canonical/u);
  assert.doesNotMatch(markup, />Agent <small>|recent activity<\/em>/u);
});

test("blocked work puts the canonical blocker before all secondary detail", () => {
  const data = fixture("O0");
  data.loopRun.diagnostic = "stale";
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data }));
  assert.match(markup, />BLOCKED</u);
  assert.match(markup, /Work is blocked: Canonical Run projection is unavailable\./u);
  assert.match(markup, />Needs attention <small>canonical<\/small><\/dt><dd>Canonical Run projection is unavailable\./u);
  assert.match(markup, />More details</u);
  assert.doesNotMatch(markup, />Agent <small>|>Latest activity <small>|Unavailable/u);
});

test("bounded activity and observed agent facts appear only when present", () => {
  const data = fixture("O0");
  data.loopRun.activity = { hooks: "available", records: Array.from({ length: 12 }, (_, index) => ({
    at: index, origin: index % 2 ? "host-hook" : "agent-reported", kind: index % 2 ? "subagent-started" : "tool-finished",
    nodeId: "review", attempt: 1, provider: index % 2 ? "claude" : "codex", model: index === 11 ? "model-x" : undefined,
    effort: index === 11 ? "medium" : undefined, subagentId: index % 2 ? `child-${index}` : undefined,
    tool: index % 2 ? undefined : "node-test", observedPath: index % 2 ? `src/subagents/${index}.mjs` : "src/loops/run/binder.mjs",
    truncated: index === 11,
  })) };
  const markup = renderToStaticMarkup(createElement(LoopProgress, { data }));
  assert.match(markup, />Agent <small>observed<\/small><\/dt><dd>claude · model-x · effort medium</u);
  assert.match(markup, />Latest activity <small>observed/u);
  assert.match(markup, /Recent observed activity/u);
  assert.match(markup, />Changed paths <small>observed/u);
  assert.match(markup, /src\/loops\/run\/binder\.mjs/u);
  assert.equal((markup.match(/subagent child-/gu) ?? []).length + (markup.match(/node-test/gu) ?? []).length, 11);
  assert.equal((markup.match(/class="loop-progress__activity"/gu) ?? []).length, 1);
});

test("timing, reported tokens, and forecasts remain labelled secondary facts", () => {
  const data = fixture("O0");
  data.loopRun.activity = { hooks: "available", records: [{
    at: 91_000, origin: "host-hook", kind: "agent-started", provider: "codex",
    nodeId: "review", attempt: 1, model: "gpt-test", effort: "medium", inputTokens: 1_200, outputTokens: 300,
  }] };
  data.loopRun.createdAt = 1_000;
  data.loopRun.budget.elapsedMilliseconds = 2_000;
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
  assert.match(markup, />Elapsed <small>observed<\/small><\/dt><dd>1\.5 min</u);
  assert.match(markup, />Tokens <small>reported<\/small><\/dt><dd>1,500 reported</u);
  assert.match(markup, />Estimate <small>forecast<\/small><\/dt><dd>1 min–3 min · 2,000–9,000 tokens · medium · 5 local observations</u);
  assert.match(markup, /Status, current step, proof, blocker, and retries come from the canonical Burnlist Run/u);
  assert.doesNotMatch(markup, /\$|cost estimate/u);
  assert.equal(data.loopRun.budget.elapsedMilliseconds, 2_000);
});

test("activity viewport retains its bounded ten-row height inside details", async () => {
  const css = await readFile("dashboard/src/oven/LoopProgress/LoopProgress.css", "utf8");
  assert.match(css, /\.loop-progress__activity ol \{[^}]*block-size: 150px;[^}]*overflow: hidden;/su);
  assert.match(css, /\.loop-progress__activity li \{[^}]*min-height: 15px;[^}]*line-height: 15px;/su);
});
