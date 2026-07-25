import type { CellGrid } from "glyphcss";
import { paletteFor, type TerminalPalette } from "../terminal-accessibility";
import { terminalLoadingGlyph } from "../loading-cadence";
import { progressGlyphFrame } from "../oven-runtime/components/progress-glyph";
import { terminalKpiFrame } from "../oven-runtime/components/kpi-frame";
import { terminalFieldListFrame } from "../oven-runtime/components/field-list-frame";
import { terminalMetricTilesFrame } from "../oven-runtime/components/metric-tiles-frame";
import { imageGlyphFrame } from "../image-glyph-grid";
import { type NormalizedTerminalSeries, type TerminalChartPoint } from "../terminal-series-chart-model";
// @ts-expect-error Shared pure chart authority is JavaScript by design.
import { normalizeSeriesChart } from "../../../src/ovens/series-chart-model.mjs";
import { componentPairFixture, type ComponentPairId } from "./component-pair-fixture";
import {
  canvasCellGrid,
  createCellCanvas,
  fillCanvasRow,
  pasteCellGrid,
  writeCanvasText,
  type CellCanvas,
  type PairPalette,
} from "./component-cell-canvas";
import { topCardPairLayout } from "./component-pair-layout";
import { componentMediaImages, componentMediaPixelsForSource, type ComponentMediaImage } from "./component-media-fixture";
import {
  PAIR_RUN_LOG_COLUMNS,
  renderPairHeader,
  renderPairKpiStrip,
  renderPairSeriesChart,
  renderPairTable,
  type PairTableColumn,
  type PairTableRow,
} from "./component-pair-composition";

export type ComponentPairLiveArgs = Readonly<Record<string, unknown>>;
export const defaultPairPalette = paletteFor({ color: "truecolor", light: false, reducedMotion: false });

