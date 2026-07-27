import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { paletteFor } from "../terminal-accessibility";
import { componentPairIds, componentPairFixture, type ComponentPairId } from "./component-pair-fixture";
import { cellGridText } from "./component-cell-canvas";
import { componentPairLiveFrame, componentPairViewport } from "./component-pair-live-model";
import { fieldCardPairLayout, topCardPairLayout } from "./component-pair-layout";
import { PAIR_RUN_LOG_COLUMNS, pairTableColumnWidths } from "./component-pair-composition";
import { componentMediaDigest, componentMediaImages, componentMediaPng, componentMediaRgba } from "./component-media-fixture";
import { imageGlyphFrame } from "../image-glyph-grid";
import { decodePngDataUri } from "../png-glyph";

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
const brailleDots = (char: string) => {
  let mask = char.codePointAt(0)! - 0x2800, count = 0;
  while (mask > 0) {
    count += mask & 1;
    mask >>>= 1;
  }
  return count;
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
    expect(waffle.char.join("")).toMatch(/[\u2800-\u28ff]/u);
    expect(waffle.char.join("")).not.toMatch(/[╭╮╰╯│─┌┐└┘]/u);
    const waffleRows = Array.from({ length: 3 }, (_, row) => waffle.char.slice(row * waffle.cols + 1, row * waffle.cols + 6));
    expect(waffleRows.every((row) => row.length === 5)).toBe(true);
    const failedDots = waffleRows.flat().reduce((sum, char, index) => {
      const sourceIndex = Math.floor(index / 5) * waffle.cols + 1 + index % 5;
      return sum + (waffle.color[sourceIndex] === "#ef7171" ? brailleDots(char) : 0);
    }, 0);
    expect(failedDots).toBe(40);
    const mono = paletteFor({ color: "none", light: false, reducedMotion: true });
    const monoFrame = componentPairLiveFrame("progress-donut", { percent: 68 }, { palette: mono });
    expect(monoFrame.char).toEqual(componentPairLiveFrame("progress-donut", { percent: 68 }).char);
    expect(new Set(monoFrame.color.filter(Boolean)).size).toBeLessThanOrEqual(3);
    const monoWaffle = componentPairLiveFrame("waffle-metric", { metric: { total: 10, failed: 4 } }, { palette: mono, width: 9, height: 7 });
    expect(monoWaffle.char.join("")).toMatch(/[\u2800-\u28ff]/u);
    expect(cellGridText(monoWaffle)).toContain("3 of 1…");
  });

  test("FieldListCards preserves side-by-side composition and collapses only at its breakpoint", () => {
    const wide = componentPairLiveFrame("field-list-cards", {}, { width: 72, height: 16 });
    const wideRows = Array.from({ length: wide.rows }, (_, row) => wide.char.slice(row * wide.cols, (row + 1) * wide.cols).join(""));
    const layout = fieldCardPairLayout(72);
    const wideLabel = wideRows[0]!.indexOf("Position"), wideChart = wideRows[1]!.search(/[\u2801-\u28ff]/u);
    expect(wideLabel).toBeGreaterThanOrEqual(0);
    expect(wideChart).toBeGreaterThan(wideLabel);
    expect(wideChart).toBeGreaterThanOrEqual(layout.chartX);
    expect(wideRows[1]!.slice(wideChart)).toMatch(/[\u2801-\u28ff]/u);
    expect(wideRows[5]!.indexOf("Active")).toBeGreaterThanOrEqual(0);
    expect(wideRows[6]!.search(/[\u2801-\u28ff]/u)).toBeGreaterThan(wideRows[5]!.indexOf("Active"));
    expect(wideRows.every((row) => row.length === 72)).toBe(true);

    const narrow = componentPairLiveFrame("field-list-cards", {}, { width: 42, height: 16 });
    const narrowRows = Array.from({ length: narrow.rows }, (_, row) => narrow.char.slice(row * narrow.cols, (row + 1) * narrow.cols).join(""));
    expect(narrowRows[0]).toContain("Position");
    expect(narrowRows[0]).not.toMatch(/[\u2801-\u28ff]/u);
    expect(narrowRows.slice(2, 5).join("\n")).toMatch(/[\u2801-\u28ff]/u);
    expect(narrowRows[6]).toContain("Active");
    expect(narrowRows[6]).not.toMatch(/[\u2801-\u28ff]/u);
  });

  test("TopCard keeps complete KPIs above side-by-side Run Log and chart, then collapses narrowly", () => {
    const frame = componentPairLiveFrame("top-card");
    const rows = cellGridText(frame).split("\n");
    expect(rows[0]).toContain("Exact delta");
    expect(rows[1]).toMatch(/SCENARIO.*PROGRESS.*RESULTS.*FIELDS.*FRAMES/u);
    expect(rows[2]).toMatch(/135b7578.*67%.*50%.*17%/u);
    const layout = topCardPairLayout(frame.cols, frame.rows);
    expect(rows[layout.logY]).toContain("Run log");
    expect(rows[layout.chartY]).toContain("Chart · Value · [Delta]");
    expect(rows.slice(layout.chartY + 1).join("\n")).toMatch(/[\u2801-\u28ff]/u);
    expect(rows[layout.logY + 1]).toContain("AGE");
    expect(rows[layout.logY + 2]!.trimStart()).toMatch(/^─+/u);
    expect(rows[layout.logY + 3]).toMatch(/30m.*2.*0.*0%.*67%/u);
    expect(layout.chartX).toBeGreaterThan(layout.logX + layout.logWidth - 1);
    const widths = pairTableColumnWidths(PAIR_RUN_LOG_COLUMNS, layout.logWidth);
    expect(widths.reduce((sum, width) => sum + width, 0)).toBe(layout.logWidth);
    let offset = layout.logX;
    for (const [index, column] of PAIR_RUN_LOG_COLUMNS.entries()) {
      const headerCell = rows[layout.logY + 1]!.slice(offset, offset + widths[index]!);
      expect(headerCell).toContain(column.label.toUpperCase());
      const valueCell = rows[layout.logY + 3]!.slice(offset, offset + widths[index]!);
      if (column.align === "right") expect(valueCell.at(-1)).not.toBe(" ");
      offset += widths[index]!;
    }

    const narrow = componentPairLiveFrame("top-card", {}, { width: 42, height: 18 });
    const narrowRows = cellGridText(narrow).split("\n"), narrowLayout = topCardPairLayout(42, 18);
    expect(narrowLayout.narrow).toBe(true);
    expect(narrowRows[narrowLayout.logY]).toContain("Run log");
    expect(narrowRows[narrowLayout.chartY]).toContain("Chart");
    expect(narrowLayout.chartY).toBeGreaterThan(narrowLayout.logY + narrowLayout.logHeight);
  });

  test("TopCard composes the same named KPI, table, and series component boundaries", () => {
    const terminal = readFileSync(new URL("./component-pair-live-model.ts", import.meta.url), "utf8");
    for (const name of ["renderPairHeader", "renderPairKpiStrip", "renderPairTable", "renderPairSeriesChart"]) {
      expect(terminal).toContain(name);
    }
    expect(terminal).not.toContain("AGE  FRAME RESULT");
    expect(terminal).not.toContain("terminalSeriesFrameFromModel(");
    const consoleStory = readFileSync(new URL("../../../dashboard/src/oven/runtime/differential-testing-detail.stories.tsx", import.meta.url), "utf8");
    for (const name of ["DifferentialKpiStrip", "DifferentialLogTable", "FieldMiniChart", "DifferentialTestingDetail"]) {
      expect(consoleStory).toContain(`import { ${name} }`);
      expect(consoleStory).toContain(`<${name}`);
    }
  });

  test("VisualParityMedia uses the same bounded PNG sources through production supersampling", () => {
    const source = componentMediaImages[0]!.src;
    expect(source).toBe(componentMediaPng.reference);
    expect(componentMediaDigest(source)).toBe(componentMediaDigest(componentMediaPng.reference));
    expect(createHash("sha256").update(source).digest("hex")).toHaveLength(64);
    const decoded = decodePngDataUri(source);
    expect([...decoded.pixels]).toEqual([...componentMediaRgba.reference.pixels]);
    const rgb = new Set(Array.from({ length: decoded.width * decoded.height }, (_, index) =>
      [...decoded.pixels.slice(index * 4, index * 4 + 3)].join(",")));
    const rowDigests = new Set(Array.from({ length: decoded.height }, (_, row) =>
      createHash("sha256").update(decoded.pixels.slice(row * decoded.width * 4, (row + 1) * decoded.width * 4)).digest("hex")));
    expect(rgb.size).toBeGreaterThan(20);
    expect(rowDigests.size).toBeGreaterThan(12);
    const image = imageGlyphFrame(componentMediaRgba.reference, 30, 12);
    expect([image.cols, image.rows]).toEqual([30, 8]);
    expect(new Set(image.char).size).toBeGreaterThan(2);
    expect(new Set(image.color).size).toBeGreaterThan(12);
    const wide = componentPairLiveFrame("visual-parity-media", { images: componentMediaImages }, { width: 96, height: 26 });
    const narrow = componentPairLiveFrame("visual-parity-media", { images: componentMediaImages }, { width: 36, height: 22 });
    expect(cellGridText(wide)).toMatch(/Reference.*Candidate.*Difference/u);
    expect(cellGridText(narrow)).toContain("Difference");
    expect(wide.char.join("")).toMatch(/[░▒▓█]/u);
    const failed = componentPairLiveFrame("visual-parity-media", { images: [{ ...componentMediaImages[0], src: "invalid" }] }, { width: 36, height: 22 });
    expect(cellGridText(failed)).toContain("unavailable");
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
