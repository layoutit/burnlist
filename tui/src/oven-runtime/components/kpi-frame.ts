import type { CellGrid } from "glyphcss";
import {
  canvasCellGrid,
  createCellCanvas,
  renderPairKpiItem,
  renderPairKpiStrip,
  writeCanvasText,
  type PairPalette,
} from "./paired-cell";

export type TerminalKpiFrameItem = Readonly<{
  heading: string;
  value: string;
  tone?: "good" | "bad" | "neutral";
  frame?: CellGrid;
}>;
export type TerminalKpiFrameModel = Readonly<{
  title?: string;
  items: readonly TerminalKpiFrameItem[];
}>;

/** Exact KPI cell model used by admitted Ovens and the browser catalog adapter. */
export function terminalKpiFrame(
  model: TerminalKpiFrameModel,
  width: number,
  height: number,
  palette: PairPalette,
): CellGrid {
  const canvas = createCellCanvas(width, height), startY = model.title ? 1 : 0;
  if (model.title) writeCanvasText(canvas, 0, 0, model.title, palette.foreground, width);
  const narrow = width < model.items.length * 12;
  if (narrow) {
    let y = startY;
    for (const item of model.items) {
      if (y >= height) break;
      const frameWidth = item.frame ? Math.min(item.frame.cols, Math.max(1, Math.floor(width * 0.25))) : 0;
      if (item.frame) {
        for (let column = 0; column < frameWidth; column += 1) {
          const index = column;
          canvas.char[y * canvas.width + column] = item.frame.char[index] ?? " ";
          canvas.color[y * canvas.width + column] = item.frame.color[index] ?? null;
        }
      }
      writeCanvasText(canvas, frameWidth ? frameWidth + 1 : 0, y, `${item.heading} ${item.value}`, palette.muted, width - frameWidth - (frameWidth ? 1 : 0));
      y += 1;
    }
  } else {
    renderPairKpiStrip(canvas, model.items, 0, startY, width, palette);
  }
  return canvasCellGrid(canvas);
}
