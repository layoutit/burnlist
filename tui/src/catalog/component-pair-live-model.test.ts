import { describe, expect, test } from "bun:test";
import { paletteFor } from "../terminal-accessibility";
import { componentPairIds, componentPairFixture, type ComponentPairId } from "./component-pair-fixture";
import { cellGridText } from "./component-cell-canvas";
import { componentPairLiveFrame, componentPairViewport } from "./component-pair-live-model";

const probes: Record<ComponentPairId, Record<string, unknown>> = {
  alert: { variant: "destructive", title: "Run failed" },
  badge: { variant: "destructive", label: "blocked" },
  button: { variant: "destructive", label: "Delete" },
  card: { title: "Changed card" },
  checkbox: { checked: false },
  field: { value: "/changed/repository" },
  input: { value: "changed query" },
  progress: { value: 12 },
  select: { value: "complete" },
  separator: { orientation: "vertical" },
  skeleton: { rows: [4, 5] },
  spinner: { label: "Changed loading label" },
  table: { caption: "Changed table" },
  tabs: { selected: "Complete" },
  textarea: { value: "Changed objective" },
  "toggle-group": { selected: "Chart" },
  tooltip: { detail: "Changed explanation" },
  "copy-button": { text: "changed command" },
  "dashboard-error": { message: "Changed failure" },
  "empty-state": { title: "Changed empty state" },
  filters: { filter: "all" },
  "field-list-cards": { fields: [{ label: "Changed field", failures: 1, delta: 4, samples: [[0, 0, 4, 1]] }] },
  "top-card": { title: "Changed top card" },
  "kpi-strip": { percent: 12 },
  "kpi-item": { percent: 12, value: "3 / 25 · 12%" },
  "metric-tiles": { passed: 1 },
  "progress-donut": { percent: 12, label: "12% complete" },
  "burn-donut": { entries: [], label: "No retained results" },
  "waffle-metric": { metric: { total: 12, failed: 11 }, label: "11 of 12 non-passing" },
  "visual-parity-media": { label: "Changed capture", frame: 99 },
  "line-chart": { title: "Changed series", chartMode: "value" },
};

describe("live terminal component pair model", () => {
  test("all 31 pairs consume live Storybook-equivalent args", () => {
    expect(Object.keys(probes).sort()).toEqual([...componentPairIds].sort());
    for (const id of componentPairIds) {
      const viewport = componentPairViewport(id);
      const before = componentPairLiveFrame(id, {}, viewport);
      const after = componentPairLiveFrame(id, probes[id], viewport);
      expect(`${id}:${cellGridText(after)}:${after.color.join(",")}`).not.toBe(`${id}:${cellGridText(before)}:${before.color.join(",")}`);
      expect(after.cols).toBe(viewport.width);
      expect(after.rows).toBe(viewport.height);
      expect(after.char).toHaveLength(after.cols * after.rows);
    }
  });

  test("Alert and Badge variants change terminal glyph, label, and semantic color", () => {
    const warning = componentPairLiveFrame("alert", { variant: "warning", title: "Careful" });
    const destructive = componentPairLiveFrame("alert", { variant: "destructive", title: "Stopped" });
    expect(cellGridText(warning)).toContain("! Careful");
    expect(cellGridText(destructive)).toContain("× Stopped");
    expect(warning.color).toContain("#fcd34d");
    expect(destructive.color).toContain("#ef7171");
    const badge = componentPairLiveFrame("badge", { variant: "destructive", label: "blocked" });
    expect(cellGridText(badge)).toContain("[ blocked ]");
    expect(badge.color).toContain("#ef7171");
  });

  test("donut and waffle fidelity cover 0, partial, 100, narrow, and NO_COLOR", () => {
    for (const percent of [0, 68, 100]) {
      const frame = componentPairLiveFrame("progress-donut", { percent, label: `${percent}% complete` });
      expect(cellGridText(frame)).toContain(`${percent}%`);
      expect(frame.char.join("")).toMatch(percent === 0 ? /░/u : percent === 100 ? /█/u : /[▓▒]/u);
    }
    const narrow = componentPairLiveFrame("progress-donut", { percent: 68 }, { width: 9, height: 4 });
    expect(narrow.cols).toBe(9);
    expect(narrow.rows).toBe(4);
    const waffle = componentPairLiveFrame("waffle-metric", { metric: { total: 10, failed: 4 } });
    expect(waffle.char.join("")).toContain("▪");
    expect(waffle.char.join("")).toContain("▫");
    const mono = paletteFor({ color: "none", light: false, reducedMotion: true });
    const monoFrame = componentPairLiveFrame("progress-donut", { percent: 68 }, { palette: mono });
    expect(monoFrame.char).toEqual(componentPairLiveFrame("progress-donut", { percent: 68 }).char);
    expect(new Set(monoFrame.color.filter(Boolean)).size).toBeLessThanOrEqual(3);
  });

  test("FieldListCards preserves side-by-side composition and collapses only at its breakpoint", () => {
    const wide = componentPairLiveFrame("field-list-cards", {}, { width: 72, height: 16 });
    const wideRows = Array.from({ length: wide.rows }, (_, row) => wide.char.slice(row * wide.cols, (row + 1) * wide.cols).join(""));
    const wideLabel = wideRows[0]!.indexOf("Position"), wideChart = wideRows[0]!.search(/[█▁]/u);
    expect(wideLabel).toBeGreaterThanOrEqual(0);
    expect(wideChart).toBeGreaterThan(wideLabel);
    expect(wideRows[0]!.slice(wideChart)).toMatch(/[█▁]/u);
    expect(wideRows[8]!.indexOf("Active")).toBeLessThan(wideRows[8]!.search(/[█▁]/u));

    const narrow = componentPairLiveFrame("field-list-cards", {}, { width: 42, height: 16 });
    const narrowRows = Array.from({ length: narrow.rows }, (_, row) => narrow.char.slice(row * narrow.cols, (row + 1) * narrow.cols).join(""));
    expect(narrowRows[0]).toContain("Position");
    expect(narrowRows[0]).not.toMatch(/[█▁]/u);
    expect(narrowRows.slice(2, 7).join("\n")).toMatch(/[█▁]/u);
    expect(narrowRows[8]).toContain("Active");
    expect(narrowRows[8]).not.toMatch(/[█▁]/u);
  });

  test("TopCard retains distinct header, KPI, chart, and log regions", () => {
    const frame = componentPairLiveFrame("top-card");
    const rows = cellGridText(frame).split("\n");
    expect(rows[0]).toContain("Exact delta");
    expect(rows[1]).toMatch(/Tasks 2\/3.*Elapsed 30m.*Pace 10m.*Done 67%/u);
    expect(rows.slice(3, 9).join("\n")).toMatch(/[█▁]/u);
    expect(rows.at(-2)).toContain("Run log · Log");
    expect(rows.at(-1)).toContain("Frame 2 unchanged");
  });

  test("reduced motion freezes Spinner without changing its measured frame", () => {
    const first = componentPairLiveFrame("spinner", { reducedMotion: true }, { phase: 0 });
    const later = componentPairLiveFrame("spinner", { reducedMotion: true }, { phase: 3 });
    expect(first.char).toEqual(later.char);
    expect(first.cols).toBe(later.cols);
    expect(first.rows).toBe(later.rows);
    expect(cellGridText(first)).toContain("✦");
  });

  test("fixtures used by visual controls remain valid shared inputs", () => {
    expect(componentPairFixture.fieldListCards.fields.length).toBeGreaterThan(1);
    expect(componentPairFixture.lineChart.points.some((point) => point.state === "fail")).toBe(true);
  });
});
