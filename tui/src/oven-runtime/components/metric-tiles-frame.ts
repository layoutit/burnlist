import type { CellGrid } from "glyphcss";
import {
  canvasCellGrid,
  createCellCanvas,
  writeCanvasText,
  type PairPalette,
} from "./paired-cell";

/** Exact compact metric-tile model used by official Visual Parity and Storybook. */
export function terminalMetricTilesFrame(
  metrics: readonly (readonly [string, string])[],
  width: number,
  height: number,
  palette: PairPalette,
): CellGrid {
  const canvas = createCellCanvas(width, height), narrow = width < 48;
  if (narrow) {
    metrics.slice(0, height).forEach(([label, value], index) => {
      writeCanvasText(canvas, 0, index, `${label}: ${value}`, palette.foreground, width);
    });
  } else {
    const tileWidth = Math.max(6, Math.floor(width / Math.max(1, metrics.length)));
    metrics.forEach(([label, value], index) => {
      const x = index * tileWidth;
      writeCanvasText(canvas, x, 0, label, palette.muted, tileWidth - 1);
      writeCanvasText(canvas, x, 1, value, palette.foreground, tileWidth - 1);
    });
  }
  return canvasCellGrid(canvas);
}
