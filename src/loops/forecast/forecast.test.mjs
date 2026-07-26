import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  complexityBand,
  forecastForKey,
  forecastLoopRun,
  recordAcceptedLoopObservation,
} from "./forecast.mjs";
import {
  appendForecastObservation,
  FORECAST_HISTORY_LIMIT,
  readForecastHistory,
} from "./history.mjs";

function fixture(t) {
  const root = mkdtempSync(join(os.tmpdir(), "loop-forecast-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
const key = {
  role: "maker", provider: "codex", model: "gpt-test",
  effort: "low", complexityBand: "medium",
};
function observation(index, overrides = {}) {
  return {
    correlation: `activity-${index}`,
    ...key,
    completedAt: 1_000 + index,
    wallMilliseconds: 1_000 + index * 100,
    workMilliseconds: 1_200 + index * 100,
    inputTokens: 100 + index,
    outputTokens: 20 + index,
    parallelObserved: true,
    provenance: ["semantic-completion", "native-hooks"],
    ...overrides,
  };
}
function correlation(runId, nodeId, attempt, invocationId) {
  return `ac1-sha256:${createHash("sha256")
    .update(`${runId}\0${nodeId}\0${attempt}\0${invocationId}`).digest("hex")}`;
}
function replay({ accepted = true, telemetry = null } = {}) {
  const runId = "run:01arz3ndektsv4rrffq69g5fav";
  const claim = { claimId: "hc1-sha256:" + "a".repeat(64), nodeId: "make", attempt: 1 };
  const invocationId = "b".repeat(32);
  const journal = [{
    value: {
      at: 100, type: "external-claim-bound",
      payload: { claim, invocationId },
    },
  }];
  if (accepted) journal.push({
    value: {
      at: 2_000, type: "external-report-accepted",
      payload: {
        claimId: claim.claimId, reportDigest: "sha256:" + "c".repeat(64),
        telemetry,
      },
    },
  });
  return {
    value: {
      runId, graph: { nodes: [{
        id: "make", kind: "agent", role: "maker", intelligence: "standard",
      }] },
      journal,
    },
    claim,
    invocationId,
    correlation: correlation(runId, "make", 1, invocationId),
  };
}

test("empty local history uses explicit low-confidence priors without invented cost", (t) => {
  const root = fixture(t);
  const forecast = forecastForKey(readForecastHistory(root), key);
  assert.equal(forecast.provenance.kind, "built-in-prior");
  assert.equal(forecast.confidence, "low");
  assert.equal(forecast.wallTime.sampleCount, 0);
  assert.equal(forecast.totalTokens.sampleCount, 0);
  assert.equal(forecast.cost, null);
  assert.equal(forecast.costProvenance, "unavailable");
});

test("robust ranges calibrate only against the exact role/provider/model/effort key", (t) => {
  const root = fixture(t);
  for (let index = 0; index < 3; index += 1) {
    appendForecastObservation(root, observation(index));
  }
  appendForecastObservation(root, observation(9, { model: "another-model" }));
  const forecast = forecastForKey(readForecastHistory(root), key);
  assert.equal(forecast.provenance.kind, "local-observations");
  assert.equal(forecast.provenance.matchingObservations, 3);
  assert.equal(forecast.confidence, "medium");
  assert.deepEqual(
    { low: forecast.wallTime.low, high: forecast.wallTime.high },
    { low: 800, high: 1320 },
  );
  assert.equal(forecast.totalTokens.sampleCount, 3);
  assert.equal(forecast.provenance.parallelObservations, 3);
});

test("a run forecast carries route facts when hook facts are unavailable", (t) => {
  const root = fixture(t);
  const value = forecastLoopRun({
    repoRoot: root,
    replay: {
      execution: {
        terminal: false,
        node: { kind: "agent", role: "reviewer", intelligence: "strong", route: "review.strong" },
      },
      agentRoutes: [{
        route: "review.strong", adapter: "codex", model: "gpt-strong", effort: "high",
      }],
    },
  });
  assert.deepEqual(value.key, {
    role: "reviewer", provider: "codex", model: "gpt-strong",
    effort: "high", complexityBand: "high",
  });
  assert.equal(complexityBand({ intelligence: "fast" }), "low");
});

test("learning occurs only after semantic acceptance and preserves parallel work", (t) => {
  const root = fixture(t);
  const pending = replay({ accepted: false });
  assert.equal(recordAcceptedLoopObservation({
    repoRoot: root, replay: pending.value, claimId: pending.claim.claimId,
  }), null);
  assert.equal(existsSync(join(root, ".local", "burnlist", "loop-forecast-history.json")), false);

  const accepted = replay();
  const result = recordAcceptedLoopObservation({
    repoRoot: root,
    replay: accepted.value,
    claimId: accepted.claim.claimId,
    optionalRecords: [
      {
        correlation: accepted.correlation, kind: "agent-started", at: 1_000,
        durationMilliseconds: null, provider: "codex", model: "gpt-test", effort: "low",
        inputTokens: null, outputTokens: null,
      },
      {
        correlation: accepted.correlation, kind: "tool-finished", at: 1_800,
        durationMilliseconds: 1_500, provider: "codex", model: "gpt-test", effort: "low",
        inputTokens: 100, outputTokens: 20,
      },
      {
        correlation: accepted.correlation, kind: "agent-finished", at: 1_700,
        durationMilliseconds: 300, provider: "codex", model: "gpt-test", effort: "low",
        inputTokens: 50, outputTokens: 10,
      },
    ],
  });
  assert.equal(result.created, true);
  assert.equal(result.observation.completedAt, 2_000);
  assert.equal(result.observation.wallMilliseconds, 800);
  assert.equal(result.observation.workMilliseconds, 1_800);
  assert.equal(result.observation.parallelObserved, true);
  assert.equal(result.observation.inputTokens, 150);
  assert.equal(result.observation.outputTokens, 30);
  assert.equal(recordAcceptedLoopObservation({
    repoRoot: root, replay: accepted.value, claimId: accepted.claim.claimId,
    optionalRecords: [],
  }), null);
  assert.equal(readForecastHistory(root).observations.length, 1);
});

test("host telemetry is attributable while missing token facts stay missing", (t) => {
  const root = fixture(t);
  const telemetry = {
    provider: "claude", model: "sonnet", effort: null,
    startedAt: 1_000, completedAt: 1_900,
    inputTokens: null, outputTokens: null,
  };
  const accepted = replay({ telemetry });
  const result = recordAcceptedLoopObservation({
    repoRoot: root, replay: accepted.value, claimId: accepted.claim.claimId,
  });
  assert.equal(result.observation.wallMilliseconds, 900);
  assert.equal(result.observation.workMilliseconds, 900);
  assert.equal(result.observation.inputTokens, null);
  assert.equal(result.observation.outputTokens, null);
  const forecast = forecastForKey(readForecastHistory(root), {
    role: "maker", provider: "claude", model: "sonnet",
    effort: null, complexityBand: "medium",
  });
  assert.equal(forecast.totalTokens.sampleCount, 0);
  assert.equal(forecast.cost, null);
});

test("private history is canonical, bounded, deduplicated, and stores no raw content", (t) => {
  const root = fixture(t);
  for (let index = 0; index < FORECAST_HISTORY_LIMIT + 2; index += 1) {
    appendForecastObservation(root, observation(index));
  }
  const history = readForecastHistory(root);
  assert.equal(history.observations.length, FORECAST_HISTORY_LIMIT);
  assert.equal(history.observations[0].completedAt, 1_002);
  const text = readFileSync(join(root, ".local", "burnlist", "loop-forecast-history.json"), "utf8");
  assert.equal(text.endsWith("\n"), true);
  for (const forbidden of ["correlation", "prompt", "session", "path", "pricing"]) {
    assert.equal(text.includes(forbidden), false);
  }
});
