import type { CellGrid } from "glyphcss";
// @ts-expect-error Shared pure chart authority is JavaScript by design.
import { normalizeSeriesChart } from "../../../../src/ovens/series-chart-model.mjs";
import {
  canvasCellGrid,
  createCellCanvas,
  renderPairSeriesChart,
  renderPairSeriesSparkRow,
  writeCanvasText,
  type PairPalette,
} from "./paired-cell";
import { fieldCardPairLayout } from "./paired-layout";

export type TerminalFieldCard = Readonly<{
  id: string;
  label: string;
  failed: boolean;
  blocked: boolean;
  failures: number;
  missing: number;
  delta: number;
  samples: readonly unknown[];
  detail?: string;
}>;

/** Exact compact field-card model shared by official Differential Ovens and Storybook. */
export function terminalFieldListFrame(
  fields: readonly TerminalFieldCard[],
  options: Readonly<{ width: number; height: number; mode: string; selectedId?: string; expanded?: boolean; palette: PairPalette }>,
): CellGrid {
  const canvas = createCellCanvas(options.width, options.height), layout = fieldCardPairLayout(options.width);
  if (options.height <= 4) {
    const visible = fields.slice(0, Math.min(3, options.height));
    visible.forEach((field, index) => {
      const selected = field.id === options.selectedId, status = field.blocked ? "blocked" : field.failed ? "failed" : "pass";
      const tone = field.blocked ? options.palette.amber : field.failed ? options.palette.red : options.palette.green;
      writeCanvasText(
        canvas,
        0,
        index,
        `${selected ? "› " : ""}${field.label} · ${status} · ${field.failures}/${field.missing} Δ${field.delta}`,
        tone,
        layout.narrow ? options.width : layout.metadataWidth,
      );
      if (!layout.narrow) {
        renderPairSeriesSparkRow(
          canvas,
          normalizeSeriesChart(field.samples, { mode: options.mode === "current" ? "value" : "delta" }),
          layout.chartX,
          index,
          layout.chartWidth,
          options.palette,
        );
      }
    });
    const selectedIndex = visible.findIndex((field) => field.id === options.selectedId);
    const selected = visible[selectedIndex];
    if (selectedIndex >= 0 && selected?.detail && options.expanded && options.height > 1) {
      const detailY = selectedIndex === visible.length - 1 ? Math.max(0, selectedIndex - 1) : selectedIndex + 1;
      writeCanvasText(canvas, 0, detailY, `↳ ${selected.detail}`, options.palette.dim, options.width);
    }
    return canvasCellGrid(canvas);
  }
  if (options.height <= 6 && fields.length >= 3) {
    fields.slice(0, 3).forEach((field, index) => {
      const top = index * 2, selected = field.id === options.selectedId;
      const status = field.blocked ? "blocked" : field.failed ? "failed" : "pass";
      const tone = field.blocked ? options.palette.amber : field.failed ? options.palette.red : options.palette.green;
      writeCanvasText(canvas, 0, top, `${selected ? "› " : ""}${field.label} · ${status}`, tone, layout.narrow ? options.width : layout.metadataWidth);
      if (selected && options.expanded && field.detail) {
        writeCanvasText(canvas, 0, top + 1, `↳ ${field.detail}`, options.palette.dim, options.width);
      } else if (layout.narrow) {
        writeCanvasText(canvas, 0, top + 1, `${field.failures}/${field.missing} · Δ ${field.delta}`, options.palette.muted, options.width);
      } else {
        renderPairSeriesChart(
          canvas,
          normalizeSeriesChart(field.samples, { mode: options.mode === "current" ? "value" : "delta" }),
          layout.chartX,
          top,
          layout.chartWidth,
          2,
          options.palette,
        );
        writeCanvasText(canvas, 0, top + 1, `${field.failures}/${field.missing} · Δ ${field.delta}`, options.palette.muted, layout.metadataWidth);
      }
    });
    return canvasCellGrid(canvas);
  }
  fields.slice(0, layout.starts.length).forEach((field, index) => {
    const top = layout.starts[index]!;
    if (top >= options.height) return;
    const selected = field.id === options.selectedId, status = field.blocked ? "BLOCKED" : field.failed ? "FAILED" : "PASS";
    writeCanvasText(canvas, layout.metadataX, top, `${selected ? "› " : ""}${field.label}`, options.palette.foreground, layout.metadataWidth - 1);
    writeCanvasText(
      canvas,
      layout.metadataX,
      top + 1,
      `${status} · ${field.failures}/${field.missing}${layout.narrow ? ` · Δ ${field.delta}` : ""}`,
      field.blocked ? options.palette.amber : field.failed ? options.palette.red : options.palette.green,
      layout.metadataWidth - 1,
    );
    if (!layout.narrow) writeCanvasText(canvas, layout.metadataX, top + 2, `max Δ ${field.delta}`, options.palette.muted, layout.metadataWidth - 1);
    if (selected && options.expanded && field.detail && !layout.narrow) {
      const detailY = top + 3;
      writeCanvasText(canvas, layout.metadataX, detailY, `↳ ${field.detail}`, options.palette.dim, layout.narrow ? options.width - 2 : layout.metadataWidth - 1);
    }
    renderPairSeriesChart(
      canvas,
      normalizeSeriesChart(field.samples, { mode: options.mode === "current" ? "value" : "delta" }),
      layout.chartX,
      top + layout.chartOffsetY,
      layout.chartWidth,
      layout.chartHeight,
      options.palette,
    );
    if (selected && options.expanded && field.detail && layout.narrow) {
      writeCanvasText(canvas, layout.metadataX, top + 2, `↳ ${field.detail}`, options.palette.dim, options.width - 2);
    }
  });
  return canvasCellGrid(canvas);
}