const text = (value: unknown, fallback = "") => typeof value === "string" || typeof value === "number" ? String(value) : fallback;
const numeric = (value: unknown, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const bool = (value: unknown, fallback = false) => typeof value === "boolean" ? value : fallback;
const list = <T>(value: unknown, fallback: readonly T[]): readonly T[] => Array.isArray(value) ? value as readonly T[] : fallback;
const value = (args: ComponentPairLiveArgs, name: string, fallback: unknown) => args[name] ?? fallback;
const label = (args: ComponentPairLiveArgs, fallback: string) =>
  text(args.label ?? args["aria-label"] ?? args.children ?? args.title, fallback);
const write = (canvas: CellCanvas, row: number, content: unknown, color: string | null, column = 1, limit = canvas.width - 2) =>
  writeCanvasText(canvas, column, row, content, color, limit);
const progressBar = (percent: number, width: number) => {
  const cells = Math.max(3, width), done = Math.round(Math.max(0, Math.min(100, percent)) / 100 * cells);
  return `${"━".repeat(done)}${"·".repeat(cells - done)}`;
};
const variantTone = (variant: string, palette: PairPalette) =>
  variant === "destructive" ? palette.red : variant === "warning" ? palette.amber : variant === "success" ? palette.green : palette.blue;
const variantGlyph = (variant: string) =>
  variant === "destructive" ? "×" : variant === "warning" ? "!" : variant === "success" ? "✓" : "i";

function mediaImages(args: ComponentPairLiveArgs): readonly ComponentMediaImage[] {
  if (!Array.isArray(args.images)) return componentMediaImages;
  return args.images.slice(0, 3).map((entry, index) => {
    const item = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    const fallback = componentMediaImages[index] ?? componentMediaImages[0]!;
    return {
      label: text(item.label, fallback.label),
      src: text(item.src, fallback.src),
      width: numeric(item.width, fallback.width),
      height: numeric(item.height, fallback.height),
    };
  });
}

export const componentPairViewport = (id: ComponentPairId) => ({
  width: id === "visual-parity-media" ? 96 : 72,
  height: id === "field-list-cards" ? 10 : id === "top-card" ? 12 : id === "visual-parity-media" ? 26 : id === "line-chart" ? 8 : 10,
});

function chartSamples(value: unknown, fallback: readonly TerminalChartPoint[]): readonly TerminalChartPoint[] {
  const source = Array.isArray(value) ? value : fallback;
  return source.map((entry, index) => {
    const point = entry && typeof entry === "object" ? entry as Record<string, unknown> : {};
    return {
      label: text(point.label, `F${index}`),
      value: numeric(point.value),
      state: point.state === "fail" ? "fail" : "pass",
    };
  });
}

const seriesModel = (samples: unknown, mode: string): NormalizedTerminalSeries =>
  normalizeSeriesChart(Array.isArray(samples) ? samples : [], { mode }) as NormalizedTerminalSeries;

function renderMetric(canvas: CellCanvas, frame: CellGrid, x: number, y: number, caption: string, palette: PairPalette) {
  pasteCellGrid(canvas, frame, x, y);
  writeCanvasText(canvas, x + frame.cols + 2, y, caption, palette.muted, Math.max(1, canvas.width - x - frame.cols - 3));
}

function simplePair(id: ComponentPairId, args: ComponentPairLiveArgs, canvas: CellCanvas, palette: PairPalette, phase: number) {
  const fixture = componentPairFixture;
  if (id === "alert") {
    const variant = text(value(args, "variant", fixture.alert.tone), "info");
    const tone = variantTone(variant, palette);
    write(canvas, 1, `${variantGlyph(variant)} ${text(value(args, "title", fixture.alert.title))}`, tone);
    write(canvas, 2, value(args, "detail", fixture.alert.detail), palette.muted);
  } else if (id === "badge") {
    const variant = text(value(args, "variant", fixture.badge.tone));
    write(canvas, 1, `[ ${label(args, fixture.badge.label)} ]`, variantTone(variant, palette));
    write(canvas, 3, `variant · ${variant}`, palette.dim);
  } else if (id === "button") {
    const variant = text(value(args, "variant", "default")), disabled = bool(args.disabled);
    const caption = label(args, fixture.button.label);
    write(canvas, 1, `[ ${caption} ]`, disabled ? palette.dim : variantTone(variant, palette));
    write(canvas, 3, `${variant} · ${text(value(args, "size", "default"))}${disabled ? " · disabled" : ""}`, palette.muted);
  } else if (id === "card") {
    fillCanvasRow(canvas, 0, 1, canvas.width - 2, "─", palette.dim);
    write(canvas, 1, value(args, "title", fixture.card.title), palette.foreground);
    write(canvas, 2, value(args, "detail", fixture.card.detail), palette.muted);
    write(canvas, 4, value(args, "meta", fixture.card.meta), palette.dim);
    fillCanvasRow(canvas, 6, 1, canvas.width - 2, "─", palette.dim);
  } else if (id === "checkbox") {
    const checked = value(args, "checked", fixture.checkbox.checked), disabled = bool(args.disabled);
    write(canvas, 1, `${checked === "indeterminate" ? "▣" : checked ? "☑" : "☐"} ${label(args, fixture.checkbox.label)}`, disabled ? palette.dim : palette.blue);
  } else if (id === "field") {
    write(canvas, 0, value(args, "label", fixture.field.label), palette.foreground);
    write(canvas, 1, `› ${text(value(args, "value", fixture.field.value))}█`, palette.soft);
    write(canvas, 3, value(args, "detail", fixture.field.detail), palette.muted);
    if (bool(value(args, "invalid", true))) write(canvas, 5, `! ${text(value(args, "error", fixture.field.error))}`, palette.red);
  } else if (id === "input") {
    write(canvas, 0, label(args, fixture.input.label), palette.muted);
    const content = text(args.value ?? args.defaultValue ?? args.placeholder, fixture.input.value);
    write(canvas, 1, `› ${content}${bool(args.disabled) ? "" : "█"}`, bool(args.disabled) ? palette.dim : palette.foreground);
  } else if (id === "progress") {
    const percent = numeric(value(args, "value", fixture.progress.value));
    write(canvas, 0, label(args, fixture.progress.label), palette.muted);
    write(canvas, 2, `${Math.round(percent)}% ${progressBar(percent, Math.min(32, canvas.width - 8))}`, palette.green);
  } else if (id === "select") {
    const options = list<string>(args.options, fixture.select.options);
    write(canvas, 0, value(args, "label", fixture.select.label), palette.muted);
    write(canvas, 1, `◇ [${text(value(args, "value", fixture.select.value))}]  ${options.join(" · ")}`, bool(args.disabled) ? palette.dim : palette.blue);
  } else if (id === "separator") {
    const orientation = text(value(args, "orientation", "horizontal"));
    if (orientation === "vertical") {
      write(canvas, 0, value(args, "before", fixture.separator.before), palette.foreground);
      for (let row = 1; row < Math.min(canvas.height - 1, 7); row += 1) write(canvas, row, "│", palette.dim, 2, 1);
      write(canvas, 7, value(args, "after", fixture.separator.after), palette.foreground);
    } else {
      write(canvas, 0, value(args, "before", fixture.separator.before), palette.foreground);
      fillCanvasRow(canvas, 2, 1, canvas.width - 2, "─", palette.dim);
      write(canvas, 4, value(args, "after", fixture.separator.after), palette.foreground);
    }
  } else if (id === "skeleton") {
    write(canvas, 0, value(args, "label", fixture.skeleton.label), palette.muted);
    list<number>(args.rows, fixture.skeleton.rows).slice(0, 4).forEach((size, index) => fillCanvasRow(canvas, 2 + index, 1, Math.min(numeric(size), canvas.width - 2), "▒", palette.dim));
  } else if (id === "spinner") {
    const reduced = bool(args.reducedMotion);
    write(canvas, 1, `${terminalLoadingGlyph(phase, reduced)} ${label(args, fixture.spinner.label)}`, palette.blue);
    write(canvas, 3, `cadence · ${text(value(args, "size", "default"))}${reduced ? " · reduced motion" : ""}`, palette.dim);
  } else if (id === "table") {
    const headers = list<string>(args.headers, fixture.table.headers), rows = list<readonly string[]>(args.rows, fixture.table.rows);
    const columns: PairTableColumn[] = headers.map((heading, index) => ({
      id: String(index),
      label: heading,
      minWidth: index < 2 ? 10 : 7,
      align: index < 2 ? "left" : "right",
      grow: index === 1 ? 3 : 1,
    }));
    renderPairTable(
      canvas,
      columns,
      rows.map((row) => ({ cells: Object.fromEntries(row.map((cell, index) => [String(index), cell])) })),
      1,
      0,
      canvas.width - 2,
      canvas.height,
      palette,
      text(value(args, "caption", fixture.table.caption)),
    );
  } else if (id === "tabs") {
    const tabs = list<string>(args.tabs, fixture.tabs.tabs), selected = text(value(args, "selected", fixture.tabs.selected));
    write(canvas, 0, tabs.map((tab) => tab === selected ? `[${tab}]` : tab).join("  "), palette.foreground);
    fillCanvasRow(canvas, 1, 1, Math.min(selected.length + 2, canvas.width - 2), "─", palette.blue);
    write(canvas, 3, value(args, "panel", fixture.tabs.panel), palette.foreground);
  } else if (id === "textarea") {
    write(canvas, 0, value(args, "label", fixture.textarea.label), palette.muted);
    fillCanvasRow(canvas, 1, 1, canvas.width - 2, "─", palette.dim);
    write(canvas, 2, args.value ?? args.defaultValue ?? args.placeholder ?? fixture.textarea.value, bool(args.disabled) ? palette.dim : palette.foreground);
    fillCanvasRow(canvas, 4, 1, canvas.width - 2, "─", palette.dim);
  } else if (id === "toggle-group" || id === "filters") {
    const source = id === "filters" ? fixture.filters : fixture.toggleGroup;
    const options = list<string>(args.options, source.options);
    const selected = text(args.selected ?? args.filter, source.selected);
    write(canvas, 0, value(args, "label", source.label), palette.muted);
    write(canvas, 2, options.map((option) => option.toLowerCase() === selected.toLowerCase() ? `[${option}]` : option).join("  "), palette.blue);
  } else if (id === "tooltip") {
    write(canvas, 1, `ⓘ ${label(args, fixture.tooltip.label)}`, palette.blue);
    write(canvas, 2, `╰─ ${text(value(args, "detail", fixture.tooltip.detail))}`, palette.muted);
  } else if (id === "copy-button") {
    const copied = bool(args.copied);
    write(canvas, 1, `[ ${text(value(args, "label", fixture.copyButton.label))} ]  ${text(args.text ?? args.value, fixture.copyButton.value)}`, palette.blue);
    write(canvas, 3, copied ? "Copied ✓" : "enter copies", copied ? palette.green : palette.dim);
  } else if (id === "dashboard-error") {
    write(canvas, 1, "⚠ Dashboard error", palette.red);
    write(canvas, 2, value(args, "message", fixture.dashboardError.message), palette.foreground);
  } else if (id === "empty-state") {
    write(canvas, 1, `○ ${text(value(args, "title", fixture.emptyState.title))}`, palette.foreground);
    write(canvas, 2, value(args, "detail", fixture.emptyState.detail), palette.muted);
  }
}

function chartAndMetricPair(id: ComponentPairId, args: ComponentPairLiveArgs, canvas: CellCanvas, palette: PairPalette) {
  const fixture = componentPairFixture;
  if (id === "field-list-cards") {
    const chartMode = text(value(args, "chartMode", "delta")).toLowerCase();
    const fields = list<Record<string, unknown>>(args.fields, fixture.fieldListCards.fields as unknown as readonly Record<string, unknown>[]);
    pasteCellGrid(canvas, terminalFieldListFrame(fields.map((field) => {
      const failures = numeric(field.failures ?? field.failedSampleCount);
      return {
        id: text(field.id),
        label: text(field.label, "Field"),
        failed: text(field.status, failures ? "failed" : "pass") !== "pass",
        blocked: bool(field.blocked),
        failures,
        missing: numeric(field.missingSampleCount),
        delta: numeric(field.delta ?? field.maxDelta),
        samples: list(field.samples, []),
      };
    }), { width: canvas.width, height: canvas.height, mode: chartMode, palette }), 0, 0);
  } else if (id === "top-card" || id === "line-chart") {
    const source = id === "top-card" ? fixture.topCard : fixture.lineChart;
    const samples = chartSamples(args.points ?? args.chart, source === fixture.topCard ? fixture.topCard.chart : fixture.lineChart.points);
    const model = seriesModel(samples, id === "line-chart" ? text(value(args, "chartMode", "delta")) : "delta");
    const title = text(value(args, "title", source.title));
    if (id === "top-card") {
      const published = text(value(args, "publishedAt", fixture.topCard.publishedAt));
      const layout = topCardPairLayout(canvas.width, canvas.height);
      renderPairHeader(canvas, title, published, palette);
      renderPairKpiStrip(canvas, [
        { heading: "SCENARIO", value: "135b7578" },
        { heading: "PROGRESS", value: "3 · 2 (67%)", tone: "good" },
        { heading: "RESULTS", value: "1 · 0 · 0 · 0" },
        { heading: "FIELDS", value: "2 · 1 (50%)", tone: "bad" },
        { heading: "FRAMES", value: "6 · 1 (17%)", tone: "bad" },
      ], 1, 1, canvas.width - 2, palette);
      fillCanvasRow(canvas, layout.dividerY, 0, canvas.width, "─", palette.dim);
      const columns = PAIR_RUN_LOG_COLUMNS;
      const historyTitle = text(value(args, "historyTitle", fixture.topCard.historyTitle));
      const rows = list<Record<string, unknown>>(args.logRows, fixture.topCard.logRows);
      const tableRows: PairTableRow[] = rows.map((row) => ({
        cells: Object.fromEntries(columns.map((column) => [column.id, text(row[column.id])])),
        tone: row.tone === "good" ? "good" : row.tone === "bad" ? "bad" : "neutral",
      }));
      renderPairTable(canvas, columns, tableRows, layout.logX, layout.logY, layout.logWidth, layout.logHeight, palette, historyTitle);
      renderPairSeriesChart(canvas, model, layout.chartX, layout.chartY, layout.chartWidth, layout.chartHeight, palette, "Chart · Value · [Delta]");
      if (!layout.narrow) for (let row = layout.bodyY; row < layout.bodyY + layout.chartHeight; row += 1) {
        writeCanvasText(canvas, layout.chartX - 1, row, "│", palette.dim, 1);
      }
    }
    else {
      renderPairSeriesChart(canvas, model, 1, 0, canvas.width - 2, canvas.height, palette, title);
    }
  } else if (id === "kpi-item" || id === "progress-donut") {
    const percent = numeric(value(args, "percent", id === "kpi-item" ? fixture.kpiItem.percent : fixture.progressDonut.percent));
    if (id === "kpi-item") {
      const metric = progressGlyphFrame("progress-donut", percent, 4, palette as TerminalPalette, 2);
      pasteCellGrid(canvas, terminalKpiFrame({
        items: [{ heading: text(value(args, "heading", fixture.kpiItem.heading)), value: text(value(args, "label", fixture.kpiItem.value)), frame: metric }],
      }, canvas.width, canvas.height, palette), 0, 0);
      return;
    }
    write(canvas, 0, value(args, "heading", "Progress"), palette.foreground);
    const frame = progressGlyphFrame("progress-donut", percent, 4, palette as TerminalPalette, 2);
    renderMetric(canvas, frame, 1, 1, text(value(args, "label", `${Math.round(percent)}% complete`)), palette);
  } else if (id === "waffle-metric") {
    const metric = value(args, "metric", fixture.waffleMetric.metric);
    const frame = progressGlyphFrame("waffle-metric", metric, 5, palette as TerminalPalette, 4);
    pasteCellGrid(canvas, frame, 1, 0);
    writeCanvasText(canvas, 1, frame.rows + 1, text(value(args, "label", fixture.waffleMetric.label)), palette.muted, Math.max(1, canvas.width - 2));
  } else if (id === "burn-donut") {
    const entries = value(args, "entries", fixture.burnDonut.entries);
    write(canvas, 0, value(args, "heading", "Result distribution"), palette.foreground);
    const frame = progressGlyphFrame("burn-donut", entries, 4, palette as TerminalPalette, 1);
    renderMetric(canvas, frame, 1, 2, text(value(args, "label", fixture.burnDonut.label)), palette);
  } else if (id === "metric-tiles") {
    const values = [
      ["Frames", `${numeric(value(args, "passed", fixture.metricTiles.passed))}/${numeric(value(args, "total", fixture.metricTiles.total))}`],
      ["Changed", `${(numeric(value(args, "ratio", fixture.metricTiles.ratio)) * 100).toFixed(2)}%`],
      ["Mean RGB", numeric(value(args, "meanAbsoluteDelta", fixture.metricTiles.meanAbsoluteDelta)).toFixed(3)],
      ["Max delta", text(value(args, "maximumAbsoluteDelta", fixture.metricTiles.maximumAbsoluteDelta))],
    ] as const;
    pasteCellGrid(canvas, terminalMetricTilesFrame(values, canvas.width, canvas.height, palette), 0, 0);
  } else if (id === "kpi-strip") {
    const percent = numeric(value(args, "percent", fixture.progressDonut.percent));
    const items = [["Progress", "progress-donut"], ["Results", "burn-donut"], ["Fields", "waffle-metric"]].map(([heading, kind], index) => {
      const raw = kind === "progress-donut" ? percent : kind === "burn-donut" ? value(args, "entries", fixture.burnDonut.entries) : value(args, "metric", fixture.waffleMetric.metric);
      const frame = progressGlyphFrame(kind as "progress-donut" | "burn-donut" | "waffle-metric", raw, kind === "waffle-metric" ? 5 : 4, palette as TerminalPalette, kind === "progress-donut" ? 2 : kind === "waffle-metric" ? 4 : 1);
      return { heading, value: fixture.kpiStrip.items[index]!.value, frame };
    });
    pasteCellGrid(canvas, terminalKpiFrame({
      title: text(value(args, "title", fixture.kpiStrip.title)),
      items,
    }, canvas.width, canvas.height, palette), 0, 0);
  } else if (id === "visual-parity-media") {
    const images = mediaImages(args);
    write(canvas, 0, `${text(value(args, "label", fixture.visualParityMedia.label))} · Frame ${numeric(value(args, "frame", fixture.visualParityMedia.frame))}`, palette.foreground);
    const wide = canvas.width >= 54;
    images.forEach((image, index) => {
      const slotWidth = wide ? Math.max(6, Math.floor((canvas.width - 2) / 3)) : canvas.width - 2;
      const slotHeight = wide ? canvas.height - 2 : Math.max(5, Math.floor((canvas.height - 1) / 3));
      const x = wide ? 1 + index * slotWidth : 1;
      const y = wide ? 2 : 1 + index * slotHeight;
      writeCanvasText(canvas, x, y, image.label, palette.muted, slotWidth - 1);
      try {
        const pixels = componentMediaPixelsForSource(image.src);
        if (!pixels) throw new Error("Image source is unavailable to the live terminal raster.");
        const frame = imageGlyphFrame(pixels, Math.max(1, slotWidth - 1), Math.max(1, slotHeight - 1));
        pasteCellGrid(canvas, frame, x, y + 1);
      } catch (cause) {
        writeCanvasText(canvas, x, y + 1, cause instanceof Error ? cause.message : "invalid image", palette.red, slotWidth - 1);
      }
    });
  }
}

/** Pure cell authority consumed by both OpenTUI and the live Storybook adapter. */
export function componentPairLiveFrame(
  id: ComponentPairId,
  args: ComponentPairLiveArgs = {},
  options: { width?: number; height?: number; palette?: PairPalette; phase?: number } = {},
): CellGrid {
  const viewport = componentPairViewport(id), width = options.width ?? viewport.width, height = options.height ?? viewport.height;
  const palette = options.palette ?? defaultPairPalette, canvas = createCellCanvas(width, height);
  simplePair(id, args, canvas, palette, options.phase ?? 0);
  chartAndMetricPair(id, args, canvas, palette);
  return canvasCellGrid(canvas);
}
