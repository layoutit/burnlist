import { describe, expect, test } from "bun:test";
import {
  FIELD_MINI_CHART_HEIGHT,
  FIELD_MINI_CHART_WIDTH,
  fieldMiniChartModel,
} from "../../../dashboard/src/oven/FieldMiniChart/field-mini-chart-geometry";
import { fieldCardPairLayout } from "./component-pair-layout";
import { terminalSeriesModel } from "../terminal-series-chart-model";

const tuples = [
  [0, 0, 0, 0],
  [1, 1, 1.2, 1],
  [2, 2, 2.1, 0],
] as const;

describe("console/terminal series correspondence", () => {
  test("both renderers consume the same normalized ordered-series authority", () => {
    const consoleModel = fieldMiniChartModel({
      samples: tuples.map((sample) => [...sample]),
      sampleLabels: ["first", "failed", "last"],
    }, "delta");
    const terminalModel = terminalSeriesModel(tuples, "delta");

    expect(terminalModel.points.map(({ tick, reference, candidate, value, state }) => ({
      tick, reference, candidate, value, state,
    }))).toEqual(consoleModel.points.map(({ tick, reference, candidate, value, state }: {
      tick: number;
      reference: number | null;
      candidate: number | null;
      value: number | null;
      state: "pass" | "fail";
    }) => ({ tick, reference, candidate, value, state })));
    expect(terminalModel.domain).toEqual(consoleModel.domain);
    expect(terminalModel.colors).toEqual(consoleModel.colors);
    expect(terminalModel.layout).toEqual(consoleModel.layout);
    expect(terminalModel.layout).toMatchObject({
      aspectRatio: FIELD_MINI_CHART_WIDTH / FIELD_MINI_CHART_HEIGHT,
      innerPadding: { top: 0, right: 0, bottom: 0, left: 0 },
      surface: "subtle",
      divider: "none",
      axes: false,
      scaleLabels: false,
    });
  });

  test("paired FieldList metadata and series share rows until the explicit breakpoint", () => {
    const wide = fieldCardPairLayout(72);
    expect(wide.narrow).toBe(false);
    expect(wide.chartOffsetY).toBe(0);
    expect(wide.metadataWidth / 72).toBeGreaterThanOrEqual(0.4);
    expect(wide.metadataWidth / 72).toBeLessThanOrEqual(0.5);

    const narrow = fieldCardPairLayout(42);
    expect(narrow.narrow).toBe(true);
    expect(narrow.chartOffsetY).toBe(2);
    expect(narrow.chartX).toBe(narrow.metadataX);
  });
});
