import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { log as vanillaLog } from "../differential-testing-render/differential-testing-render.js";
import { assertDomEquivalent, extractFirstByClass } from "../test-support/dom-normalize";
import { buildDifferentialLogRows, DifferentialLogTable, type DifferentialLogEntry } from "./DifferentialLogTable";

const FIXED_NOW = Date.parse("2026-01-01T12:30:00.000Z");
const goldenDir = resolve("dashboard/src/oven/differential-testing-render/goldens");
const goldenHarnessPath = resolve("dashboard/src/oven/differential-testing-render/golden-harness.mjs");

function withGoldenEnvironment<T>(callback: () => T): T {
  const previousTz = process.env.TZ;
  const previousDateNow = Date.now;
  process.env.TZ = "UTC";
  Date.now = () => FIXED_NOW;
  try {
    return callback();
  } finally {
    Date.now = previousDateNow;
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  }
}

function logListOrNull(html: string): string | null {
  try {
    return extractFirstByClass(html, "checklist-log-list");
  } catch (error) {
    if (error instanceof Error && error.message.includes("was not found")) return null;
    throw error;
  }
}

function render(entries: DifferentialLogEntry[], now = FIXED_NOW): string {
  return renderToStaticMarkup(createElement(DifferentialLogTable, { entries, now }));
}

test("DifferentialLogTable uses fresh columns and LogTable's default class", () => {
  const entries: DifferentialLogEntry[] = [];
  const first = buildDifferentialLogRows(entries, FIXED_NOW);
  const second = buildDifferentialLogRows(entries, FIXED_NOW);

  assert.notStrictEqual(first.columns, second.columns);
  assert.match(render(entries), /^<div class="checklist-log-list">/);
});

test("DifferentialLogTable matches the vanilla log oracle for edge-shaped entries", () => {
  const entries: DifferentialLogEntry[] = [
    { timestamp: "2026-01-01T12:29:00.000Z", frame: 1_234_567, frames: 2_000_000, frameDelta: 12_345 },
    { timestamp: "2026-01-01T12:00:00.000Z", frame: "900", frames: 1_000, frameDelta: -250 },
    { timestamp: "2026-01-01T11:30:00.000Z", frame: 42, frames: 100, frameDelta: 0 },
    { timestamp: "2026-01-01T11:00:00.000Z", frame: 7, frames: 100, frameDelta: null },
    { timestamp: "2026-01-01T10:30:00.000Z", frame: 8, frames: 100, frameDelta: "Infinity" },
    { timestamp: "2026-01-01T10:00:00.000Z", frame: Number.MAX_SAFE_INTEGER + 1, frames: 100, frameDelta: 1 },
    { timestamp: "2026-01-01T09:30:00.000Z", frame: 2, frames: 0, frameDelta: 1 },
    { timestamp: "2026-01-01T09:00:00.000Z", frame: 3, frames: 10, frameDelta: 1 },
  ];

  assert.equal(buildDifferentialLogRows(entries, FIXED_NOW).placeholderCount, 0);
  assertDomEquivalent(render(entries), vanillaLog(entries, FIXED_NOW), "edge-shaped log differs");
});

test("DifferentialLogTable matches truncation and placeholder padding", () => {
  const entry = (index: number): DifferentialLogEntry => ({
    timestamp: `2026-01-01T12:${String(index).padStart(2, "0")}:00.000Z`,
    frame: index,
    frames: 10,
    frameDelta: index % 2 ? -1 : 1,
  });
  const fewer = [entry(1), entry(2), entry(3)];
  const more = Array.from({ length: 10 }, (_, index) => entry(index));

  assert.equal(buildDifferentialLogRows(fewer, FIXED_NOW).placeholderCount, 5);
  assert.equal(buildDifferentialLogRows(more, FIXED_NOW).rows.length, 8);
  assertDomEquivalent(render(fewer), vanillaLog(fewer, FIXED_NOW), "padded log differs");
  assertDomEquivalent(render(more), vanillaLog(more, FIXED_NOW), "truncated log differs");
});

test("DifferentialLogTable matches every full-dashboard golden log slice", async () => {
  const harness = await import(goldenHarnessPath);
  const states = new Map<string, () => { log: DifferentialLogEntry[] }>([
    ["dt-main", harness.differentialTestingPayload],
    ["dt-scenario-multi", harness.differentialTestingMultiScenarioPayload],
    ["dt-row-expanded", harness.differentialTestingPayload],
    ["dt-server-paged", harness.differentialTestingPayload],
    ["dt-sorted-filtered-paged", harness.differentialTestingPayload],
    ["dt-telemetry-incomparable", harness.differentialTestingIncomparableTelemetryPayload],
    ["dt-comparable-telemetry", harness.differentialTestingComparableTelemetryPayload],
    ["dt-comparable-no-changed", harness.differentialTestingComparableNoChangedPayload],
    ["dt-paginated", harness.differentialTestingPaginatedPayload],
    ["dt-paginated-mid", harness.differentialTestingPaginatedMidPayload],
    ["dt-no-match", harness.differentialTestingAllPassingPayload],
    ["dt-chart-current-failed", harness.differentialTestingPayload],
    ["dt-progress-mode", harness.differentialTestingPayload],
    ["pt-main", harness.performanceTracingPayload],
    ["pt-progress", harness.performanceTracingPayload],
    ["pt-failed", harness.performanceTracingPayload],
  ]);

  withGoldenEnvironment(() => {
    for (const fileName of readdirSync(goldenDir).filter((name) => name.endsWith(".html")).sort()) {
      const name = fileName.slice(0, -5);
      const goldenLog = logListOrNull(readFileSync(resolve(goldenDir, fileName), "utf8"));
      if (!goldenLog) continue;
      const payloadBuilder = states.get(name);
      assert.ok(payloadBuilder, `missing harness mapping for ${name}`);
      const entries = payloadBuilder().log;
      const actual = render(entries, FIXED_NOW);
      assertDomEquivalent(actual, vanillaLog(entries, FIXED_NOW), `${name} differs from vanilla log`);
      assertDomEquivalent(actual, goldenLog, `${name} golden log differs`);
    }
  });
});
