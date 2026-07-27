import { fitText, visibleWindow } from "../../theme";
import { useTerminalPalette } from "../../terminal-accessibility";
import { TerminalLineChart, type TerminalChartPoint } from "../../terminal-line-chart";
import { nativeImageMode } from "../../native-image-capability";
import { terminalSeriesPngDataUri } from "../../terminal-series-chart-png";
import "../../glyph-surface";
import type { JsonValue, TerminalNode } from "../terminal-contract";
import { resolveOvenPointer } from "../value-runtime";
import { terminalFieldListFrame, type TerminalFieldCard } from "./field-list-frame";
import { fieldCardPairLayout } from "./paired-layout";
import { terminalKpiFrame } from "./kpi-frame";
import { terminalTableFrame, type TerminalListModel } from "./list-components";
import { progressGlyphFrame } from "./progress-glyph";
import { burnDonutCounts } from "./progress-components";
// @ts-expect-error Shared pure chart authority is JavaScript by design.
import { normalizeSeriesChart } from "../../../../src/ovens/series-chart-model.mjs";

type RecordValue = Record<string, JsonValue>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const list = (value: unknown): readonly JsonValue[] => Array.isArray(value) ? value as JsonValue[] : [];
const number = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0;
const text = (value: unknown) => typeof value === "string" || typeof value === "number" ? String(value) : "—";
const source = (node: TerminalNode, payload?: JsonValue) => resolveOvenPointer(payload, node.attributes.source);

/** JSON-safe model shared by the Differential KPI, chart, log, and field roots. */
export function differentialKpiModel(payload?: JsonValue) {
  const data = record(payload), catalog = record(data.scenarioCatalog), scenarios = list(catalog.scenarios), progress = list(data.progress), latest = record(progress.at(-1)), summary = record(data.summary);
  const total = Math.max(0, number(latest.frames)), done = Math.max(0, Math.min(total, number(latest.frame))), fields = record(summary.fields), frames = record(summary.frames), logs = list(data.log);
  const selected = text(catalog.selectedScenarioId), counts = burnDonutCounts(logs.map((entry) => record(entry)));
  return { selected, scenarioCount: scenarios.length, total, done, percent: total ? Math.round(done / total * 100) : 0, logs, counts, fields, frames };
}

export function TerminalDifferentialKpiStrip({ payload, width, height = width < 56 ? 6 : 3 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const model = differentialKpiModel(payload), title = text(record(payload).title);
  const items = [
    { heading: "◎ Scenario", value: `${model.selected}${model.scenarioCount > 1 ? ` (${model.scenarioCount})` : ""}` },
    { heading: "Progress", value: `${model.done}/${model.total} ${model.percent}%`, frame: progressGlyphFrame("progress-donut", model.percent, 4, palette, 2), tone: "good" as const },
    { heading: "Results", value: `+${model.counts.improved} -${model.counts.worsened} ·${model.counts.unchanged} !${model.counts.reverted}`, frame: progressGlyphFrame("burn-donut", model.logs, 4, palette, 1) },
    { heading: "Fields", value: `${number(model.fields.passed)}/${number(model.fields.total)}`, frame: progressGlyphFrame("waffle-metric", model.fields, 5, palette, 4), tone: number(model.fields.failed) ? "bad" as const : "good" as const },
    { heading: "Frames", value: `${number(model.frames.passed)}/${number(model.frames.total)}`, frame: progressGlyphFrame("waffle-metric", model.frames, 5, palette, 4), tone: number(model.frames.failed) ? "bad" as const : "good" as const },
  ];
  const frame = terminalKpiFrame({ title, items }, width, height, palette);
  return <glyphSurface frame={frame} width={frame.cols} height={frame.rows} />;
}

export function TerminalDifferentialChart({ node, payload, width, height = 4 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const sourcePoints = list(source(node, payload)), latest = record(sourcePoints.at(-1));
  const total = Math.max(0, number(latest.frames)), done = Math.max(0, Math.min(total, number(latest.frame)));
  const chartPoints: TerminalChartPoint[] = sourcePoints.map((entry, index) => {
    const point = record(entry), delta = number(point.frameDelta), pointTotal = Math.max(0, number(point.frames)), pointDone = Math.max(0, Math.min(pointTotal, number(point.frame)));
    return {
      label: `F${text(point.frame) === "—" ? index : text(point.frame)}`,
      value: node.kind === "frame-delta-chart" ? delta : pointTotal ? pointDone / pointTotal * 100 : 0,
      state: delta < 0 ? "fail" : "pass",
    };
  });
  const label = node.kind === "frame-delta-chart"
    ? typeof latest.frameDelta === "number" ? `Frame delta · latest ${number(latest.frameDelta) >= 0 ? "+" : ""}${number(latest.frameDelta)}` : "Frame delta · unavailable"
    : `Progress · latest ${done}/${total}`;
  return <TerminalLineChart title={label} points={chartPoints} width={width} height={height} />;
}

export function TerminalDifferentialLogTable({ node, payload, width, height = 8 }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number }) {
  const palette = useTerminalPalette();
  const allEntries = list(source(node, payload));
  const entries = visibleWindow([...allEntries], Math.max(0, allEntries.length - Math.max(1, height - 2)), Math.max(1, height - 2)).items;
  const model: TerminalListModel = {
    width,
    height,
    columns: [
      { id: "age", label: "AGE", minWidth: 5 },
      { id: "frame", label: "FRAME", minWidth: 6 },
      { id: "result", label: "RESULT", minWidth: 7 },
      { id: "delta", label: "DELTA", minWidth: 6 },
      { id: "done", label: "DONE", minWidth: 5 },
    ],
    rows: entries.map((entry, index) => {
      const row = record(entry), delta = number(row.frameDelta), frames = number(row.frames), frame = number(row.frame);
      return {
        id: `${text(row.timestamp)}-${index}`,
        cells: {
          age: text(row.timestamp),
          frame: `${frame}/${frames}`,
          result: delta > 0 ? "improved" : delta < 0 ? "worsened" : "same",
          delta: typeof row.frameDelta === "number" ? `${delta >= 0 ? "+" : ""}${delta}` : "—",
          done: frames ? `${Math.round(frame / frames * 100)}%` : "—",
        },
        tone: delta < 0 ? "bad" as const : delta > 0 ? "good" as const : undefined,
      };
    }),
  };
  const frame = terminalTableFrame(model, palette);
  return <glyphSurface frame={frame} width={frame.cols} height={frame.rows} />;
}

/** Field rows deliberately keep unavailable telemetry explicit instead of inventing a chart. */
export function TerminalHybridFieldList({ node, payload, width, height = 8, expanded = false, selectedId, pageIndex = 0, pageSize }: { node: TerminalNode; payload?: JsonValue; width: number; height?: number; expanded?: boolean; selectedId?: string; pageIndex?: number; pageSize?: number }) {
  const palette = useTerminalPalette();
  const sourceFields = list(resolveOvenPointer(payload, "/fields")), allFields = pageSize ? sourceFields.slice(pageIndex * pageSize, pageIndex * pageSize + pageSize) : sourceFields, telemetry = record(resolveOvenPointer(payload, "/telemetry"));
  const availability = typeof telemetry.status === "string" ? String(telemetry.status) : "absent";
  if (!allFields.length) {
    return <box width={width} height={height} overflow="hidden"><text fg={palette.dim}>{fitText(availability === "comparable" ? "No changed fields in this telemetry." : "No fields match the current view.", width)}</text></box>;
  }
  const chosen = selectedId || text(record(allFields.find((value) => { const sample = list(record(value).samples).at(-1); return Array.isArray(sample) && typeof sample[1] === "number" && typeof sample[2] === "number"; }) ?? allFields[0]).id);
  const selectedIndex = Math.max(0, allFields.findIndex((value) => text(record(value).id) === chosen));
  const fields = visibleWindow([...allFields], selectedIndex, expanded ? 1 : 3).items.map((value): TerminalFieldCard => {
    const field = record(value), sample = list(field.samples).at(-1), limit = Array.isArray(sample) ? sample[1] : null, actual = Array.isArray(sample) ? sample[2] : null;
    const unit = text(field.unit) === "—" ? "" : text(field.unit);
    return {
      id: text(field.id),
      label: text(field.label),
      failed: number(field.failedSampleCount) > 0,
      blocked: number(field.missingSampleCount) > 0 || text(field.trustStatus) === "blocked",
      failures: number(field.failedSampleCount),
      missing: number(field.missingSampleCount),
      delta: number(field.maxDelta),
      samples: list(field.samples),
      detail: typeof actual === "number" && typeof limit === "number" ? `telemetry ${availability} · actual ${actual}${unit} / limit ${limit}${unit}` : `${text(record(field.semantics).meaning)} · telemetry ${availability}`,
    };
  });
  const frame = terminalFieldListFrame(fields, { width, height, mode: "delta", selectedId: chosen, expanded, palette });
  const native = height >= 15 && nativeImageMode(process.env) === "iterm", layout = fieldCardPairLayout(width);
  const stride = layout.starts[1]! - layout.starts[0]!;
  return <box width={frame.cols} height={frame.rows}>
    <glyphSurface frame={frame} width={frame.cols} height={frame.rows} />
    {native ? fields.map((field, index) => {
      const top = index * stride + layout.chartOffsetY;
      if (top + layout.chartHeight > height) return null;
      const model = normalizeSeriesChart(field.samples, { mode: "delta" });
      const image = terminalSeriesPngDataUri(model, layout.chartWidth, layout.chartHeight);
      return <image
        key={field.id}
        source={image}
        protocol="iterm"
        position="absolute"
        left={layout.chartX}
        top={top}
        width={layout.chartWidth}
        height={layout.chartHeight}
      />;
    }) : null}
  </box>;
}
